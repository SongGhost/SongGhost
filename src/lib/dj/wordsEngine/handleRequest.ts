/**
 * Server entry for New words.
 * Classic `/api/generate-script` posts never call this.
 * The model always writes the line, including when the pack is empty.
 * A thin row may pick up a year, an album, a track number, a genre, or an
 * era tag from the lookups the app already uses. Sleeve credits stay first.
 * If that lookup is slow or fails, the break ships with whatever is already true.
 */

import { isEraTag, realGenreOrEraTags } from "@/lib/artist-tag-filter";
import { fetchLastFmArtistTags } from "@/lib/catalog/lastfm";
import { lookupMusicBrainzRecording } from "@/lib/catalog/musicbrainz";
import { parseAllowExplicit } from "@/lib/content-filter";
import { getEffectivePersona } from "@/lib/dj/personaConfig";
import { sanitizeDjSegmentPlan } from "@/lib/dj/trackSpeech";
import { lookupITunesTrack } from "@/lib/itunes";
import {
  formatWeatherForPrompt,
  getBriefWeatherWithin,
} from "@/lib/location/weather";
import {
  PRO_COMMENTARY_FORMATS,
  resolveCommentaryFormat,
  type DjSegmentPlan,
} from "@/types/dj";
import { normalizeAlbumContext } from "@/types/station";
import { buildFactPack, unusedFactSupply } from "./factPack";
import { composeNewBreak } from "./compose";
import { buildNewWordsPrompt } from "./prompt";
import type { FactPackInput } from "./types";

export type NewWordsResult = {
  status: number;
  script?: string;
  error?: string;
  fellBack?: boolean;
  /** Nugget ids heard in the line that aired. The session remembers these. */
  usedFactIds?: string[];
};

/** Research must not hold the song. Past this, speak what is already true. */
const BARE_LOOKUP_MS = 800;

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readYear(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  if (value < 1900 || value > 2035) return undefined;
  return value;
}

function readPlan(value: unknown): DjSegmentPlan | undefined {
  if (!value || typeof value !== "object") return undefined;
  const plan = value as DjSegmentPlan;
  if (!Array.isArray(plan.announceTracks) || typeof plan.kind !== "string") return undefined;
  return sanitizeDjSegmentPlan(plan);
}

function readSpokenIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const clean = entry.trim();
    if (!clean) continue;
    ids.push(clean);
    if (ids.length >= 40) break;
  }
  return ids;
}

function readPrevious(value: unknown): { title: string; artist: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as { title?: unknown; artist?: unknown };
  const title = readString(row.title);
  const artist = readString(row.artist);
  if (!title && !artist) return undefined;
  return { title, artist };
}

function genreNote(genre: string | undefined): string | undefined {
  const clean = genre?.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 40) return undefined;
  if (/\d{4}/.test(clean)) return undefined;
  return `Listed as ${clean}.`;
}

type BareFill = {
  album?: string;
  releaseYear?: number;
  catalogNote?: string;
  trackNumber?: number;
  discNumber?: number;
  eraTag?: string;
  genreTag?: string;
};

function readTrackNumber(value: number | undefined, max: number, min = 1): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  if (value < min || value >= max) return undefined;
  return value;
}

async function lookupBareRecording(
  artist: string,
  title: string,
  options: { needsRicher: boolean; haveYear: boolean },
): Promise<BareFill> {
  const filled: BareFill = {};
  const [itunes, tags] = await Promise.all([
    lookupITunesTrack(artist, title).catch(() => null),
    options.needsRicher
      ? fetchLastFmArtistTags(artist, 8).catch(() => [] as string[])
      : Promise.resolve([] as string[]),
  ]);
  const album = itunes?.album?.trim();
  if (album) filled.album = album;
  if (itunes?.releaseYear) filled.releaseYear = itunes.releaseYear;
  const note = genreNote(itunes?.primaryGenreName);
  if (note) filled.catalogNote = note;
  const trackNumber = readTrackNumber(itunes?.trackNumber, 100);
  if (trackNumber) filled.trackNumber = trackNumber;
  const discNumber = readTrackNumber(itunes?.discNumber, 20, 2);
  if (discNumber) filled.discNumber = discNumber;

  if (!filled.album || !filled.releaseYear) {
    try {
      const recording = await lookupMusicBrainzRecording(artist, title);
      if (!filled.album && recording?.album?.trim()) filled.album = recording.album.trim();
      if (!filled.releaseYear && recording?.releaseYear) filled.releaseYear = recording.releaseYear;
    } catch {
      // Ship with whatever iTunes already returned.
    }
  }

  if (options.needsRicher) {
    const usable = realGenreOrEraTags(tags);
    if (!options.haveYear && !filled.releaseYear) {
      const era = usable.find((tag) => isEraTag(tag));
      if (era) filled.eraTag = era;
    }
    if (!filled.catalogNote) {
      const genre = usable.find((tag) => !isEraTag(tag));
      if (genre) filled.genreTag = genre;
    }
  }
  return filled;
}

async function fillBareRecording(
  artist: string,
  title: string,
  options: { needsRicher: boolean; haveYear: boolean },
): Promise<BareFill> {
  const box: BareFill = {};
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, BARE_LOOKUP_MS);
    void lookupBareRecording(artist, title, options)
      .then((filled) => {
        box.album = filled.album;
        box.releaseYear = filled.releaseYear;
        box.catalogNote = filled.catalogNote;
        box.trackNumber = filled.trackNumber;
        box.discNumber = filled.discNumber;
        box.eraTag = filled.eraTag;
        box.genreTag = filled.genreTag;
      })
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer);
        resolve();
      });
  });
  return box;
}

async function polishWithModel(system: string, user: string): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 220,
      temperature: 0.6,
    }),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  return text || null;
}

export async function resolveNewWordsFromBody(
  body: Record<string, unknown>,
  tier: "free" | "pro",
): Promise<NewWordsResult> {
  const plan = readPlan(body.segmentPlan);
  const title = readString(body.songTitle);
  const artist = readString(body.artistName);
  if (!title && !artist && plan?.kind !== "stinger" && plan?.kind !== "recap") {
    return { status: 400, error: "songTitle and artistName are required" };
  }

  const requestedDepth = resolveCommentaryFormat(body.commentaryFormat ?? body.lore);
  const depth =
    tier === "pro" || !PRO_COMMENTARY_FORMATS.has(requestedDepth)
      ? requestedDepth
      : "standard";
  const personaId = getEffectivePersona(
    readString(body.hostId) || readString(body.personaId) || "standard-broadcast",
    tier === "pro",
  );

  let weatherSummary = readString(body.weatherSummary);
  const homeCity = readString(body.homeCity);
  if (
    plan?.kind === "local_events"
    && !plan.localEvent
    && homeCity
    && !weatherSummary
  ) {
    try {
      const weather = await getBriefWeatherWithin({ homeCity }, 800);
      if (weather) weatherSummary = formatWeatherForPrompt(weather);
    } catch {
      weatherSummary = "";
    }
  }

  const album = readString(body.album);
  const releaseYear = readYear(body.releaseYear);
  const albumContext = normalizeAlbumContext(body.albumContext);
  const spokenFactIds = readSpokenIds(body.spokenFactIds);
  const localInput: FactPackInput = {
    title,
    artist,
    album,
    releaseYear,
    stationName: readString(body.stationName),
    personaId,
    depth,
    plan,
    previous: readPrevious(body.previousTrack),
    albumContext,
    allowExplicit: parseAllowExplicit(body.allowExplicit),
    weatherSummary: weatherSummary || undefined,
    homeCity: homeCity || undefined,
    spokenFactIds,
  };
  const supply = unusedFactSupply(localInput);
  const needsRicher = plan?.kind !== "local_events" && supply.unused < supply.cap;
  let lookupAlbum: string | undefined;
  let lookupYear: number | undefined;
  let catalogNote: string | undefined;
  let lookupTrackNumber: number | undefined;
  let lookupDiscNumber: number | undefined;
  let eraTag: string | undefined;
  let genreTag: string | undefined;
  if (title && artist && (!album || !releaseYear || needsRicher)) {
    const filled = await fillBareRecording(artist, title, {
      needsRicher,
      haveYear: Boolean(releaseYear),
    });
    if (!album && filled.album) lookupAlbum = filled.album;
    if (!releaseYear && filled.releaseYear) lookupYear = filled.releaseYear;
    if (!albumContext && filled.catalogNote) catalogNote = filled.catalogNote;
    if (needsRicher) {
      lookupTrackNumber = filled.trackNumber;
      lookupDiscNumber = filled.discNumber;
      eraTag = filled.eraTag;
      genreTag = filled.genreTag;
    }
  }

  const input: FactPackInput = {
    ...localInput,
    lookupAlbum,
    lookupYear,
    lookupTrackNumber,
    lookupDiscNumber,
    catalogNote,
    eraTag,
    genreTag,
  };

  const pack = buildFactPack(input);
  const draft = composeNewBreak(pack, null).script;
  const prompt = buildNewWordsPrompt(pack, draft);
  let modelText: string | null = null;
  try {
    modelText = await polishWithModel(prompt.system, prompt.user);
  } catch {
    modelText = null;
  }

  const composed = composeNewBreak(pack, modelText);
  if (!composed.script.trim()) {
    return { status: 502, error: "No script generated" };
  }
  return {
    status: 200,
    script: composed.script,
    fellBack: composed.fellBack || modelText == null,
    usedFactIds: composed.usedNuggetIds,
  };
}

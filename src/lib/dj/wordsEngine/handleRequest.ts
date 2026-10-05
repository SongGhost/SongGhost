/**
 * Server entry for New words.
 * Classic `/api/generate-script` posts never call this.
 * The model always writes the line, including when the pack is empty.
 * A thin row may pick up a year, an album, or a track number from the
 * lookups the app already uses. Genre and era tags are not facts.
 * Sleeve credits stay first.
 * Time Capsule and Director's Cut may also take producer, engineer, and
 * studio from a MusicBrainz recording relationship lookup.
 * That lookup asks for an official studio master on the album already
 * known for this track. A live or bootleg place is not the studio.
 * If that lookup is slow or fails, the break ships with whatever is already true.
 */

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
  type CommentaryFormat,
  type DjSegmentPlan,
} from "@/types/dj";
import { normalizeAlbumContext } from "@/types/station";
import { buildFactPack, unusedFactSupply } from "./factPack";
import { composeNewBreak, stationWelcomeLine } from "./compose";
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

/**
 * Research must not hold the song. Standard and Roots stop here.
 * Past this, speak what is already true.
 */
export const BARE_LOOKUP_MS = 800;

/**
 * Time Capsule and Director's Cut may wait longer for a MusicBrainz
 * producer, engineer, and studio. MusicBrainz allows about one request
 * a second, so a search plus a relationship lookup can use most of this.
 * If it expires, speak with what is already true.
 */
export const DEEP_BARE_LOOKUP_MS = 2500;

/** Standard and Roots writer cap. Matches the previous New writer cap. */
export const NEW_WORDS_MAX_TOKENS = 220;

/**
 * Time Capsule and Director's Cut writer cap.
 * Classic deep (`SCRIPT_MAX_TOKENS_IN_DEPTH` in generate-script) is 220.
 * 280 is a little higher so a Director's Cut, up to the 120-word gate,
 * plus the JSON wrapper, is not cut off mid-line.
 */
export const NEW_WORDS_MAX_TOKENS_DEEP = 280;

export function bareLookupBudgetMs(depth: CommentaryFormat): number {
  return depth === "time_capsule" || depth === "directors_cut"
    ? DEEP_BARE_LOOKUP_MS
    : BARE_LOOKUP_MS;
}

function newWordsUseDeepModel(depth: CommentaryFormat): boolean {
  return depth === "time_capsule" || depth === "directors_cut";
}

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

type BareFill = {
  album?: string;
  releaseYear?: number;
  trackNumber?: number;
  discNumber?: number;
  producer?: string;
  recordingStudio?: string;
  engineers?: string[];
};

function readTrackNumber(value: number | undefined, max: number, min = 1): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  if (value < min || value >= max) return undefined;
  return value;
}

async function lookupBareRecording(
  artist: string,
  title: string,
  includeRelationships: boolean,
  knownAlbum?: string,
): Promise<BareFill> {
  const filled: BareFill = {};
  const itunes = await lookupITunesTrack(artist, title).catch(() => null);
  const album = itunes?.album?.trim();
  if (album) filled.album = album;
  if (itunes?.releaseYear) filled.releaseYear = itunes.releaseYear;
  const trackNumber = readTrackNumber(itunes?.trackNumber, 100);
  if (trackNumber) filled.trackNumber = trackNumber;
  const discNumber = readTrackNumber(itunes?.discNumber, 20, 2);
  if (discNumber) filled.discNumber = discNumber;

  if (includeRelationships || !filled.album || !filled.releaseYear) {
    try {
      const albumHint = knownAlbum || filled.album;
      const recording = await lookupMusicBrainzRecording(artist, title, {
        includeRelationships,
        studioMaster: true,
        ...(albumHint ? { album: albumHint } : {}),
      });
      if (!filled.album && recording?.album?.trim()) filled.album = recording.album.trim();
      if (!filled.releaseYear && recording?.releaseYear) filled.releaseYear = recording.releaseYear;
      if (includeRelationships) {
        const producer = recording?.producer?.trim();
        const studio = recording?.recordingStudio?.trim();
        const engineers = (recording?.engineers ?? [])
          .map((name) => name.trim())
          .filter(Boolean);
        if (producer) filled.producer = producer;
        if (studio) filled.recordingStudio = studio;
        if (engineers.length) filled.engineers = engineers;
      }
    } catch {
      // Ship with whatever iTunes already returned.
    }
  }

  return filled;
}

async function fillBareRecording(
  artist: string,
  title: string,
  budgetMs: number,
  includeRelationships: boolean,
  knownAlbum?: string,
): Promise<BareFill> {
  const box: BareFill = {};
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, budgetMs);
    void lookupBareRecording(artist, title, includeRelationships, knownAlbum)
      .then((filled) => {
        box.album = filled.album;
        box.releaseYear = filled.releaseYear;
        box.trackNumber = filled.trackNumber;
        box.discNumber = filled.discNumber;
        box.producer = filled.producer;
        box.recordingStudio = filled.recordingStudio;
        box.engineers = filled.engineers;
      })
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer);
        resolve();
      });
  });
  return box;
}

async function polishWithModel(
  system: string,
  user: string,
  depth: CommentaryFormat,
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const deep = newWordsUseDeepModel(depth);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: deep ? "gpt-4o" : "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: deep ? NEW_WORDS_MAX_TOKENS_DEEP : NEW_WORDS_MAX_TOKENS,
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
  if (plan?.isSessionOpening === true) {
    const script = stationWelcomeLine({
      stationName: readString(body.stationName) || "SongHost",
      now: { title, artist },
    });
    if (!script.trim()) return { status: 502, error: "No script generated" };
    return { status: 200, script, fellBack: false, usedFactIds: [] };
  }
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
  const deepLookup = newWordsUseDeepModel(depth);
  let lookupAlbum: string | undefined;
  let lookupYear: number | undefined;
  let lookupTrackNumber: number | undefined;
  let lookupDiscNumber: number | undefined;
  let lookupProducer: string | undefined;
  let lookupStudio: string | undefined;
  let lookupEngineers: string[] | undefined;
  if (title && artist && (!album || !releaseYear || needsRicher)) {
    const filled = await fillBareRecording(
      artist,
      title,
      bareLookupBudgetMs(depth),
      deepLookup && needsRicher,
      album || undefined,
    );
    if (!album && filled.album) lookupAlbum = filled.album;
    if (!releaseYear && filled.releaseYear) lookupYear = filled.releaseYear;
    if (needsRicher) {
      lookupTrackNumber = filled.trackNumber;
      lookupDiscNumber = filled.discNumber;
      if (deepLookup) {
        lookupProducer = filled.producer;
        lookupStudio = filled.recordingStudio;
        lookupEngineers = filled.engineers;
      }
    }
  }

  const input: FactPackInput = {
    ...localInput,
    lookupAlbum,
    lookupYear,
    lookupTrackNumber,
    lookupDiscNumber,
    lookupProducer,
    lookupStudio,
    lookupEngineers,
  };

  const pack = buildFactPack(input);
  const draft = composeNewBreak(pack, null).script;
  const prompt = buildNewWordsPrompt(pack, draft);
  let modelText: string | null = null;
  try {
    modelText = await polishWithModel(prompt.system, prompt.user, depth);
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

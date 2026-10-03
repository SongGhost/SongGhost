/**
 * Build the only facts New is allowed to say.
 * Fields come from the queue row, the album sleeve, a catalog lookup
 * already run for this break, or a weather/concert line the scheduler
 * already earned. Nothing here is invented.
 */

import { cleanTrackForSpeech, formatTrackByline } from "@/lib/dj/trackSpeech";
import {
  DEFAULT_COMMENTARY_FORMAT,
  resolveCommentaryFormat,
  type CommentaryFormat,
  type DjSegmentPlan,
} from "@/types/dj";
import type { AlbumContext } from "@/types/station";
import type { FactNugget, FactPack, FactPackInput, NewBreakShape, SpeechName } from "./types";

const NUGGET_CAP: Record<CommentaryFormat, number> = {
  standard: 0,
  roots_branches: 1,
  time_capsule: 2,
  directors_cut: 6,
};

export function nuggetCapForDepth(depth: CommentaryFormat | undefined): number {
  return NUGGET_CAP[resolveCommentaryFormat(depth ?? DEFAULT_COMMENTARY_FORMAT)];
}

function readYear(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  if (value < 1900 || value > 2035) return undefined;
  return value;
}

function names(title?: string, artist?: string): SpeechName {
  return cleanTrackForSpeech({ title: title ?? "", artist: artist ?? "" });
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function albumApplies(
  trackTitle: string,
  trackAlbum: string | undefined,
  album: AlbumContext | null | undefined,
): boolean {
  if (!album) return false;
  if (album.trackList.some((row) => sameText(row.title, trackTitle))) return true;
  if (trackAlbum && sameText(trackAlbum, album.albumTitle)) return true;
  return false;
}

function resolveShape(plan: DjSegmentPlan | undefined): NewBreakShape {
  if (plan?.kind === "song_id") return "song_id";
  if (plan?.kind === "stinger") return "stinger";
  if (plan?.kind === "recap") return "recap";
  if (plan?.kind === "roots_teaser") return "teaser";
  if (plan?.isFirstPlaylistPack) return "catchup";
  return "lore";
}

function pushNugget(list: FactNugget[], seen: Set<string>, nugget: FactNugget | null) {
  if (!nugget) return;
  const sentence = nugget.sentence.replace(/\s+/g, " ").trim();
  if (!sentence || seen.has(nugget.id)) return;
  seen.add(nugget.id);
  list.push({ id: nugget.id, sentence: /[.!?]$/.test(sentence) ? sentence : `${sentence}.` });
}

function yearsIn(text: string): number[] {
  const found = text.match(/\b(?:19|20)\d{2}\b/g) ?? [];
  return found.map((year) => Number(year)).filter((year) => year >= 1900 && year <= 2035);
}

export function buildFactPack(input: FactPackInput): FactPack {
  const plan = input.plan;
  const announced = plan?.announceTracks?.at(-1);
  const now = names(announced?.title || input.title, announced?.artist || input.artist);
  const previousSource = plan?.recapTracks?.[0] ?? input.previous;
  const previous = previousSource
    ? names(previousSource.title, previousSource.artist)
    : undefined;
  const previousName =
    previous && (previous.title || previous.artist) ? previous : undefined;

  const depth = resolveCommentaryFormat(input.depth ?? DEFAULT_COMMENTARY_FORMAT);
  const shape = resolveShape(plan);
  let maxNuggets = nuggetCapForDepth(depth);
  if (shape === "song_id" || shape === "stinger" || shape === "recap") maxNuggets = 0;
  if (shape === "teaser") maxNuggets = Math.min(1, maxNuggets);

  const trackAlbum = (announced?.album || input.album || "").trim();
  const sleeve = albumApplies(now.title, trackAlbum, input.albumContext)
    ? input.albumContext
    : null;
  const year =
    readYear(input.releaseYear)
    ?? (sleeve ? readYear(sleeve.releaseYear) : undefined)
    ?? readYear(input.lookupYear);
  const albumTitle =
    trackAlbum
    || sleeve?.albumTitle?.trim()
    || input.lookupAlbum?.trim()
    || "";

  const candidates: FactNugget[] = [];
  const seen = new Set<string>();

  if (plan?.kind === "local_events" && plan.localEvent) {
    const event = plan.localEvent;
    const bits = [event.artist, event.venue, event.city, event.dateLabel]
      .map((part) => part.trim())
      .filter(Boolean);
    if (bits.length >= 2) {
      pushNugget(candidates, seen, {
        id: "concert",
        sentence: `${event.artist.trim()} is at ${event.venue.trim()} in ${event.city.trim()} on ${event.dateLabel.trim()}.`,
      });
    }
  }

  const weather = input.weatherSummary?.replace(/\s+/g, " ").trim();
  const city = input.homeCity?.replace(/\s+/g, " ").trim();
  if (plan?.kind === "local_events" && !plan.localEvent && weather && city) {
    pushNugget(candidates, seen, {
      id: "weather",
      sentence: `In ${city}, it is ${weather}.`,
    });
  }

  if (year && now.title) {
    pushNugget(candidates, seen, {
      id: "year",
      sentence: `${now.title} came out in ${year}.`,
    });
  }
  if (albumTitle) {
    pushNugget(candidates, seen, {
      id: "album",
      sentence: `It is on ${albumTitle}.`,
    });
  }
  if (sleeve?.producer?.trim()) {
    pushNugget(candidates, seen, {
      id: "producer",
      sentence: `${sleeve.producer.trim()} produced it.`,
    });
  }
  if (sleeve?.recordingStudio?.trim()) {
    pushNugget(candidates, seen, {
      id: "studio",
      sentence: `Recorded at ${sleeve.recordingStudio.trim()}.`,
    });
  }
  if (sleeve?.label?.trim()) {
    pushNugget(candidates, seen, {
      id: "label",
      sentence: `Out on ${sleeve.label.trim()}.`,
    });
  }
  const note = sleeve?.trackList.find((row) => sameText(row.title, now.title))?.note?.trim();
  if (note) {
    pushNugget(candidates, seen, { id: "note", sentence: note });
  }
  const catalogNote = input.catalogNote?.replace(/\s+/g, " ").trim();
  if (!note && catalogNote) {
    pushNugget(candidates, seen, { id: "catalog", sentence: catalogNote });
  }

  const nuggets = candidates.slice(0, maxNuggets);
  const recapLines = (plan?.recapTracks ?? [])
    .map((track) => formatTrackByline(track))
    .filter((line) => line && line !== "this one");

  const allowedYears = [
    ...nuggets.flatMap((nugget) => yearsIn(nugget.sentence)),
    ...(year && nuggets.some((nugget) => nugget.id === "year") ? [year] : []),
  ];

  const variant = ((plan?.styleRotationIndex ?? 0) % 3) as 0 | 1 | 2;
  const stationName = input.stationName?.replace(/\s+/g, " ").trim() || undefined;

  return {
    engine: "new",
    depth,
    maxNuggets,
    personaId: input.personaId?.trim() || "standard-broadcast",
    shape,
    shapeVariant: variant,
    stationName,
    includeStationId: plan?.includeStinger === true && Boolean(stationName),
    now,
    previous: previousName,
    recapLines,
    nuggets,
    allowExplicit: input.allowExplicit !== false,
    allowedYears: [...new Set(allowedYears)],
  };
}

/**
 * DMCA statutory webcasting admission (17 U.S.C. § 114).
 *
 * Rolling 3-hour artist / album caps, consecutive-play limits, and a
 * session-scoped timestamped air-log. Candidates that would exceed a cap
 * are rejected — the air-log is never cleared to wrap a catalog back to
 * index 0.
 */

import { trackIdentity } from "@/lib/queue/builder";
import { normalizeArtistKey } from "@/lib/user/feedback";

export const STATUTORY_WINDOW_MS = 3 * 60 * 60 * 1000;
export const MAX_ARTIST_PER_WINDOW = 4;
export const MAX_ALBUM_PER_WINDOW = 3;
export const MAX_CONSECUTIVE_ARTIST = 3;
export const MAX_CONSECUTIVE_ALBUM = 2;

export type AirLogEntry = {
  playedAt: number;
  artistKey: string;
  albumKey: string;
  trackId: string;
};

export type StatutoryCandidate = {
  artist?: string;
  album?: string;
  youtubeId?: string;
  itunesTrackId?: number;
  streamUrl?: string;
  previewUrl?: string;
  isrc?: string;
  spotifyId?: string;
};

export type StatutoryAdmissionContext = {
  airLog?: readonly AirLogEntry[];
  /** On-air + upcoming rows already admitted (not yet in the air-log). */
  queued?: readonly StatutoryCandidate[];
  now?: number;
};

/** Session-scoped in-memory air-log. Survives station changes; never wrap-cleared. */
let sessionAirLog: AirLogEntry[] = [];

export function getAirLog(): readonly AirLogEntry[] {
  return sessionAirLog;
}

export function clearAirLog(): void {
  sessionAirLog = [];
}

/**
 * Isolate the featured / primary artist from a credit string
 * (`Artist A & Artist B`, `Artist feat. Other`).
 */
export function primaryArtistName(artist: string | undefined): string {
  if (typeof artist !== "string") return "";
  const trimmed = artist.trim();
  if (!trimmed) return "";
  return trimmed.split(/\s*(?:,|&|\/|\band\b|feat\.?|ft\.|featuring)\s+/i)[0]?.trim() ?? trimmed;
}

export function normalizeAlbumKey(album: string | undefined): string {
  if (typeof album !== "string") return "";
  return album
    .toLowerCase()
    .replace(/[([{].*$/g, "")
    .replace(/\s+[-–—]\s+.*$/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function statutoryTrackId(track: StatutoryCandidate): string {
  const identity = trackIdentity(track);
  if (identity) return identity;
  const isrc = track.isrc?.trim();
  if (isrc) return `isrc:${isrc.toUpperCase()}`;
  const spotifyId = track.spotifyId?.trim();
  if (spotifyId) return spotifyId;
  return "";
}

export function airLogKeysFromTrack(track: StatutoryCandidate): {
  artistKey: string;
  albumKey: string;
  trackId: string;
} {
  return {
    artistKey: normalizeArtistKey(primaryArtistName(track.artist)),
    albumKey: normalizeAlbumKey(track.album),
    trackId: statutoryTrackId(track),
  };
}

export function toAirLogEntry(
  track: StatutoryCandidate,
  playedAt: number = Date.now(),
): AirLogEntry | null {
  const keys = airLogKeysFromTrack(track);
  if (!keys.trackId && !keys.artistKey) return null;
  return { playedAt, ...keys };
}

export function recordAirLogEntry(
  track: StatutoryCandidate,
  playedAt: number = Date.now(),
): AirLogEntry | null {
  const entry = toAirLogEntry(track, playedAt);
  if (!entry) return null;
  sessionAirLog = [...sessionAirLog, entry];
  return entry;
}

/** Rebuild the air-log from already-aired queue rows after a session hydrate. */
export function seedAirLogFromPlayedTracks(
  tracks: readonly StatutoryCandidate[],
  playedAt: number = Date.now(),
): void {
  if (sessionAirLog.length > 0 || tracks.length === 0) return;
  const seeded: AirLogEntry[] = [];
  for (const track of tracks) {
    const entry = toAirLogEntry(track, playedAt);
    if (entry) seeded.push(entry);
  }
  sessionAirLog = seeded;
}

function pruneWindow(log: readonly AirLogEntry[], now: number): AirLogEntry[] {
  return log.filter((entry) => now - entry.playedAt < STATUTORY_WINDOW_MS);
}

function consecutiveRun(
  sequence: readonly { artistKey: string; albumKey: string }[],
  field: "artistKey" | "albumKey",
  key: string,
): number {
  if (!key) return 0;
  let run = 0;
  for (let i = sequence.length - 1; i >= 0; i -= 1) {
    if (sequence[i]?.[field] !== key) break;
    run += 1;
  }
  return run;
}

/**
 * Whether admitting `candidate` would stay inside §114 artist / album caps.
 *
 * Artist: max 4 in a rolling 3 hours, max 3 consecutive.
 * Album: max 3 in a rolling 3 hours, max 2 consecutive (blank album skips album gates).
 */
export function validateStatutoryAdmission(
  candidate: StatutoryCandidate,
  context: StatutoryAdmissionContext = {},
): boolean {
  const now = context.now ?? Date.now();
  const keys = airLogKeysFromTrack(candidate);
  if (!keys.artistKey && !keys.trackId) return true;

  const airLog = context.airLog ?? sessionAirLog;
  const queued = context.queued ?? [];
  const queuedKeys = queued.map(airLogKeysFromTrack);
  const windowLog = pruneWindow(airLog, now);

  if (keys.artistKey) {
    const aired = windowLog.filter((entry) => entry.artistKey === keys.artistKey).length;
    const pending = queuedKeys.filter((row) => row.artistKey === keys.artistKey).length;
    if (aired + pending >= MAX_ARTIST_PER_WINDOW) return false;
  }

  if (keys.albumKey) {
    const aired = windowLog.filter((entry) => entry.albumKey === keys.albumKey).length;
    const pending = queuedKeys.filter((row) => row.albumKey === keys.albumKey).length;
    if (aired + pending >= MAX_ALBUM_PER_WINDOW) return false;
  }

  const sequence = [
    ...windowLog.map((entry) => ({ artistKey: entry.artistKey, albumKey: entry.albumKey })),
    ...queuedKeys,
  ];

  if (keys.artistKey && consecutiveRun(sequence, "artistKey", keys.artistKey) >= MAX_CONSECUTIVE_ARTIST) {
    return false;
  }
  if (keys.albumKey && consecutiveRun(sequence, "albumKey", keys.albumKey) >= MAX_CONSECUTIVE_ALBUM) {
    return false;
  }

  return true;
}

/** Walk candidates in order and keep only those that clear statutory admission. */
export function filterStatutoryAdmissions<T extends StatutoryCandidate>(
  candidates: readonly T[],
  context: StatutoryAdmissionContext = {},
): T[] {
  const admitted: T[] = [];
  const queued = [...(context.queued ?? [])];
  for (const candidate of candidates) {
    if (
      !validateStatutoryAdmission(candidate, {
        airLog: context.airLog ?? sessionAirLog,
        queued,
        now: context.now,
      })
    ) {
      continue;
    }
    admitted.push(candidate);
    queued.push(candidate);
  }
  return admitted;
}

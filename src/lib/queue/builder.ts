/**
 * Queue admission: era locks and the listener's blacklist.
 *
 * Every candidate track has to clear two independent gates before it can reach
 * the queue. The era lock is strict by design — a track with no known release
 * year is rejected rather than assumed to fit, since a "90s Only" station that
 * quietly leaks undated tracks is worse than a shorter one that does not. The
 * blacklist is stricter still: a banned track or artist is never playable, on
 * any station, under any lock.
 */

import type { StationTrack } from "@/data/stations";
import { buildOrderedStationQueue, toRanked } from "@/lib/track-shuffle";
import {
  isBannedArtist,
  isBannedTrackId,
  hasBans,
  type TrackFeedback,
} from "@/lib/user/feedback";
import {
  eraYearBounds,
  formatEraWindow,
  isEraLocked,
  resolveEraLock,
  type EraLock,
} from "@/types/station";

/** Anything carrying a release year can be era-checked, not just station tracks. */
export type EraCandidate = { releaseYear?: number };

/** Nothing before this is a plausible recorded-music release year. */
const MIN_PLAUSIBLE_RELEASE_YEAR = 1900;
const MAX_PLAUSIBLE_RELEASE_YEAR = 2100;

/**
 * Pull a four-digit year out of an ISO date, a bare year, or a number. iTunes
 * returns full ISO timestamps, seed data tends to carry bare years, and hand
 * edits land as either.
 */
export function parseReleaseYear(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isInteger(value) && isPlausibleYear(value) ? value : undefined;
  }
  if (typeof value !== "string") return undefined;

  const match = value.match(/\b(\d{4})\b/);
  if (!match) return undefined;

  const year = Number.parseInt(match[1], 10);
  return isPlausibleYear(year) ? year : undefined;
}

function isPlausibleYear(year: number): boolean {
  return (
    Number.isFinite(year) &&
    year >= MIN_PLAUSIBLE_RELEASE_YEAR &&
    year <= MAX_PLAUSIBLE_RELEASE_YEAR
  );
}

/**
 * Whether a release year sits inside the locked decade. An unlocked era accepts
 * everything, including tracks with no year at all.
 */
export function isYearWithinEra(year: number | undefined, era: EraLock): boolean {
  const bounds = eraYearBounds(era);
  if (!bounds) return true;
  if (typeof year !== "number" || !Number.isFinite(year)) return false;
  return year >= bounds.startYear && year <= bounds.endYear;
}

export function trackMatchesEra(track: EraCandidate, era: EraLock): boolean {
  return isYearWithinEra(track.releaseYear, era);
}

export function filterTracksByEra<T extends EraCandidate>(tracks: T[], era: EraLock): T[] {
  const resolved = resolveEraLock(era);
  if (!isEraLocked(resolved)) return [...tracks];
  return tracks.filter((track) => trackMatchesEra(track, resolved));
}

/** Both sides of the filter, for callers that want to log or report what was dropped. */
export function partitionTracksByEra<T extends EraCandidate>(
  tracks: T[],
  era: EraLock,
): { inEra: T[]; offEra: T[] } {
  const resolved = resolveEraLock(era);
  if (!isEraLocked(resolved)) return { inEra: [...tracks], offEra: [] };

  const inEra: T[] = [];
  const offEra: T[] = [];
  for (const track of tracks) {
    (trackMatchesEra(track, resolved) ? inEra : offEra).push(track);
  }
  return { inEra, offEra };
}

/**
 * The fields the blacklist matches on. Loose enough to accept a queue entry, a
 * catalog result, or a now-playing record without a conversion step.
 */
export type BlockableTrack = {
  youtubeId?: string;
  itunesTrackId?: number;
  previewUrl?: string;
  artist?: string;
};

/**
 * The id a track is banned, de-duplicated, and remembered under.
 *
 * One identity for all three so a ban recorded from the deck matches the same
 * track when the catalog returns it again. YouTube ids come first because they
 * are the only stable identifier shared across every source; a preview-only
 * track falls back to its iTunes id, and finally to the clip URL.
 */
export function trackIdentity(track: BlockableTrack): string {
  return (
    track.youtubeId?.trim() ||
    (track.itunesTrackId ? `preview:${track.itunesTrackId}` : "") ||
    track.previewUrl?.trim() ||
    ""
  );
}

/** Whether the listener has banned this recording or the act behind it. */
export function isTrackBlocked(track: BlockableTrack, feedback: TrackFeedback): boolean {
  if (isBannedArtist(feedback, track.artist)) return true;

  const id = trackIdentity(track);
  return Boolean(id) && isBannedTrackId(feedback, id);
}

/**
 * Drops every banned track and every track by a banned artist.
 *
 * Applied to incoming catalog batches and seed pools alike. Returns the input
 * untouched when nothing is banned, which is the common case and keeps a clean
 * listener's queue build allocation-free.
 */
export function filterBlockedTracks<T extends BlockableTrack>(
  tracks: T[],
  feedback: TrackFeedback,
): T[] {
  if (!hasBans(feedback)) return tracks;
  return tracks.filter((track) => !isTrackBlocked(track, feedback));
}

export type EraQueueResult = {
  tracks: StationTrack[];
  eraLock: EraLock;
  /** Candidates rejected for falling outside — or having no — release year */
  rejectedCount: number;
  /** Candidates rejected by the listener's blacklist */
  blockedCount: number;
};

/**
 * Drop banned tracks, filter to the locked era, then apply the station queue's
 * weighted ordering and no-back-to-back-same-artist repair.
 *
 * The blacklist runs first so a banned track is never counted as off-era, and
 * ordering runs last so removing tracks at either gate can't reopen an artist
 * adjacency the shuffle just closed.
 */
export function buildEraFilteredQueue(
  tracks: StationTrack[],
  era: EraLock,
  options?: { limit?: number; feedback?: TrackFeedback },
): EraQueueResult {
  const eraLock = resolveEraLock(era);
  const allowed = options?.feedback
    ? filterBlockedTracks(tracks, options.feedback)
    : tracks;
  const { inEra, offEra } = partitionTracksByEra(allowed, eraLock);
  const ordered = buildOrderedStationQueue(toRanked(inEra));
  const limit = options?.limit;

  return {
    tracks: typeof limit === "number" && limit > 0 ? ordered.slice(0, limit) : ordered,
    eraLock,
    rejectedCount: offEra.length,
    blockedCount: tracks.length - allowed.length,
  };
}

/** Short human phrasing for empty-result messaging and logs. */
export function describeEraLock(era: EraLock): string {
  return formatEraWindow(era) ?? "all eras";
}

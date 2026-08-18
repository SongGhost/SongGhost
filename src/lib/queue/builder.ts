/**
 * Queue admission: era locks and the listener's blacklist.
 *
 * Every candidate track has to clear two independent gates before it can reach
 * the queue. The era lock is strict by design — a track with no known release
 * year is rejected rather than assumed to fit, since a "90s Only" station that
 * quietly leaks undated tracks is worse than a shorter one that does not. The
 * blacklist is stricter still: a banned track or artist is never playable, on
 * any station, under any lock.
 *
 * Album deep dives take the second path through this module: same two gates,
 * but the record's printed running order replaces the shuffle entirely.
 */

import type { StationTrack } from "@/data/stations";
import { buildOrderedStationQueue, splitTiers, toRanked, type RankedTrack } from "@/lib/track-shuffle";
import {
  hasPreferenceSignals,
  isBannedArtist,
  isBannedTrackId,
  hasBans,
  normalizeArtistKey,
  preferenceAdjustedRank,
  type TrackFeedback,
} from "@/lib/user/feedback";
import {
  albumTrackTitleKey,
  eraYearBounds,
  formatEraWindow,
  isEraLocked,
  resolveEraLock,
  resolveStationMode,
  type AlbumContext,
  type EraLock,
  type StationMode,
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

/* ------------------------------------------------------------------ *
 * Junk track & compilation blocklist
 * ------------------------------------------------------------------ */

/**
 * Spam, compilation, and spoken-word titles: countdown dumps, tribute-act
 * uploads, store-front samplers, sermons, podcasts, and lectures that are not
 * a single radio-length recording. Applied everywhere a candidate can enter a
 * queue — catalog search, queue admission, and YouTube resolution all run this
 * same check, so a video that slips past one gate is still caught by the next.
 */
export const JUNK_TITLE_PATTERN =
  /\b(top\s+\d+|greatest\s+of|best\s+of|compilation|medley|mashup|sampler|countdown|tribute|karaoke|preview|teaser|full\s+album|\d+\s+songs|sermon|preaching|bible\s+study|ministry|church\s+service|podcast|rant|lecture|speech|homily)\b/i;

/**
 * Channel/artist names that publish someone else's catalog rather than their
 * own recordings — tribute acts, karaoke backing tracks, and cover bands.
 */
export const JUNK_ARTIST_PATTERN = /\b(rockstar\s*inc|tribute|karaoke|cover\s*band)\b/i;

/**
 * Strict admission check for a single radio track. Rejects anything that
 * reads as a compilation, countdown, tribute/karaoke upload, or spoken-word
 * video rather than an individual recording by the artist of record.
 */
export function isValidRadioTrack(title: unknown, artist?: unknown): boolean {
  const cleanTitle = typeof title === "string" ? title.trim() : "";
  if (!cleanTitle || JUNK_TITLE_PATTERN.test(cleanTitle)) return false;

  const cleanArtist = typeof artist === "string" ? artist.trim() : "";
  if (cleanArtist && JUNK_ARTIST_PATTERN.test(cleanArtist)) return false;

  return true;
}

/** Drops junk candidates from a batch before any other gate sees them. */
export function filterValidRadioTracks<T extends { title: string; artist?: string }>(
  tracks: T[],
): T[] {
  return tracks.filter((track) => isValidRadioTrack(track.title, track.artist));
}

/* ------------------------------------------------------------------ *
 * Artist frequency capping
 * ------------------------------------------------------------------ */

/**
 * Anything with a primary artist string — station tracks use `artist`, Spotify
 * recommendation rows use `artists[0]`.
 */
export type ArtistCapTrack = {
  artist?: string;
  artists?: readonly string[];
};

function primaryArtistName(track: ArtistCapTrack): string {
  if (typeof track.artist === "string" && track.artist.trim()) {
    return track.artist;
  }
  const first = track.artists?.[0];
  return typeof first === "string" ? first : "";
}

/**
 * Strict per-artist frequency cap for a delivery window.
 *
 * Walks candidates in order and rejects any track whose primary artist already
 * appears `maxPerArtist` times in the accepted list. Default of 2 keeps a
 * station from stacking the same act while still allowing an encore.
 */
export function applyArtistCap<T extends ArtistCapTrack>(
  tracks: readonly T[],
  maxPerArtist = 2,
): T[] {
  const max = Number.isFinite(maxPerArtist)
    ? Math.max(0, Math.floor(maxPerArtist))
    : 2;
  const counts = new Map<string, number>();
  const accepted: T[] = [];

  for (const track of tracks) {
    const key = normalizeArtistKey(primaryArtistName(track));
    if (!key) {
      accepted.push(track);
      continue;
    }
    const seen = counts.get(key) ?? 0;
    if (seen >= max) continue;
    counts.set(key, seen + 1);
    accepted.push(track);
  }

  return accepted;
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
  streamUrl?: string;
  isrc?: string;
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
  const isrc = track.isrc?.trim();
  return (
    track.youtubeId?.trim() ||
    (track.itunesTrackId ? `preview:${track.itunesTrackId}` : "") ||
    track.streamUrl?.trim() ||
    track.previewUrl?.trim() ||
    (isrc ? `isrc:${isrc.toUpperCase()}` : "") ||
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
 * Rank a catalog batch through implicit preference weights.
 *
 * Completed listens pull a candidate forward; frequently skipped artists and
 * station/genre affinities push one back. Returns the same shape `toRanked`
 * produces so the existing weighted shuffle stays the only ordering engine.
 */
export function toPreferenceRanked(
  tracks: readonly StationTrack[],
  feedback: TrackFeedback,
  options?: { genreKey?: string; startRank?: number },
): RankedTrack[] {
  if (!hasPreferenceSignals(feedback)) {
    return toRanked(tracks, { startRank: options?.startRank });
  }

  const start = options?.startRank ?? 0;
  const genreKey = options?.genreKey;
  return splitTiers(
    tracks.map((item, index) => ({
      item,
      rank: preferenceAdjustedRank(start + index, feedback, {
        trackId: trackIdentity(item),
        artist: item.artist,
        genreKey,
      }),
      tier: 1 as const,
      isPrimaryArtist: true,
    })),
  );
}

/**
 * Drop banned tracks, filter to the locked era, then apply the station queue's
 * weighted ordering and no-back-to-back-same-artist repair.
 *
 * The blacklist runs first so a banned track is never counted as off-era, and
 * ordering runs last so removing tracks at either gate can't reopen an artist
 * adjacency the shuffle just closed. When preference signals exist they reshape
 * the popularity ranks before that shuffle draws.
 */
export function buildEraFilteredQueue(
  tracks: StationTrack[],
  era: EraLock,
  options?: { limit?: number; feedback?: TrackFeedback; genreKey?: string },
): EraQueueResult {
  const eraLock = resolveEraLock(era);
  // Junk candidates never entered the pool as far as the era and blacklist
  // gates are concerned, so this runs before either and outside their counts.
  const candidates = filterValidRadioTracks(tracks);
  const allowed = options?.feedback
    ? filterBlockedTracks(candidates, options.feedback)
    : candidates;
  const { inEra, offEra } = partitionTracksByEra(allowed, eraLock);
  const ranked = options?.feedback
    ? toPreferenceRanked(inEra, options.feedback, { genreKey: options.genreKey })
    : toRanked(inEra);
  const ordered = buildOrderedStationQueue(ranked);
  const limit = options?.limit;

  return {
    tracks: typeof limit === "number" && limit > 0 ? ordered.slice(0, limit) : ordered,
    eraLock,
    rejectedCount: offEra.length,
    blockedCount: candidates.length - allowed.length,
  };
}

/** Short human phrasing for empty-result messaging and logs. */
export function describeEraLock(era: EraLock): string {
  return formatEraWindow(era) ?? "all eras";
}

/* ------------------------------------------------------------------ *
 * Album deep dives
 * ------------------------------------------------------------------ */

/**
 * The era gate for a whole record rather than a track at a time.
 *
 * An album is one artifact with one release date, and its deep cuts routinely
 * come back from the catalog undated. Checking each track would punch holes in
 * the running order of a record that plainly belongs to the decade. The lock
 * stays strict where it counts: an album with no confirmed year is rejected
 * under a lock, never assumed to fit.
 */
export function albumMatchesEra(album: AlbumContext, era: EraLock): boolean {
  return isYearWithinEra(parseReleaseYear(album.releaseYear), resolveEraLock(era));
}

export type AlbumSequenceResult = {
  /** Playable recordings in the record's printed running order */
  tracks: StationTrack[];
  /** Catalog tracks that are not on the sleeve at all */
  offAlbum: StationTrack[];
  /** Sleeve positions with no playable recording behind them */
  missingTitles: string[];
};

/**
 * Reorder a catalog batch into the record's own running order.
 *
 * Walks the sleeve rather than the catalog, so position 1 plays first and a
 * store front's arbitrary result order is discarded outright. Anything not
 * printed on the sleeve — a single, a live cut, a compilation stray that came
 * back on the same artist search — is separated out rather than appended: a
 * deep dive plays the record, not everything adjacent to it.
 */
export function sequenceAlbumTracks(
  tracks: StationTrack[],
  album: AlbumContext,
): AlbumSequenceResult {
  // Duplicates are kept in arrival order per title so a catalog that returns
  // both a stereo and a mono master fills one sleeve position each rather than
  // dropping the second silently.
  const byTitle = new Map<string, StationTrack[]>();
  for (const track of tracks) {
    const key = albumTrackTitleKey(track.title);
    if (!key) continue;
    const bucket = byTitle.get(key);
    if (bucket) bucket.push(track);
    else byTitle.set(key, [track]);
  }

  const ordered: StationTrack[] = [];
  const missingTitles: string[] = [];
  const used = new Set<StationTrack>();

  for (const entry of [...album.trackList].sort((a, b) => a.position - b.position)) {
    const bucket = byTitle.get(albumTrackTitleKey(entry.title));
    const match = bucket?.shift();
    if (!match) {
      missingTitles.push(entry.title);
      continue;
    }
    used.add(match);
    ordered.push(match);
  }

  return {
    tracks: ordered,
    offAlbum: tracks.filter((track) => !used.has(track)),
    missingTitles,
  };
}

export type StationQueueResult = {
  tracks: StationTrack[];
  mode: StationMode;
  eraLock: EraLock;
  /** Candidates rejected for falling outside — or having no — release year */
  rejectedCount: number;
  /** Candidates rejected by the listener's blacklist */
  blockedCount: number;
  /** Deep dive only: playable tracks dropped for not being on the sleeve */
  offAlbumCount: number;
  /** Deep dive only: sleeve positions with no playable recording behind them */
  missingTitles: string[];
};

/**
 * Build a deep dive queue: the record, in order, and nothing else.
 *
 * Deliberately skips `buildOrderedStationQueue`. Its weighted shuffle and
 * no-back-to-back-same-artist repair are exactly wrong here — every track is by
 * the same act, and the running order is the point. The blacklist still applies,
 * because a banned artist is never playable on any station under any mode; a ban
 * that hits the record simply leaves a gap in the sequence.
 */
export function buildAlbumDeepDiveQueue(
  tracks: StationTrack[],
  album: AlbumContext,
  options?: { eraLock?: EraLock; feedback?: TrackFeedback; limit?: number },
): StationQueueResult {
  const eraLock = resolveEraLock(options?.eraLock);
  // A sampler or countdown video that shares the album's artist must still
  // never fill a sleeve position, so it is dropped before sequencing sees it.
  const candidates = filterValidRadioTracks(tracks);
  const allowed = options?.feedback
    ? filterBlockedTracks(candidates, options.feedback)
    : candidates;
  const blockedCount = candidates.length - allowed.length;

  if (!albumMatchesEra(album, eraLock)) {
    return {
      tracks: [],
      mode: "album_deep_dive",
      eraLock,
      rejectedCount: allowed.length,
      blockedCount,
      offAlbumCount: 0,
      missingTitles: album.trackList.map((entry) => entry.title),
    };
  }

  const sequenced = sequenceAlbumTracks(allowed, album);
  const limit = options?.limit;

  return {
    tracks:
      typeof limit === "number" && limit > 0
        ? sequenced.tracks.slice(0, limit)
        : sequenced.tracks,
    mode: "album_deep_dive",
    eraLock,
    rejectedCount: 0,
    blockedCount,
    offAlbumCount: sequenced.offAlbum.length,
    missingTitles: sequenced.missingTitles,
  };
}

/**
 * The one entry point that knows about both modes.
 *
 * Callers hand over whatever the station resolved to and get a queue back — a
 * deep dive only when the mode asks for one *and* there is a record to follow,
 * so a missing or malformed sleeve falls through to the standard shuffle rather
 * than emptying the station.
 */
export function buildStationQueue(input: {
  tracks: StationTrack[];
  mode?: StationMode;
  albumContext?: AlbumContext | null;
  eraLock?: EraLock;
  feedback?: TrackFeedback;
  /** Station id / genre affinity used to apply skip penalties while ordering */
  genreKey?: string;
  limit?: number;
}): StationQueueResult {
  const mode = resolveStationMode(input.mode);

  if (mode === "album_deep_dive" && input.albumContext) {
    return buildAlbumDeepDiveQueue(input.tracks, input.albumContext, {
      eraLock: input.eraLock,
      feedback: input.feedback,
      limit: input.limit,
    });
  }

  const result = buildEraFilteredQueue(input.tracks, resolveEraLock(input.eraLock), {
    limit: input.limit,
    feedback: input.feedback,
    genreKey: input.genreKey,
  });

  return {
    ...result,
    mode: "standard",
    offAlbumCount: 0,
    missingTitles: [],
  };
}

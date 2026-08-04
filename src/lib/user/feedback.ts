/**
 * Listener feedback on individual tracks: favorites, the blacklist, and the
 * implicit preference weights that steer catalog admission.
 *
 * Kept separate from `UserPreferences` because the two have different jobs. The
 * preference store is a React context holding rich, renderable records — it
 * powers library views and has to re-render when it changes. This store answers
 * "may this track play" and "how strongly should it be preferred", and is read
 * from inside queue assembly, which runs outside React and must not depend on a
 * provider being mounted or on a context value having hydrated yet.
 *
 * Bans are therefore ids only. A ban has to survive a page load and be readable
 * synchronously mid-queue-build; anything richer belongs in the preference
 * store, where the favorite's title and artist are already kept.
 *
 * Dial memory (buttons 1–6) is mirrored here too so a non-React reader — and a
 * reload before the preferences context finishes hydrating — still sees the
 * same six assignments the toolbar shows.
 *
 * Backed by `localStorage`: a blacklist that forgot itself on refresh would
 * replay the exact track the listener just banned, and preference weights that
 * reset every session would never learn.
 */

import {
  createEmptyMemoryPresets,
  normalizeMemoryPresets,
  type MemoryPresetList,
} from "@/types/station";

const STORAGE_KEY = "songghost:track-feedback";
const MEMORY_STORAGE_KEY = "songghost:memory-presets";

/**
 * Ceiling per list. Generous enough that a heavy listener never hits it, low
 * enough that the payload stays small — it is parsed on every queue build.
 */
const MAX_ENTRIES = 500;

/** A skip before this many seconds of playback counts as a negative signal. */
export const IMPLICIT_SKIP_BEFORE_SECONDS = 30;

/** Crossing this fraction of duration counts as a completed listen. */
export const IMPLICIT_COMPLETE_RATIO = 0.8;

/** Soft ceiling so a single artist cannot drive the multiplier to zero or infinity. */
const MAX_SIGNAL_COUNT = 40;

export type TrackFeedback = {
  /** Track ids the listener thumbed up, most recent first. */
  favoriteTracks: string[];
  /** Track ids that must never play again, most recent first. */
  bannedTracks: string[];
  /** Normalized artist keys that must never play again, most recent first. */
  bannedArtists: string[];
  /** Normalized artist key → early-skip count (reduces catalog weight). */
  artistSkipCounts: Record<string, number>;
  /** Station/genre affinity key → early-skip count (milder penalty). */
  genreSkipCounts: Record<string, number>;
  /** Track identity → completed-listen count (boosts that recording). */
  trackCompleteCounts: Record<string, number>;
  /** Normalized artist key → completed-listen count (boosts the act). */
  artistCompleteCounts: Record<string, number>;
};

export const EMPTY_TRACK_FEEDBACK: TrackFeedback = {
  favoriteTracks: [],
  bannedTracks: [],
  bannedArtists: [],
  artistSkipCounts: {},
  genreSkipCounts: {},
  trackCompleteCounts: {},
  artistCompleteCounts: {},
};

export type ListenSignalTrack = {
  trackId: string;
  artist?: string;
  /** Station id or genre affinity key — skipped stations dampen refill weight. */
  genreKey?: string;
};

/**
 * Collapses an artist name to a comparable key.
 *
 * Artists reach us as display names from three different catalogs, so the same
 * act arrives as "Guns N' Roses", "guns n roses", and "Guns N’ Roses" depending
 * on the source. Case, punctuation, and whitespace are all dropped so a single
 * ban covers every spelling.
 */
export function normalizeArtistKey(artist: string | undefined): string {
  if (typeof artist !== "string") return "";
  return artist
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeGenreKey(genre: string | undefined): string {
  if (typeof genre !== "string") return "";
  return genre
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .trim();
}

// ---- Pure reducers ---------------------------------------------------------
// Every mutation is expressed here first so the rules are testable without a
// storage backend, and so the persisted paths below stay one-liners.

function prepend(list: readonly string[], value: string): string[] {
  return [value, ...list.filter((entry) => entry !== value)].slice(0, MAX_ENTRIES);
}

function drop(list: readonly string[], value: string): string[] {
  return list.filter((entry) => entry !== value);
}

function bumpCount(counts: Record<string, number>, key: string): Record<string, number> {
  if (!key) return counts;
  const next = { ...counts, [key]: Math.min(MAX_SIGNAL_COUNT, (counts[key] ?? 0) + 1) };
  return trimCountMap(next);
}

/**
 * Keeps the heaviest signals when the map grows past the ceiling so a long-lived
 * listener cannot balloon the payload the queue parses on every refill.
 */
function trimCountMap(counts: Record<string, number>): Record<string, number> {
  const entries = Object.entries(counts).filter(
    ([key, value]) => key.length > 0 && Number.isFinite(value) && value > 0,
  );
  if (entries.length <= MAX_ENTRIES) {
    return Object.fromEntries(entries.map(([key, value]) => [key, Math.min(MAX_SIGNAL_COUNT, value)]));
  }
  entries.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(
    entries.slice(0, MAX_ENTRIES).map(([key, value]) => [key, Math.min(MAX_SIGNAL_COUNT, value)]),
  );
}

function readCountMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key || typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) continue;
    out[key] = Math.min(MAX_SIGNAL_COUNT, Math.floor(raw));
  }
  return trimCountMap(out);
}

/**
 * Marks a track as a favorite. A banned track is un-banned by the same call:
 * thumbing up something previously blacklisted is an unambiguous reversal, and
 * leaving it on both lists would favorite a track that can never play.
 */
export function withFavorite(feedback: TrackFeedback, trackId: string): TrackFeedback {
  if (!trackId) return feedback;
  return {
    ...feedback,
    favoriteTracks: prepend(feedback.favoriteTracks, trackId),
    bannedTracks: drop(feedback.bannedTracks, trackId),
  };
}

export function withoutFavorite(feedback: TrackFeedback, trackId: string): TrackFeedback {
  if (!trackId) return feedback;
  return { ...feedback, favoriteTracks: drop(feedback.favoriteTracks, trackId) };
}

/**
 * Blacklists a track, and its artist when `artistId` is supplied.
 *
 * The favorite is dropped for the mirror of the reason above. Passing an artist
 * is what separates "never play this song again" from "never play this act
 * again" — the queue filter honors both lists independently.
 */
export function withBan(
  feedback: TrackFeedback,
  trackId: string,
  artistId?: string,
): TrackFeedback {
  const artistKey = normalizeArtistKey(artistId);
  if (!trackId && !artistKey) return feedback;

  return {
    ...feedback,
    favoriteTracks: trackId ? drop(feedback.favoriteTracks, trackId) : feedback.favoriteTracks,
    bannedTracks: trackId ? prepend(feedback.bannedTracks, trackId) : feedback.bannedTracks,
    bannedArtists: artistKey
      ? prepend(feedback.bannedArtists, artistKey)
      : feedback.bannedArtists,
  };
}

export function withoutBan(
  feedback: TrackFeedback,
  trackId: string,
  artistId?: string,
): TrackFeedback {
  const artistKey = normalizeArtistKey(artistId);
  return {
    ...feedback,
    bannedTracks: trackId ? drop(feedback.bannedTracks, trackId) : feedback.bannedTracks,
    bannedArtists: artistKey ? drop(feedback.bannedArtists, artistKey) : feedback.bannedArtists,
  };
}

/**
 * Records an early skip. Artists and station/genre affinities that are skipped
 * often lose weight the next time the catalog is ordered.
 */
export function withSkip(feedback: TrackFeedback, signal: ListenSignalTrack): TrackFeedback {
  const artistKey = normalizeArtistKey(signal.artist);
  const genreKey = normalizeGenreKey(signal.genreKey);
  if (!artistKey && !genreKey) return feedback;

  return {
    ...feedback,
    artistSkipCounts: artistKey
      ? bumpCount(feedback.artistSkipCounts, artistKey)
      : feedback.artistSkipCounts,
    genreSkipCounts: genreKey
      ? bumpCount(feedback.genreSkipCounts, genreKey)
      : feedback.genreSkipCounts,
  };
}

/**
 * Records a completed listen (played past the completion ratio). Completions
 * boost the track and its artist in subsequent catalog weighting.
 */
export function withCompletedListen(
  feedback: TrackFeedback,
  signal: ListenSignalTrack,
): TrackFeedback {
  const trackId = signal.trackId?.trim() ?? "";
  const artistKey = normalizeArtistKey(signal.artist);
  if (!trackId && !artistKey) return feedback;

  return {
    ...feedback,
    trackCompleteCounts: trackId
      ? bumpCount(feedback.trackCompleteCounts, trackId)
      : feedback.trackCompleteCounts,
    artistCompleteCounts: artistKey
      ? bumpCount(feedback.artistCompleteCounts, artistKey)
      : feedback.artistCompleteCounts,
  };
}

/**
 * Classifies a listen outcome from playback position.
 *
 * A skip before the threshold is a negative signal. Crossing the completion
 * ratio is a positive one. Everything in between is neutral — the listener
 * neither rejected nor finished the track.
 */
export function classifyListenOutcome(input: {
  positionSeconds: number;
  durationSeconds: number;
  reason?: "skip" | "ended" | "progress";
}): "skip" | "complete" | "neutral" {
  const position = Number.isFinite(input.positionSeconds) ? Math.max(0, input.positionSeconds) : 0;
  const duration = Number.isFinite(input.durationSeconds) ? Math.max(0, input.durationSeconds) : 0;

  if (duration > 0 && position / duration >= IMPLICIT_COMPLETE_RATIO) {
    return "complete";
  }
  if (input.reason === "ended" && duration > 0 && position >= duration * 0.95) {
    return "complete";
  }
  if (
    (input.reason === "skip" || input.reason === undefined) &&
    position < IMPLICIT_SKIP_BEFORE_SECONDS
  ) {
    // Natural end of a short clip is not a skip — only an explicit skip is.
    if (input.reason === "skip") return "skip";
  }
  if (input.reason === "ended") return "complete";
  return "neutral";
}

export function applyListenOutcome(
  feedback: TrackFeedback,
  signal: ListenSignalTrack,
  outcome: "skip" | "complete" | "neutral",
): TrackFeedback {
  if (outcome === "skip") return withSkip(feedback, signal);
  if (outcome === "complete") return withCompletedListen(feedback, signal);
  return feedback;
}

// ---- Queries --------------------------------------------------------------

export function isFavoriteTrack(feedback: TrackFeedback, trackId: string): boolean {
  return Boolean(trackId) && feedback.favoriteTracks.includes(trackId);
}

export function isBannedTrackId(feedback: TrackFeedback, trackId: string): boolean {
  return Boolean(trackId) && feedback.bannedTracks.includes(trackId);
}

export function isBannedArtist(feedback: TrackFeedback, artist: string | undefined): boolean {
  const key = normalizeArtistKey(artist);
  return Boolean(key) && feedback.bannedArtists.includes(key);
}

/** Whether either list rejects this track. Kept here so callers need one check. */
export function isBlocked(
  feedback: TrackFeedback,
  track: { id?: string; artist?: string },
): boolean {
  return (
    isBannedTrackId(feedback, track.id ?? "") || isBannedArtist(feedback, track.artist)
  );
}

/** Whether any ban exists at all — lets queue assembly skip the filter entirely. */
export function hasBans(feedback: TrackFeedback): boolean {
  return feedback.bannedTracks.length > 0 || feedback.bannedArtists.length > 0;
}

/** Whether any implicit weight signal exists — lets ordering skip the adjust pass. */
export function hasPreferenceSignals(feedback: TrackFeedback): boolean {
  return (
    Object.keys(feedback.artistSkipCounts).length > 0 ||
    Object.keys(feedback.genreSkipCounts).length > 0 ||
    Object.keys(feedback.trackCompleteCounts).length > 0 ||
    Object.keys(feedback.artistCompleteCounts).length > 0
  );
}

/**
 * Multiplier applied to catalog candidate weight.
 *
 * Values above 1 boost a candidate; values below 1 dampen it. Frequently skipped
 * artists/genres fall toward a floor; completed listens lift the track and act.
 */
export function candidateWeightMultiplier(
  feedback: TrackFeedback,
  signal: ListenSignalTrack,
): number {
  if (!hasPreferenceSignals(feedback)) return 1;

  const artistKey = normalizeArtistKey(signal.artist);
  const genreKey = normalizeGenreKey(signal.genreKey);
  const trackId = signal.trackId?.trim() ?? "";

  const artistSkips = artistKey ? (feedback.artistSkipCounts[artistKey] ?? 0) : 0;
  const genreSkips = genreKey ? (feedback.genreSkipCounts[genreKey] ?? 0) : 0;
  const trackCompletes = trackId ? (feedback.trackCompleteCounts[trackId] ?? 0) : 0;
  const artistCompletes = artistKey ? (feedback.artistCompleteCounts[artistKey] ?? 0) : 0;

  let mult = 1;
  mult *= Math.max(0.15, 1 - artistSkips * 0.15);
  mult *= Math.max(0.25, 1 - genreSkips * 0.08);
  mult *= 1 + Math.min(trackCompletes, 5) * 0.25;
  mult *= 1 + Math.min(artistCompletes, 8) * 0.1;
  return mult;
}

/**
 * Maps a base popularity rank through the preference multiplier.
 *
 * `track-shuffle` favors lower ranks (`1 / (rank + 2)`), so a boost shrinks the
 * effective rank and a penalty grows it.
 */
export function preferenceAdjustedRank(
  baseRank: number,
  feedback: TrackFeedback,
  signal: ListenSignalTrack,
): number {
  const rank = Number.isFinite(baseRank) ? Math.max(0, baseRank) : 0;
  const mult = candidateWeightMultiplier(feedback, signal);
  if (mult === 1) return rank;
  return Math.max(0, (rank + 2) / mult - 2);
}

// ---- Persistence ----------------------------------------------------------

/**
 * Whether feedback can be read and written right now. False during SSR, and
 * when storage exists but is blocked (private mode, embed cookie policy).
 */
export function isFeedbackStorageReady(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage?.getItem === "function";
  } catch {
    return false;
  }
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .slice(0, MAX_ENTRIES);
}

function normalizeFeedback(stored: Partial<Record<keyof TrackFeedback, unknown>>): TrackFeedback {
  return {
    favoriteTracks: readStringList(stored.favoriteTracks),
    bannedTracks: readStringList(stored.bannedTracks),
    // Re-normalized on read: keys written by an earlier build may predate the
    // current collapsing rules, and a stale key would never match a lookup.
    bannedArtists: readStringList(stored.bannedArtists)
      .map(normalizeArtistKey)
      .filter(Boolean),
    artistSkipCounts: Object.fromEntries(
      Object.entries(readCountMap(stored.artistSkipCounts)).map(([key, value]) => [
        normalizeArtistKey(key),
        value,
      ]).filter(([key]) => Boolean(key)),
    ),
    genreSkipCounts: Object.fromEntries(
      Object.entries(readCountMap(stored.genreSkipCounts)).map(([key, value]) => [
        normalizeGenreKey(key),
        value,
      ]).filter(([key]) => Boolean(key)),
    ),
    trackCompleteCounts: readCountMap(stored.trackCompleteCounts),
    artistCompleteCounts: Object.fromEntries(
      Object.entries(readCountMap(stored.artistCompleteCounts)).map(([key, value]) => [
        normalizeArtistKey(key),
        value,
      ]).filter(([key]) => Boolean(key)),
    ),
  };
}

/**
 * Current feedback, or empty when unavailable.
 *
 * An unreadable store degrades to "nothing is banned" rather than throwing:
 * losing the blacklist costs the listener a skip, while a throw here would take
 * the whole queue build down with it.
 */
export function loadTrackFeedback(): TrackFeedback {
  if (!isFeedbackStorageReady()) return EMPTY_TRACK_FEEDBACK;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_TRACK_FEEDBACK;

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return EMPTY_TRACK_FEEDBACK;

    return normalizeFeedback(parsed as Partial<Record<keyof TrackFeedback, unknown>>);
  } catch {
    return EMPTY_TRACK_FEEDBACK;
  }
}

export function saveTrackFeedback(feedback: TrackFeedback): void {
  if (!isFeedbackStorageReady()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(feedback));
  } catch {
    // A full quota or private mode costs persistence, nothing more — the
    // in-memory result is still returned to the caller.
  }
}

function commit(next: TrackFeedback): TrackFeedback {
  saveTrackFeedback(next);
  return next;
}

/** Thumbs up. Returns the state the caller should render from. */
export function favoriteTrack(trackId: string): TrackFeedback {
  return commit(withFavorite(loadTrackFeedback(), trackId));
}

export function unfavoriteTrack(trackId: string): TrackFeedback {
  return commit(withoutFavorite(loadTrackFeedback(), trackId));
}

export function toggleFavoriteTrack(trackId: string): TrackFeedback {
  const current = loadTrackFeedback();
  return commit(
    isFavoriteTrack(current, trackId)
      ? withoutFavorite(current, trackId)
      : withFavorite(current, trackId),
  );
}

/**
 * Blacklists a track, and its artist when `artistId` is given. Returns the state
 * the caller should render — and the state queue assembly will read next.
 */
export function banTrack(trackId: string, artistId?: string): TrackFeedback {
  return commit(withBan(loadTrackFeedback(), trackId, artistId));
}

export function liftBan(trackId: string, artistId?: string): TrackFeedback {
  return commit(withoutBan(loadTrackFeedback(), trackId, artistId));
}

/** Persist an early-skip signal from the live queue. */
export function registerSkip(signal: ListenSignalTrack): TrackFeedback {
  return commit(withSkip(loadTrackFeedback(), signal));
}

/** Persist a completed-listen signal (played past the completion ratio). */
export function registerCompletedListen(signal: ListenSignalTrack): TrackFeedback {
  return commit(withCompletedListen(loadTrackFeedback(), signal));
}

/**
 * Classify and persist a listen outcome in one step. Returns the outcome so the
 * caller can log or short-circuit a duplicate complete signal for the same play.
 */
export function registerListenOutcome(
  signal: ListenSignalTrack,
  positionSeconds: number,
  durationSeconds: number,
  reason?: "skip" | "ended" | "progress",
): { feedback: TrackFeedback; outcome: "skip" | "complete" | "neutral" } {
  const outcome = classifyListenOutcome({ positionSeconds, durationSeconds, reason });
  return { feedback: commit(applyListenOutcome(loadTrackFeedback(), signal, outcome)), outcome };
}

/** Test and settings seam — drops every list and weight map. */
export function clearTrackFeedback(): TrackFeedback {
  return commit(EMPTY_TRACK_FEEDBACK);
}

// ---- Dial memory (1–6) ----------------------------------------------------

/**
 * Six dial assignments, readable synchronously the same way bans are.
 *
 * The React preferences context remains the UI source of truth and dual-writes
 * here on every save so queue-adjacent code can read slots without waiting on
 * hydration.
 */
export function loadMemoryPresetAssignments(): MemoryPresetList {
  if (!isFeedbackStorageReady()) return createEmptyMemoryPresets();
  try {
    const raw = window.localStorage.getItem(MEMORY_STORAGE_KEY);
    if (!raw) return createEmptyMemoryPresets();
    return normalizeMemoryPresets(JSON.parse(raw));
  } catch {
    return createEmptyMemoryPresets();
  }
}

export function saveMemoryPresetAssignments(presets: MemoryPresetList): void {
  if (!isFeedbackStorageReady()) return;
  try {
    window.localStorage.setItem(
      MEMORY_STORAGE_KEY,
      JSON.stringify(normalizeMemoryPresets(presets)),
    );
  } catch {
    // Quota / private mode: the in-memory toolbar state still updates.
  }
}

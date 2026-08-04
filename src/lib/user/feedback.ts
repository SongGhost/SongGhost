/**
 * Listener feedback on individual tracks: favorites, and the blacklist.
 *
 * Kept separate from `UserPreferences` because the two have different jobs. The
 * preference store is a React context holding rich, renderable records — it
 * powers library views and has to re-render when it changes. This store answers
 * one question, "may this track play", and is read from inside queue assembly,
 * which runs outside React and must not depend on a provider being mounted or
 * on a context value having hydrated yet.
 *
 * Bans are therefore ids only. A ban has to survive a page load and be readable
 * synchronously mid-queue-build; anything richer belongs in the preference
 * store, where the favorite's title and artist are already kept.
 *
 * Backed by `localStorage`: a blacklist that forgot itself on refresh would
 * replay the exact track the listener just banned.
 */

const STORAGE_KEY = "songghost:track-feedback";

/**
 * Ceiling per list. Generous enough that a heavy listener never hits it, low
 * enough that the payload stays small — it is parsed on every queue build.
 */
const MAX_ENTRIES = 500;

export type TrackFeedback = {
  /** Track ids the listener thumbed up, most recent first. */
  favoriteTracks: string[];
  /** Track ids that must never play again, most recent first. */
  bannedTracks: string[];
  /** Normalized artist keys that must never play again, most recent first. */
  bannedArtists: string[];
};

export const EMPTY_TRACK_FEEDBACK: TrackFeedback = {
  favoriteTracks: [],
  bannedTracks: [],
  bannedArtists: [],
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

// ---- Pure reducers ---------------------------------------------------------
// Every mutation is expressed here first so the rules are testable without a
// storage backend, and so the persisted paths below stay one-liners.

function prepend(list: readonly string[], value: string): string[] {
  return [value, ...list.filter((entry) => entry !== value)].slice(0, MAX_ENTRIES);
}

function drop(list: readonly string[], value: string): string[] {
  return list.filter((entry) => entry !== value);
}

/**
 * Marks a track as a favorite. A banned track is un-banned by the same call:
 * thumbing up something previously blacklisted is an unambiguous reversal, and
 * leaving it on both lists would favorite a track that can never play.
 */
export function withFavorite(feedback: TrackFeedback, trackId: string): TrackFeedback {
  if (!trackId) return feedback;
  return {
    favoriteTracks: prepend(feedback.favoriteTracks, trackId),
    bannedTracks: drop(feedback.bannedTracks, trackId),
    bannedArtists: feedback.bannedArtists,
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
    favoriteTracks: feedback.favoriteTracks,
    bannedTracks: trackId ? drop(feedback.bannedTracks, trackId) : feedback.bannedTracks,
    bannedArtists: artistKey ? drop(feedback.bannedArtists, artistKey) : feedback.bannedArtists,
  };
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

    const stored = parsed as Partial<Record<keyof TrackFeedback, unknown>>;
    return {
      favoriteTracks: readStringList(stored.favoriteTracks),
      bannedTracks: readStringList(stored.bannedTracks),
      // Re-normalized on read: keys written by an earlier build may predate the
      // current collapsing rules, and a stale key would never match a lookup.
      bannedArtists: readStringList(stored.bannedArtists)
        .map(normalizeArtistKey)
        .filter(Boolean),
    };
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

/** Test and settings seam — drops every list. */
export function clearTrackFeedback(): TrackFeedback {
  return commit(EMPTY_TRACK_FEEDBACK);
}

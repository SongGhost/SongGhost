import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  banTrack,
  clearTrackFeedback,
  EMPTY_TRACK_FEEDBACK,
  favoriteTrack,
  hasBans,
  isBannedArtist,
  isBannedTrackId,
  isBlocked,
  isFavoriteTrack,
  isFeedbackStorageReady,
  liftBan,
  loadTrackFeedback,
  normalizeArtistKey,
  toggleFavoriteTrack,
  unfavoriteTrack,
  withBan,
  withFavorite,
  withoutBan,
  withoutFavorite,
  type TrackFeedback,
} from "../feedback";

const STORAGE_KEY = "songghost:track-feedback";

/** The suite runs in the node environment, so `window.localStorage` is stubbed in. */
function installStorageStub(): void {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  };
}

function feedback(overrides: Partial<TrackFeedback> = {}): TrackFeedback {
  return { ...EMPTY_TRACK_FEEDBACK, ...overrides };
}

describe("normalizeArtistKey", () => {
  it("collapses case, punctuation, and spacing so one ban covers every spelling", () => {
    const canonical = normalizeArtistKey("Guns N' Roses");
    expect(normalizeArtistKey("guns n roses")).toBe(canonical);
    expect(normalizeArtistKey("Guns N’ Roses")).toBe(canonical);
    expect(normalizeArtistKey("  GUNS   N'ROSES  ")).toBe(canonical);
  });

  it("keeps distinct artists distinct", () => {
    expect(normalizeArtistKey("ABBA")).not.toBe(normalizeArtistKey("a-ha"));
  });

  it("returns empty for nothing usable", () => {
    expect(normalizeArtistKey("")).toBe("");
    expect(normalizeArtistKey("   ")).toBe("");
    expect(normalizeArtistKey("!!!" )).toBe("");
    expect(normalizeArtistKey(undefined)).toBe("");
  });
});

describe("favorite reducers", () => {
  it("adds a favorite", () => {
    expect(withFavorite(feedback(), "abc").favoriteTracks).toEqual(["abc"]);
  });

  it("moves a repeat favorite to the front instead of duplicating it", () => {
    const state = withFavorite(withFavorite(feedback(), "a"), "b");
    expect(withFavorite(state, "a").favoriteTracks).toEqual(["a", "b"]);
  });

  it("lifts a ban on the track being favorited", () => {
    // Leaving it on both lists would favorite a track that can never play.
    const banned = withBan(feedback(), "abc");
    const result = withFavorite(banned, "abc");
    expect(result.favoriteTracks).toEqual(["abc"]);
    expect(result.bannedTracks).toEqual([]);
  });

  it("removes a favorite", () => {
    expect(withoutFavorite(withFavorite(feedback(), "abc"), "abc").favoriteTracks).toEqual([]);
  });

  it("ignores an empty id", () => {
    expect(withFavorite(feedback(), "")).toEqual(EMPTY_TRACK_FEEDBACK);
    expect(withoutFavorite(feedback(), "")).toEqual(EMPTY_TRACK_FEEDBACK);
  });
});

describe("ban reducers", () => {
  it("bans a track without touching the artist list", () => {
    const result = withBan(feedback(), "abc");
    expect(result.bannedTracks).toEqual(["abc"]);
    expect(result.bannedArtists).toEqual([]);
  });

  it("bans the track and the artist together when an artist is given", () => {
    const result = withBan(feedback(), "abc", "Guns N' Roses");
    expect(result.bannedTracks).toEqual(["abc"]);
    expect(result.bannedArtists).toEqual([normalizeArtistKey("Guns N' Roses")]);
  });

  it("bans an artist alone when there is no track id", () => {
    const result = withBan(feedback(), "", "ABBA");
    expect(result.bannedTracks).toEqual([]);
    expect(result.bannedArtists).toEqual(["abba"]);
  });

  it("drops the favorite on a banned track", () => {
    const result = withBan(withFavorite(feedback(), "abc"), "abc");
    expect(result.favoriteTracks).toEqual([]);
    expect(result.bannedTracks).toEqual(["abc"]);
  });

  it("does not duplicate an existing ban", () => {
    const once = withBan(feedback(), "abc", "ABBA");
    expect(withBan(once, "abc", "abba").bannedTracks).toEqual(["abc"]);
    expect(withBan(once, "abc", "abba").bannedArtists).toEqual(["abba"]);
  });

  it("lifts a ban", () => {
    const banned = withBan(feedback(), "abc", "ABBA");
    const lifted = withoutBan(banned, "abc", "ABBA");
    expect(lifted.bannedTracks).toEqual([]);
    expect(lifted.bannedArtists).toEqual([]);
  });

  it("lifts only the scope it was given", () => {
    const banned = withBan(feedback(), "abc", "ABBA");
    expect(withoutBan(banned, "abc").bannedArtists).toEqual(["abba"]);
  });

  it("ignores a call carrying neither a track nor an artist", () => {
    expect(withBan(feedback(), "", "")).toEqual(EMPTY_TRACK_FEEDBACK);
  });
});

describe("queries", () => {
  const state = withBan(withFavorite(feedback(), "fav"), "bad", "Nickelback");

  it("reports favorites and bans", () => {
    expect(isFavoriteTrack(state, "fav")).toBe(true);
    expect(isFavoriteTrack(state, "other")).toBe(false);
    expect(isBannedTrackId(state, "bad")).toBe(true);
    expect(isBannedArtist(state, "nickelback")).toBe(true);
    expect(isBannedArtist(state, "ABBA")).toBe(false);
  });

  it("never matches an empty id", () => {
    expect(isFavoriteTrack(state, "")).toBe(false);
    expect(isBannedTrackId(state, "")).toBe(false);
    expect(isBannedArtist(state, "")).toBe(false);
  });

  it("blocks on either list", () => {
    expect(isBlocked(state, { id: "bad", artist: "Someone Else" })).toBe(true);
    expect(isBlocked(state, { id: "fine", artist: "Nickelback" })).toBe(true);
    expect(isBlocked(state, { id: "fine", artist: "ABBA" })).toBe(false);
  });

  it("reports whether any ban exists", () => {
    expect(hasBans(EMPTY_TRACK_FEEDBACK)).toBe(false);
    expect(hasBans(withFavorite(feedback(), "fav"))).toBe(false);
    expect(hasBans(state)).toBe(true);
  });
});

describe("persistence", () => {
  beforeEach(installStorageStub);
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("reads back nothing for a first-time listener", () => {
    expect(loadTrackFeedback()).toEqual(EMPTY_TRACK_FEEDBACK);
  });

  it("persists a favorite across a reload", () => {
    favoriteTrack("abc");
    expect(loadTrackFeedback().favoriteTracks).toEqual(["abc"]);
  });

  it("persists a ban across a reload", () => {
    banTrack("abc", "Nickelback");
    const stored = loadTrackFeedback();
    expect(stored.bannedTracks).toEqual(["abc"]);
    expect(stored.bannedArtists).toEqual(["nickelback"]);
  });

  it("returns the state the caller should render from", () => {
    expect(favoriteTrack("abc").favoriteTracks).toEqual(["abc"]);
    expect(banTrack("xyz").bannedTracks).toEqual(["xyz"]);
  });

  it("toggles a favorite off on a second press", () => {
    expect(toggleFavoriteTrack("abc").favoriteTracks).toEqual(["abc"]);
    expect(toggleFavoriteTrack("abc").favoriteTracks).toEqual([]);
    expect(loadTrackFeedback().favoriteTracks).toEqual([]);
  });

  it("removes a favorite outright", () => {
    favoriteTrack("abc");
    expect(unfavoriteTrack("abc").favoriteTracks).toEqual([]);
  });

  it("lifts a persisted ban", () => {
    banTrack("abc", "ABBA");
    const lifted = liftBan("abc", "ABBA");
    expect(hasBans(lifted)).toBe(false);
    expect(hasBans(loadTrackFeedback())).toBe(false);
  });

  it("clears everything", () => {
    favoriteTrack("abc");
    banTrack("xyz", "ABBA");
    expect(clearTrackFeedback()).toEqual(EMPTY_TRACK_FEEDBACK);
    expect(loadTrackFeedback()).toEqual(EMPTY_TRACK_FEEDBACK);
  });

  it("recovers from a corrupted stored value", () => {
    window.localStorage.setItem(STORAGE_KEY, "not json");
    expect(loadTrackFeedback()).toEqual(EMPTY_TRACK_FEEDBACK);
  });

  it("recovers from a stored value of the wrong shape", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(["abc"]));
    expect(loadTrackFeedback()).toEqual(EMPTY_TRACK_FEEDBACK);
  });

  it("drops non-string entries written by an older build", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ favoriteTracks: ["a", 7, null, "b"], bannedTracks: "nope" }),
    );
    const stored = loadTrackFeedback();
    expect(stored.favoriteTracks).toEqual(["a", "b"]);
    expect(stored.bannedTracks).toEqual([]);
  });

  it("re-normalizes artist keys written before the current rules", () => {
    // A stale key would never match a lookup, silently un-banning the artist.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ bannedArtists: ["Guns N' Roses", "!!!"] }),
    );
    expect(loadTrackFeedback().bannedArtists).toEqual([normalizeArtistKey("Guns N' Roses")]);
  });
});

describe("without storage", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("is not ready during server-side rendering", () => {
    expect(isFeedbackStorageReady()).toBe(false);
  });

  it("is not ready when storage access throws", () => {
    (globalThis as { window?: unknown }).window = {
      get localStorage(): never {
        throw new Error("blocked by cookie policy");
      },
    };
    expect(isFeedbackStorageReady()).toBe(false);
  });

  it("degrades to nothing banned rather than throwing mid-queue-build", () => {
    expect(loadTrackFeedback()).toEqual(EMPTY_TRACK_FEEDBACK);
    expect(() => banTrack("abc", "ABBA")).not.toThrow();
  });

  it("still reports the result to the caller when it cannot persist it", () => {
    expect(banTrack("abc").bannedTracks).toEqual(["abc"]);
  });
});

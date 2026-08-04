import { describe, expect, it } from "vitest";
import type { StationTrack } from "@/data/stations";
import {
  EMPTY_TRACK_FEEDBACK,
  withBan,
  type TrackFeedback,
} from "@/lib/user/feedback";
import {
  buildEraFilteredQueue,
  describeEraLock,
  filterBlockedTracks,
  filterTracksByEra,
  isTrackBlocked,
  isYearWithinEra,
  parseReleaseYear,
  partitionTracksByEra,
  trackIdentity,
  trackMatchesEra,
} from "../builder";

function track(title: string, artist: string, releaseYear?: number): StationTrack {
  return { youtubeId: title.toLowerCase().replace(/\s+/g, "-"), title, artist, releaseYear };
}

const catalog: StationTrack[] = [
  track("Rock Around the Clock", "Bill Haley", 1954),
  track("Purple Haze", "Jimi Hendrix", 1967),
  track("Dancing Queen", "ABBA", 1976),
  track("Take On Me", "a-ha", 1985),
  track("Sweet Child O' Mine", "Guns N' Roses", 1987),
  track("Smells Like Teen Spirit", "Nirvana", 1991),
  track("Hey Ya!", "OutKast", 2003),
  track("Undated Deep Cut", "Unknown"),
];

describe("parseReleaseYear", () => {
  it("reads a year out of an iTunes ISO timestamp", () => {
    expect(parseReleaseYear("1985-06-01T07:00:00Z")).toBe(1985);
  });

  it("accepts a bare year as a string or a number", () => {
    expect(parseReleaseYear("1991")).toBe(1991);
    expect(parseReleaseYear(1991)).toBe(1991);
  });

  it("rejects anything that is not a plausible release year", () => {
    expect(parseReleaseYear(undefined)).toBeUndefined();
    expect(parseReleaseYear("")).toBeUndefined();
    expect(parseReleaseYear("unknown")).toBeUndefined();
    expect(parseReleaseYear(1776)).toBeUndefined();
    expect(parseReleaseYear(2400)).toBeUndefined();
    expect(parseReleaseYear(1990.5)).toBeUndefined();
  });
});

describe("isYearWithinEra", () => {
  it("accepts everything when no era is locked", () => {
    expect(isYearWithinEra(1967, "all")).toBe(true);
    expect(isYearWithinEra(undefined, "all")).toBe(true);
  });

  it("includes both boundary years", () => {
    expect(isYearWithinEra(1980, "80s")).toBe(true);
    expect(isYearWithinEra(1989, "80s")).toBe(true);
  });

  it("excludes the years either side of the window", () => {
    expect(isYearWithinEra(1979, "80s")).toBe(false);
    expect(isYearWithinEra(1990, "80s")).toBe(false);
  });

  it("rejects an unknown year under a lock rather than assuming it fits", () => {
    expect(isYearWithinEra(undefined, "80s")).toBe(false);
    expect(isYearWithinEra(Number.NaN, "80s")).toBe(false);
  });
});

describe("filterTracksByEra", () => {
  it("passes the whole catalog through when unlocked", () => {
    expect(filterTracksByEra(catalog, "all")).toHaveLength(catalog.length);
  });

  it("keeps only tracks released inside the decade", () => {
    const eighties = filterTracksByEra(catalog, "80s");
    expect(eighties.map((t) => t.title)).toEqual(["Take On Me", "Sweet Child O' Mine"]);
  });

  it("drops undated tracks under a lock", () => {
    const nineties = filterTracksByEra(catalog, "90s");
    expect(nineties.map((t) => t.title)).toEqual(["Smells Like Teen Spirit"]);
    expect(nineties.some((t) => t.title === "Undated Deep Cut")).toBe(false);
  });

  it("returns an empty list rather than leaking off-era tracks", () => {
    expect(filterTracksByEra(catalog, "2020s")).toEqual([]);
  });

  it("treats an unrecognized era as no lock at all", () => {
    expect(filterTracksByEra(catalog, "40s" as never)).toHaveLength(catalog.length);
  });

  it("does not mutate the source list", () => {
    const source = [...catalog];
    filterTracksByEra(source, "80s");
    expect(source).toHaveLength(catalog.length);
  });
});

describe("trackMatchesEra", () => {
  it("validates a single candidate against the window", () => {
    expect(trackMatchesEra(track("Take On Me", "a-ha", 1985), "80s")).toBe(true);
    expect(trackMatchesEra(track("Hey Ya!", "OutKast", 2003), "80s")).toBe(false);
    expect(trackMatchesEra(track("Mystery", "Unknown"), "80s")).toBe(false);
  });
});

describe("partitionTracksByEra", () => {
  it("reports both sides of the filter", () => {
    const { inEra, offEra } = partitionTracksByEra(catalog, "80s");
    expect(inEra).toHaveLength(2);
    expect(offEra).toHaveLength(catalog.length - 2);
  });

  it("puts everything in-era when unlocked", () => {
    const { inEra, offEra } = partitionTracksByEra(catalog, "all");
    expect(inEra).toHaveLength(catalog.length);
    expect(offEra).toEqual([]);
  });
});

describe("buildEraFilteredQueue", () => {
  it("returns only in-era tracks and counts what it dropped", () => {
    const result = buildEraFilteredQueue(catalog, "80s");
    expect(result.eraLock).toBe("80s");
    expect(result.tracks).toHaveLength(2);
    expect(result.rejectedCount).toBe(catalog.length - 2);
    expect(result.tracks.every((t) => isYearWithinEra(t.releaseYear, "80s"))).toBe(true);
  });

  it("honors a limit after filtering", () => {
    expect(buildEraFilteredQueue(catalog, "80s", { limit: 1 }).tracks).toHaveLength(1);
  });

  it("orders an unlocked catalog without dropping anything", () => {
    const result = buildEraFilteredQueue(catalog, "all");
    expect(result.tracks).toHaveLength(catalog.length);
    expect(result.rejectedCount).toBe(0);
  });
});

describe("describeEraLock", () => {
  it("phrases the lock for logs and empty-state copy", () => {
    expect(describeEraLock("70s")).toBe("the 70s (1970–1979)");
    expect(describeEraLock("all")).toBe("all eras");
  });
});

describe("trackIdentity", () => {
  it("prefers the YouTube id, the one identifier every source shares", () => {
    expect(trackIdentity({ youtubeId: "abc123", itunesTrackId: 42 })).toBe("abc123");
  });

  it("falls back to the iTunes id for a preview-only track", () => {
    expect(trackIdentity({ youtubeId: "  ", itunesTrackId: 42 })).toBe("preview:42");
  });

  it("falls back to the clip url when there is nothing else", () => {
    expect(trackIdentity({ previewUrl: "https://cdn/clip.m4a" })).toBe("https://cdn/clip.m4a");
  });

  it("is empty for a track with no identifier at all", () => {
    expect(trackIdentity({ artist: "Nobody" })).toBe("");
  });
});

describe("blacklist filtering", () => {
  const banned = (overrides: Partial<TrackFeedback> = {}): TrackFeedback => ({
    ...EMPTY_TRACK_FEEDBACK,
    ...overrides,
  });

  it("blocks a banned track by identity", () => {
    const feedback = withBan(banned(), trackIdentity(catalog[3]));
    expect(isTrackBlocked(catalog[3], feedback)).toBe(true);
    expect(isTrackBlocked(catalog[4], feedback)).toBe(false);
  });

  it("blocks every track by a banned artist", () => {
    const feedback = withBan(banned(), "", "a-ha");
    expect(isTrackBlocked(catalog[3], feedback)).toBe(true);
    expect(isTrackBlocked(catalog[4], feedback)).toBe(false);
  });

  it("matches a banned artist across spellings", () => {
    const feedback = withBan(banned(), "", "Guns N’ Roses");
    expect(isTrackBlocked(track("Patience", "Guns N' Roses", 1988), feedback)).toBe(true);
  });

  it("drops banned tracks from a batch", () => {
    const feedback = withBan(banned(), trackIdentity(catalog[1]), "ABBA");
    const allowed = filterBlockedTracks(catalog, feedback);
    expect(allowed.map((t) => t.title)).not.toContain("Purple Haze");
    expect(allowed.map((t) => t.title)).not.toContain("Dancing Queen");
    expect(allowed).toHaveLength(catalog.length - 2);
  });

  it("passes the batch straight through when nothing is banned", () => {
    // The common case, and the queue is rebuilt often enough that it should not
    // pay for a copy it does not need.
    expect(filterBlockedTracks(catalog, EMPTY_TRACK_FEEDBACK)).toBe(catalog);
  });

  it("can empty a batch rather than leak a banned track", () => {
    const feedback = withBan(banned(), "", "Nirvana");
    expect(filterBlockedTracks([catalog[5]], feedback)).toEqual([]);
  });
});

describe("buildEraFilteredQueue with a blacklist", () => {
  it("drops banned tracks before the era gate and counts them separately", () => {
    const feedback = withBan(EMPTY_TRACK_FEEDBACK, "", "a-ha");
    const result = buildEraFilteredQueue(catalog, "80s", { feedback });

    expect(result.tracks.map((t) => t.title)).toEqual(["Sweet Child O' Mine"]);
    expect(result.blockedCount).toBe(1);
    // "Take On Me" was banned, not rejected for its year, so it must not be
    // counted at both gates.
    expect(result.rejectedCount).toBe(catalog.length - 2);
  });

  it("reports nothing blocked when no feedback is supplied", () => {
    expect(buildEraFilteredQueue(catalog, "80s").blockedCount).toBe(0);
  });

  it("honors a ban even when it empties the station", () => {
    const feedback = withBan(EMPTY_TRACK_FEEDBACK, "", "Nirvana");
    expect(buildEraFilteredQueue(catalog, "90s", { feedback }).tracks).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import type { StationTrack } from "@/data/stations";
import {
  EMPTY_TRACK_FEEDBACK,
  normalizeArtistKey,
  withBan,
  withCompletedListen,
  withSkip,
  type TrackFeedback,
} from "@/lib/user/feedback";
import type { AlbumContext } from "@/types/station";
import {
  albumMatchesEra,
  buildAlbumDeepDiveQueue,
  buildEraFilteredQueue,
  buildStationQueue,
  describeEraLock,
  filterBlockedTracks,
  filterTracksByEra,
  filterValidRadioTracks,
  isTrackBlocked,
  isValidRadioTrack,
  isYearWithinEra,
  parseReleaseYear,
  partitionTracksByEra,
  sequenceAlbumTracks,
  toPreferenceRanked,
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

  it("drops junk candidates before either count sees them", () => {
    const withJunk = [...catalog, track("Top 40 Countdown", "Various Artists", 1985)];
    const result = buildEraFilteredQueue(withJunk, "all");
    expect(result.tracks.map((t) => t.title)).not.toContain("Top 40 Countdown");
    // Not a ban and not off-era — it never became a candidate at all.
    expect(result.rejectedCount).toBe(0);
    expect(result.blockedCount).toBe(0);
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

describe("isValidRadioTrack", () => {
  it("accepts an ordinary single recording", () => {
    expect(isValidRadioTrack("Purple Haze", "Jimi Hendrix")).toBe(true);
  });

  it.each([
    "Top 40 Hits of 1985",
    "Greatest Of The 80s",
    "Best Of Fleetwood Mac",
    "80s Compilation Mix",
    "Wedding Medley",
    "Pop Mashup 2020",
    "Free MP3 Sampler",
    "Top 10 Countdown",
    "Queen Tribute Show",
    "Wonderwall Karaoke Version",
    "Album Preview",
    "Movie Teaser",
    "Full Album Stream",
    "50 Songs Nonstop",
    "Sunday Morning Sermon",
    "Live Preaching Session",
    "Bible Study Week 3",
    "Youth Ministry Night",
    "Church Service Replay",
    "True Crime Podcast Episode",
    "Angry Rant About Politics",
    "Guest Lecture Series",
    "Commencement Speech 2019",
    "Easter Homily",
  ])("rejects a compilation/spam/spoken-word title: %s", (title) => {
    expect(isValidRadioTrack(title, "Some Artist")).toBe(false);
  });

  it.each(["Rockstar Inc", "The Beatles Tribute", "Karaoke Nation", "Cover Band Live"])(
    "rejects a spam channel/artist: %s",
    (artist) => {
      expect(isValidRadioTrack("Some Song", artist)).toBe(false);
    },
  );

  it("rejects a blank or missing title", () => {
    expect(isValidRadioTrack("", "Anyone")).toBe(false);
    expect(isValidRadioTrack("   ", "Anyone")).toBe(false);
    expect(isValidRadioTrack(undefined, "Anyone")).toBe(false);
  });

  it("does not flag an artist as junk with no artist supplied", () => {
    expect(isValidRadioTrack("Purple Haze", undefined)).toBe(true);
  });

  it("matches case-insensitively and across whole words only", () => {
    expect(isValidRadioTrack("TOP 40 COUNTDOWN", "DJ")).toBe(false);
    // "Tributary" and "Topper" contain the banned stems but not the whole word.
    expect(isValidRadioTrack("The Tributary", "Topper")).toBe(true);
  });
});

describe("filterValidRadioTracks", () => {
  it("drops only the junk entries, keeping the rest in order", () => {
    const batch = [
      track("Purple Haze", "Jimi Hendrix"),
      track("Top 40 Hits of 1985", "Various Artists"),
      track("Dancing Queen", "ABBA"),
      track("Karaoke Classics", "Karaoke Band"),
    ];
    expect(filterValidRadioTracks(batch).map((t) => t.title)).toEqual([
      "Purple Haze",
      "Dancing Queen",
    ]);
  });

  it("passes a fully clean batch through untouched", () => {
    expect(filterValidRadioTracks(catalog)).toHaveLength(catalog.length);
  });
});

const darkSide: AlbumContext = {
  albumTitle: "The Dark Side of the Moon",
  artist: "Pink Floyd",
  releaseYear: 1973,
  recordingStudio: "Abbey Road Studios",
  personnel: [{ name: "David Gilmour", role: "guitar, vocals" }],
  trackList: [
    { position: 1, title: "Speak to Me", side: "A" },
    { position: 2, title: "Breathe", side: "A" },
    { position: 3, title: "On the Run", side: "A" },
    { position: 4, title: "Time", side: "A" },
  ],
};

/** Deliberately out of order, decorated, and padded — what a store front returns. */
const albumCatalog: StationTrack[] = [
  track("Time (2011 Remaster)", "Pink Floyd", 1973),
  track("Wish You Were Here", "Pink Floyd", 1975),
  track("Speak to Me", "Pink Floyd", 1973),
  track("On the Run", "Pink Floyd"),
  track("Breathe - Remastered", "Pink Floyd", 1973),
];

describe("sequenceAlbumTracks", () => {
  it("replays the record in its printed running order", () => {
    const { tracks } = sequenceAlbumTracks(albumCatalog, darkSide);
    expect(tracks.map((t) => t.title)).toEqual([
      "Speak to Me",
      "Breathe - Remastered",
      "On the Run",
      "Time (2011 Remaster)",
    ]);
  });

  it("separates out everything that is not on the sleeve", () => {
    const { offAlbum } = sequenceAlbumTracks(albumCatalog, darkSide);
    expect(offAlbum.map((t) => t.title)).toEqual(["Wish You Were Here"]);
  });

  it("reports sleeve positions it could not fill instead of shifting the order up", () => {
    const partial = albumCatalog.filter((t) => t.title !== "On the Run");
    const { tracks, missingTitles } = sequenceAlbumTracks(partial, darkSide);
    expect(missingTitles).toEqual(["On the Run"]);
    expect(tracks.map((t) => t.title)).toEqual([
      "Speak to Me",
      "Breathe - Remastered",
      "Time (2011 Remaster)",
    ]);
  });

  it("fills one position per copy when the catalog returns a title twice", () => {
    const doubled = [...albumCatalog, track("Time", "Pink Floyd", 1973)];
    const { tracks, offAlbum } = sequenceAlbumTracks(doubled, darkSide);
    expect(tracks).toHaveLength(4);
    expect(offAlbum.map((t) => t.title)).toEqual(["Wish You Were Here", "Time"]);
  });

  it("honors the printed position over the array order", () => {
    const reversed: AlbumContext = { ...darkSide, trackList: [...darkSide.trackList].reverse() };
    const { tracks } = sequenceAlbumTracks(albumCatalog, reversed);
    expect(tracks[0].title).toBe("Speak to Me");
  });
});

describe("albumMatchesEra", () => {
  it("gates the whole record on its own release year", () => {
    expect(albumMatchesEra(darkSide, "70s")).toBe(true);
    expect(albumMatchesEra(darkSide, "80s")).toBe(false);
    expect(albumMatchesEra(darkSide, "all")).toBe(true);
  });

  it("rejects an undated album under a lock rather than assuming it fits", () => {
    expect(albumMatchesEra({ ...darkSide, releaseYear: undefined }, "70s")).toBe(false);
    expect(albumMatchesEra({ ...darkSide, releaseYear: undefined }, "all")).toBe(true);
  });
});

describe("buildAlbumDeepDiveQueue", () => {
  it("returns the record in order and counts what it set aside", () => {
    const result = buildAlbumDeepDiveQueue(albumCatalog, darkSide);
    expect(result.mode).toBe("album_deep_dive");
    expect(result.tracks.map((t) => t.title)).toEqual([
      "Speak to Me",
      "Breathe - Remastered",
      "On the Run",
      "Time (2011 Remaster)",
    ]);
    expect(result.offAlbumCount).toBe(1);
    expect(result.missingTitles).toEqual([]);
  });

  it("keeps an undated album track that the era gate would have dropped one by one", () => {
    // "On the Run" carries no year. Under a per-track lock it would vanish and
    // punch a hole in a record that plainly belongs to the decade.
    const result = buildAlbumDeepDiveQueue(albumCatalog, darkSide, { eraLock: "70s" });
    expect(result.tracks.map((t) => t.title)).toContain("On the Run");
    expect(result.rejectedCount).toBe(0);
  });

  it("empties the queue when the record itself falls outside the lock", () => {
    const result = buildAlbumDeepDiveQueue(albumCatalog, darkSide, { eraLock: "90s" });
    expect(result.tracks).toEqual([]);
    expect(result.rejectedCount).toBe(albumCatalog.length);
    expect(result.missingTitles).toHaveLength(darkSide.trackList.length);
  });

  it("still honors a ban, leaving a gap in the sequence", () => {
    const feedback = withBan(EMPTY_TRACK_FEEDBACK, trackIdentity(albumCatalog[2]));
    const result = buildAlbumDeepDiveQueue(albumCatalog, darkSide, { feedback });
    expect(result.tracks.map((t) => t.title)).not.toContain("Speak to Me");
    expect(result.blockedCount).toBe(1);
    expect(result.missingTitles).toEqual(["Speak to Me"]);
  });

  it("takes a limit off the front of the record, not a random slice", () => {
    const result = buildAlbumDeepDiveQueue(albumCatalog, darkSide, { limit: 2 });
    expect(result.tracks.map((t) => t.title)).toEqual(["Speak to Me", "Breathe - Remastered"]);
  });

  it("does not shuffle — the same catalog always sequences the same way", () => {
    const first = buildAlbumDeepDiveQueue(albumCatalog, darkSide).tracks.map((t) => t.title);
    for (let i = 0; i < 20; i += 1) {
      expect(buildAlbumDeepDiveQueue(albumCatalog, darkSide).tracks.map((t) => t.title)).toEqual(
        first,
      );
    }
  });

  it("never lets a same-artist sampler fill a sleeve position", () => {
    const withSampler = [
      ...albumCatalog,
      track("Pink Floyd Tribute Medley", "Pink Floyd", 1973),
    ];
    const result = buildAlbumDeepDiveQueue(withSampler, darkSide);
    expect(result.tracks.map((t) => t.title)).not.toContain("Pink Floyd Tribute Medley");
    // Dropped before sequencing even sees it, so it inflates neither the sleeve
    // nor the off-album count — the baseline is unchanged from `albumCatalog` alone.
    expect(result.offAlbumCount).toBe(1);
  });
});

describe("buildStationQueue", () => {
  it("sequences the record when the mode asks for a deep dive", () => {
    const result = buildStationQueue({
      tracks: albumCatalog,
      mode: "album_deep_dive",
      albumContext: darkSide,
    });
    expect(result.mode).toBe("album_deep_dive");
    expect(result.tracks[0].title).toBe("Speak to Me");
  });

  it("falls through to the standard shuffle when there is no record to follow", () => {
    const result = buildStationQueue({ tracks: albumCatalog, mode: "album_deep_dive" });
    expect(result.mode).toBe("standard");
    expect(result.tracks).toHaveLength(albumCatalog.length);
  });

  it("ignores a sleeve on a standard station", () => {
    const result = buildStationQueue({ tracks: albumCatalog, albumContext: darkSide });
    expect(result.mode).toBe("standard");
    expect(result.offAlbumCount).toBe(0);
    expect(result.missingTitles).toEqual([]);
  });

  it("applies the era lock track by track outside of a deep dive", () => {
    const result = buildStationQueue({ tracks: catalog, eraLock: "80s" });
    expect(result.tracks).toHaveLength(2);
    expect(result.rejectedCount).toBe(catalog.length - 2);
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

describe("implicit preference weighting", () => {
  it("leaves ranks untouched when there are no preference signals", () => {
    const ranked = toPreferenceRanked(catalog, EMPTY_TRACK_FEEDBACK);
    expect(ranked.map((entry) => entry.rank)).toEqual(catalog.map((_, index) => index));
  });

  it("pulls a completed track ahead of its neighbors in rank space", () => {
    const hit = catalog[3];
    const feedback = withCompletedListen(EMPTY_TRACK_FEEDBACK, {
      trackId: trackIdentity(hit),
      artist: hit.artist,
    });
    const ranked = toPreferenceRanked(catalog, feedback);
    const hitRank = ranked.find((entry) => entry.item === hit)?.rank ?? Number.POSITIVE_INFINITY;
    expect(hitRank).toBeLessThan(3);
  });

  it("pushes a frequently skipped artist back in rank space", () => {
    let feedback = EMPTY_TRACK_FEEDBACK;
    for (let i = 0; i < 4; i++) {
      feedback = withSkip(feedback, {
        trackId: `skip-${i}`,
        artist: "a-ha",
        genreKey: "80s-pop-synth",
      });
    }
    const ranked = toPreferenceRanked(catalog, feedback, { genreKey: "80s-pop-synth" });
    const skipped = ranked.find((entry) => normalizeArtistKey(entry.item.artist) === "a ha");
    expect(skipped?.rank).toBeGreaterThan(3);
  });

  it("still admits every in-era candidate — weights reorder, they do not drop", () => {
    const feedback = withSkip(EMPTY_TRACK_FEEDBACK, {
      trackId: "x",
      artist: "a-ha",
      genreKey: "80s-pop-synth",
    });
    const result = buildEraFilteredQueue(catalog, "80s", {
      feedback,
      genreKey: "80s-pop-synth",
    });
    expect(result.tracks).toHaveLength(2);
  });
});

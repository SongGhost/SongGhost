import { describe, expect, it } from "vitest";
import {
  ACTUAL_PLAYBACK_HISTORY_LIMIT,
  asDjSegmentKind,
  bindPrefetchPreviousTrack,
  interpolatePlayheadProgressMs,
  normalizeTrackRefs,
  pickCoherentTrackMetadata,
  PLAYHEAD_INTERPOLATION_MS,
  PLAYHEAD_STALL_RESCUE_MS,
  resolveLorePreviousTrack,
  resolveQueueRowForTrackId,
  trackIdentityMatches,
  type OrchestratorTrackRef,
} from "../webOrchestrator";
import type { StationTrack } from "@/data/stations";

function ref(
  title: string,
  artist: string,
  trackId?: string,
): OrchestratorTrackRef {
  return trackId ? { title, artist, trackId } : { title, artist };
}

describe("normalizeTrackRefs", () => {
  it("keeps the newest N entries from a chronological buffer", () => {
    const history = [
      ref("Song 1", "A", "t1"),
      ref("Song 2", "B", "t2"),
      ref("Song 3", "C", "t3"),
      ref("Song 4", "D", "t4"),
      ref("Song 5", "E", "t5"),
      ref("Song 6", "F", "t6"),
    ];

    const recent = normalizeTrackRefs(history, 5);

    expect(recent).toHaveLength(5);
    expect(recent[0]?.title).toBe("Song 2");
    expect(recent.at(-1)?.title).toBe("Song 6");
  });

  it("does not take the oldest entries from the start of a long array", () => {
    const history = [
      ref("Four Songs Ago", "Old", "old"),
      ref("Three Ago", "Old", "t3"),
      ref("Two Ago", "Old", "t2"),
      ref("Just Finished", "Now", "n1"),
    ];

    const recent = normalizeTrackRefs(history, 2);

    expect(recent.map((track) => track.title)).toEqual([
      "Two Ago",
      "Just Finished",
    ]);
    expect(recent.some((track) => track.title === "Four Songs Ago")).toBe(false);
  });
});

describe("resolveLorePreviousTrack", () => {
  it("returns the immediate predecessor after filtering the current track", () => {
    const history = [
      ref("Four Songs Ago", "Old", "t1"),
      ref("Three Ago", "Old", "t2"),
      ref("Two Ago", "Old", "t3"),
      ref("Just Finished", "Now", "t4"),
      ref("Starting Now", "Live", "t5"),
    ];

    const previous = resolveLorePreviousTrack(history, "t5");

    expect(previous?.title).toBe("Just Finished");
    expect(previous?.trackId).toBe("t4");
  });

  it("still resolves N-1 when history is longer than the recap window", () => {
    const history: OrchestratorTrackRef[] = [];
    for (let i = 1; i <= ACTUAL_PLAYBACK_HISTORY_LIMIT + 3; i += 1) {
      history.push(ref(`Song ${i}`, "Artist", `t${i}`));
    }
    const current = history.at(-1)!;
    const expected = history.at(-2)!;

    const previous = resolveLorePreviousTrack(history, current.trackId);

    expect(previous?.title).toBe(expected.title);
    expect(previous?.trackId).toBe(expected.trackId);
  });
});

describe("bindPrefetchPreviousTrack", () => {
  it("binds the live on-air track when prefetching the upcoming id", () => {
    const onAir = ref("On Air Now", "Live Act", "n");
    const history = [
      ref("Two Ago", "Old", "t2"),
      ref("Just Finished", "Now", "n-1"),
      onAir,
    ];

    const previous = bindPrefetchPreviousTrack({
      upcomingTrackId: "n-plus-1",
      registeredTrackId: "n",
      onAirTrack: onAir,
      history,
    });

    expect(previous?.title).toBe("On Air Now");
    expect(previous?.trackId).toBe("n");
  });

  it("does not fall back to N-1 while Track N is still on air", () => {
    const onAir = ref("Track N", "Now Playing", "n");
    const history = [
      ref("Track N-1", "Previous", "n-1"),
    ];

    const previous = bindPrefetchPreviousTrack({
      upcomingTrackId: "n-plus-1",
      registeredTrackId: "n",
      onAirTrack: onAir,
      history,
    });

    expect(previous?.title).toBe("Track N");
    expect(previous?.title).not.toBe("Track N-1");
  });

  it("uses history N-1 for a live break on the registered track", () => {
    const history = [
      ref("Track N-1", "Previous", "n-1"),
      ref("Track N", "Now Playing", "n"),
    ];

    const previous = bindPrefetchPreviousTrack({
      upcomingTrackId: "n",
      registeredTrackId: "n",
      onAirTrack: history[1],
      history,
    });

    expect(previous?.title).toBe("Track N-1");
    expect(previous?.trackId).toBe("n-1");
  });
});

describe("trackIdentityMatches", () => {
  it("matches a catalog id to its Spotify URI", () => {
    expect(
      trackIdentityMatches("spotify:track:7hanhZrUArC9qUerln4jh1", "7hanhZrUArC9qUerln4jh1"),
    ).toBe(true);
  });

  it("rejects a different track id", () => {
    expect(trackIdentityMatches("aaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbb")).toBe(
      false,
    );
  });
});

describe("pickCoherentTrackMetadata", () => {
  const target = "7hanhZrUArC9qUerln4jh1";

  it("prefers SDK state when ids match", () => {
    const meta = pickCoherentTrackMetadata({
      targetTrackId: target,
      sdkTrack: {
        id: target,
        title: "SDK Title",
        artist: "SDK Artist",
      },
      restTrack: {
        id: "cccccccccccccccccccccc",
        title: "Wrong REST",
        artist: "Wrong",
      },
    });
    expect(meta).toEqual({
      title: "SDK Title",
      artist: "SDK Artist",
      album: undefined,
      albumArt: undefined,
    });
  });

  it("ignores REST metadata for a different URI", () => {
    const meta = pickCoherentTrackMetadata({
      targetTrackId: target,
      restTrack: {
        id: "cccccccccccccccccccccc",
        uri: "spotify:track:cccccccccccccccccccccc",
        title: "Other Song",
        artist: "Other Act",
      },
    });
    expect(meta).toBeNull();
  });

  it("uses exact-key prefetch only when the inner trackId matches or is absent", () => {
    const hit = pickCoherentTrackMetadata({
      targetTrackId: target,
      prefetchTrack: { trackId: target, title: "Warm Title", artist: "Warm Artist" },
    });
    expect(hit?.title).toBe("Warm Title");

    const miss = pickCoherentTrackMetadata({
      targetTrackId: target,
      prefetchTrack: {
        trackId: "cccccccccccccccccccccc",
        title: "Next Song",
        artist: "Next Act",
      },
    });
    expect(miss).toBeNull();
  });
});

describe("resolveQueueRowForTrackId", () => {
  const tracks: StationTrack[] = [
    {
      youtubeId: "yt-a",
      title: "Song A",
      artist: "Act A",
      spotifyId: "7hanhZrUArC9qUerln4jh1",
    },
    {
      youtubeId: "yt-b",
      title: "Song B",
      artist: "Act B",
      spotifyId: "cccccccccccccccccccccc",
    },
  ];

  it("returns the row whose Spotify id matches", () => {
    const row = resolveQueueRowForTrackId(tracks, "7hanhZrUArC9qUerln4jh1");
    expect(row?.title).toBe("Song A");
  });

  it("does not return a title/artist from a different id", () => {
    expect(resolveQueueRowForTrackId(tracks, "dddddddddddddddddddddd")).toBeNull();
  });
});

describe("interpolatePlayheadProgressMs", () => {
  it("adds elapsed time and clamps to duration", () => {
    expect(PLAYHEAD_INTERPOLATION_MS).toBe(250);
    expect(PLAYHEAD_STALL_RESCUE_MS).toBe(2000);
    const sample = { positionMs: 1000, durationMs: 5000, receivedAt: 10_000 };
    expect(interpolatePlayheadProgressMs(sample, 10_500)).toBe(1500);
    expect(interpolatePlayheadProgressMs(sample, 20_000)).toBe(5000);
  });
});

describe("asDjSegmentKind", () => {
  it("maps launch liners and intros to song_intro", () => {
    expect(asDjSegmentKind("song_intro")).toBe("song_intro");
    expect(asDjSegmentKind("intro")).toBe("song_intro");
    expect(asDjSegmentKind("liner")).toBe("song_intro");
    expect(asDjSegmentKind("station_launch")).toBe("song_intro");
  });
});

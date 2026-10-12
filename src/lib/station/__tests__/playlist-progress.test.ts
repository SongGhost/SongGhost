import { describe, expect, it } from "vitest";
import type { Station, StationTrack } from "@/data/stations";
import { readPlaylistBuildStream } from "@/lib/station/scene-client";
import { loadStationSceneHour } from "@/lib/station/scene-hour";
import {
  PLAYLIST_BUILD_LINES,
  playlistBarPercent,
  playlistStageCopy,
  shufflePlaylistLines,
  type PlaylistBuildUpdate,
} from "@/lib/station/playlist-progress";

describe("playlist build progress", () => {
  it("moves the bar with the stage and the songs already collected", () => {
    expect(playlistBarPercent("lineup", 0)).toBe(14);
    expect(playlistBarPercent("songs", 0)).toBe(22);
    expect(playlistBarPercent("songs", 4)).toBe(34);
    expect(playlistBarPercent("songs", 40)).toBe(88);
    expect(playlistBarPercent("polish", 12)).toBe(94);
    expect(playlistBarPercent("ready", 12)).toBe(100);
  });

  it("says how many songs are in hand", () => {
    expect(playlistStageCopy("lineup", 0)).toBe("Picking who belongs here");
    expect(playlistStageCopy("songs", 0)).toBe("Collecting songs");
    expect(playlistStageCopy("songs", 1)).toBe("1 song collected");
    expect(playlistStageCopy("songs", 8)).toBe("8 songs collected");
    expect(playlistStageCopy("polish", 8)).toBe("Putting the hour in order");
  });

  it("rotates the fun lines without repeating until the deck is used", () => {
    const deck = shufflePlaylistLines(11);
    expect(deck).toHaveLength(PLAYLIST_BUILD_LINES.length);
    expect(new Set(deck).size).toBe(PLAYLIST_BUILD_LINES.length);
    expect(deck).not.toEqual([...PLAYLIST_BUILD_LINES]);
    expect(shufflePlaylistLines(11)).toEqual(deck);
  });
});

describe("playlist build stream", () => {
  it("reports each stage and keeps the finished hour", async () => {
    const seen: PlaylistBuildUpdate[] = [];
    const lines = [
      JSON.stringify({ stage: "lineup", songs: 0 }),
      JSON.stringify({ stage: "songs", songs: 3 }),
      JSON.stringify({
        stage: "ready",
        songs: 2,
        tracks: [
          { title: "Wonderwall", artist: "Oasis", youtubeId: "a" },
          { title: "Song 2", artist: "Blur", youtubeId: "b" },
        ],
      }),
    ].join("\n");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(lines));
        controller.close();
      },
    });
    const ready = await readPlaylistBuildStream(stream, (update) => seen.push(update));
    expect(seen.map((update) => update.stage)).toEqual(["lineup", "songs", "ready"]);
    expect(seen[1]?.songs).toBe(3);
    expect(ready?.tracks?.map((track) => track.title)).toEqual(["Wonderwall", "Song 2"]);
  });
});

describe("station hour progress", () => {
  it("reports the lineup, then the songs as they arrive, then the finish", async () => {
    const station: Station = {
      id: "test-lane",
      name: "Test Lane",
      frequency: 99.9,
      category: "genres",
      defaultPersonaId: "standard-broadcast",
      accentColor: "#C4882A",
      youtubeVideoId: "",
      tracks: [],
      description: "A test lane.",
    };
    const song = (title: string): StationTrack => ({
      title,
      artist: "Oasis",
      youtubeId: title.toLowerCase(),
    });
    const events: PlaylistBuildUpdate[] = [];
    const hour = await loadStationSceneHour({
      station,
      suggest: async () => ["Oasis"],
      launch: async () => ({
        tracks: [song("Wonderwall"), song("Live Forever")],
        tailPlan: [],
        cast: { close: ["Oasis"], peer: [], deep: [] },
      }),
      onProgress: (update) => events.push({ ...update }),
    });
    expect(events).toEqual([
      { stage: "lineup", songs: 0 },
      { stage: "songs", songs: 0 },
      { stage: "songs", songs: 2 },
      { stage: "polish", songs: 2 },
    ]);
    expect(hour.tracks.map((track) => track.title)).toEqual(["Wonderwall", "Live Forever"]);
  });
});

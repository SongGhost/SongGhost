import { describe, expect, it } from "vitest";
import type { Station, StationTrack } from "@/data/stations";
import { getYouTubeThumbnail } from "@/lib/youtube";
import {
  hashStationId,
  stationArtworkUrl,
} from "@/components/studio/stationArtwork";

const ID_A = "dQw4w9WgXcQ";
const ID_B = "jNQXAC9IVRw";
const ID_C = "9bZkp7q19f0";

function track(youtubeId: string, title: string): StationTrack {
  return { youtubeId, title, artist: "Test Artist" };
}

function station(overrides: Partial<Station> = {}): Station {
  return {
    id: "test-station",
    name: "Test Station",
    frequency: 101.1,
    category: "genres",
    defaultPersonaId: "warm-companion",
    accentColor: "#2992cf",
    youtubeVideoId: "",
    tracks: [],
    description: "Test",
    ...overrides,
  };
}

describe("hashStationId", () => {
  it("is deterministic across two calls (no Math.random)", () => {
    expect(hashStationId("test-station")).toBe(hashStationId("test-station"));
    expect(hashStationId("80s-hits")).toBe(hashStationId("80s-hits"));
  });
});

describe("stationArtworkUrl", () => {
  it("returns the same url for the same station id and daySeed", () => {
    const s = station({
      tracks: [track(ID_A, "A"), track(ID_B, "B"), track(ID_C, "C")],
    });
    expect(stationArtworkUrl(s, 20_000)).toBe(stationArtworkUrl(s, 20_000));
  });

  it("always returns coverUrl when set (no rotation)", () => {
    const s = station({
      coverUrl: "https://example.com/custom-cover.jpg",
      tracks: [track(ID_A, "A"), track(ID_B, "B"), track(ID_C, "C")],
    });
    expect(stationArtworkUrl(s, 0)).toBe("https://example.com/custom-cover.jpg");
    expect(stationArtworkUrl(s, 1)).toBe("https://example.com/custom-cover.jpg");
    expect(stationArtworkUrl(s, 99_999)).toBe(
      "https://example.com/custom-cover.jpg",
    );
  });

  it("picks tracks[(hash + daySeed) % 3] for three youtubeId tracks", () => {
    const ids = [ID_A, ID_B, ID_C];
    const s = station({
      id: "rotating-station",
      tracks: ids.map((id, i) => track(id, `T${i}`)),
    });
    const daySeed = 20_000;
    const n = ids.length;
    const idx = ((hashStationId(s.id) + daySeed) % n + n) % n;
    expect(stationArtworkUrl(s, daySeed)).toBe(
      getYouTubeThumbnail(ids[idx], "hq"),
    );
  });

  it("falls back to station.youtubeVideoId when no tracks have a youtubeId", () => {
    const s = station({
      youtubeVideoId: ID_A,
      tracks: [
        track("", "Empty"),
        track("   ", "Whitespace"),
        { youtubeId: "", title: "No id", artist: "X" },
      ],
    });
    expect(stationArtworkUrl(s, 7)).toBe(getYouTubeThumbnail(ID_A, "hq"));
  });

  it("returns null when there is no cover, no youtubeId tracks, and no youtubeVideoId", () => {
    expect(stationArtworkUrl(station(), 1)).toBeNull();
  });
});

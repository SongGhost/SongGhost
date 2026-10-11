import { afterEach, describe, expect, it, vi } from "vitest";
import type { StationTrack } from "@/data/stations";
import { loadStationSceneHour } from "@/lib/station/scene-hour";
import { GET } from "../route";

vi.mock("@/lib/station/scene-hour", async () => {
  const actual = await vi.importActual<typeof import("@/lib/station/scene-hour")>(
    "@/lib/station/scene-hour",
  );
  return {
    ...actual,
    loadStationSceneHour: vi.fn(),
    resumeStationPlan: vi.fn(),
  };
});

vi.mock("@/lib/catalog/musicbrainz", () => ({
  enrichTracksWithMusicBrainz: vi.fn(async (tracks: StationTrack[]) => tracks),
}));

vi.mock("@/lib/youtube/youtube-search", () => ({
  classifyYouTubePlayback: vi.fn(async () => new Map()),
}));

function track(
  title: string,
  artist: string,
  releaseYear: number | undefined,
  youtubeId: string,
): StationTrack {
  return { youtubeId, title, artist, ...(releaseYear ? { releaseYear } : {}) };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/station-tracks", () => {
  it("returns a dated 90s hour and does not collapse it to one starter", async () => {
    const tracks = [
      track("Wonderwall", "Oasis", 1995, "oasis90sxxx"),
      track("Song 2", "Blur", 1997, "blur90sxxxx"),
      track("Common People", "Pulp", 1995, "pulp90sxxxx"),
      track("Too Late", "Oasis", 2004, "toolatexxxx"),
      track("No Year", "Blur", undefined, "noyearxxxxx"),
    ];
    vi.mocked(loadStationSceneHour).mockResolvedValue({
      tracks,
      pool: [{ name: "Oasis" }, { name: "Blur" }, { name: "Pulp" }],
      cast: { close: ["Oasis"], peer: ["Blur"], deep: ["Pulp"] },
      art: [],
      poolFresh: true,
    });

    const res = await GET(
      new Request("http://localhost/api/station-tracks?stationId=britpop-invasion&era=90s"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tracks: StationTrack[] };
    expect(body.tracks.map((row) => row.title)).toEqual([
      "Wonderwall",
      "Song 2",
      "Common People",
    ]);
    expect(body.tracks.length).toBeGreaterThan(1);
  });
});

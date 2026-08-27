import { afterEach, describe, expect, it, vi } from "vitest";
import type { StationTrack } from "@/data/stations";
import { fetchGenreTracks, finalizeStationCatalog } from "@/lib/station/catalog-builder";
import { resolveTrackVideoId } from "@/lib/youtube-search";
import { POST } from "../route";

vi.mock("@/lib/station/catalog-builder", () => ({
  fetchGenreTracks: vi.fn(),
  finalizeStationCatalog: vi.fn(),
}));

vi.mock("@/lib/youtube-search", () => ({
  resolveTrackVideoId: vi.fn(),
}));

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/station/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const mockTracks: StationTrack[] = [
  {
    youtubeId: "abc12345678",
    title: "N.Y. State of Mind",
    artist: "Nas",
    releaseYear: 1994,
  },
  {
    youtubeId: "def12345678",
    title: "Juicy",
    artist: "The Notorious B.I.G.",
    releaseYear: 1994,
  },
];

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/station/generate", () => {
  it("returns a tuner mix from the shared catalog builder without Spotify extras", async () => {
    vi.mocked(fetchGenreTracks).mockResolvedValue(mockTracks);
    vi.mocked(finalizeStationCatalog).mockImplementation(async (tracks) => tracks);

    const res = await POST(
      jsonRequest({
        genres: ["hip hop"],
        decades: ["90s"],
        energy: 60,
        catalogDepth: 40,
      }),
    );
    const data = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(data.eraLock).toBe("90s");
    expect(data.energy).toBe(60);
    expect(data.catalogDepth).toBe(40);
    expect(data.decades).toEqual(["90s"]);
    expect(data.genres).toEqual(["hip hop"]);
    expect(Array.isArray(data.tracks)).toBe(true);
    expect((data.tracks as StationTrack[]).length).toBeGreaterThan(0);
    expect(data.station).toEqual(
      expect.objectContaining({
        name: "hip hop (90s)",
        tracks: mockTracks,
      }),
    );
    expect(data).not.toHaveProperty("targetEnergy");
    expect(data).not.toHaveProperty("targetPopularity");
    expect(data).not.toHaveProperty("yearFilter");
    expect(fetchGenreTracks).toHaveBeenCalledTimes(1);
    expect(finalizeStationCatalog).toHaveBeenCalledTimes(1);
    expect(fetchGenreTracks).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Set),
      "90s",
      { limit: 40 },
    );
  });

  it("rejects an empty mix with 400", async () => {
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
    expect(fetchGenreTracks).not.toHaveBeenCalled();
  });

  it("prepends a resolved seedTrack and does not duplicate it later", async () => {
    const seedId = "SEEDVIDEO01";
    vi.mocked(resolveTrackVideoId).mockResolvedValue(seedId);
    vi.mocked(fetchGenreTracks).mockImplementation(async (_station, seen) => {
      expect(seen.has(seedId)).toBe(true);
      return [
        {
          youtubeId: seedId,
          title: "N.Y. State of Mind",
          artist: "Nas",
        },
        {
          youtubeId: "other123456",
          title: "The World Is Yours",
          artist: "Nas",
        },
      ];
    });
    vi.mocked(finalizeStationCatalog).mockImplementation(async (tracks) => tracks);

    const res = await POST(
      jsonRequest({
        genres: ["hip hop"],
        decades: ["90s"],
        seedTrack: {
          title: "N.Y. State of Mind",
          artist: "Nas",
          durationMs: 290000,
        },
      }),
    );
    const data = (await res.json()) as { tracks: StationTrack[] };

    expect(res.status).toBe(200);
    expect(data.tracks[0]?.title).toBe("N.Y. State of Mind");
    expect(data.tracks[0]?.artist).toBe("Nas");
    expect(data.tracks[0]?.youtubeId).toBe(seedId);
    expect(data.tracks.filter((t) => t.youtubeId === seedId)).toHaveLength(1);
    expect(resolveTrackVideoId).toHaveBeenCalledWith("Nas", "N.Y. State of Mind", undefined, 290);
  });

  it("forwards limit so the resolved count is not capped at 30", async () => {
    const many: StationTrack[] = Array.from({ length: 40 }, (_, i) => ({
      youtubeId: `id${String(i).padStart(9, "0")}`,
      title: `Track ${i}`,
      artist: `Artist ${i}`,
    }));
    vi.mocked(fetchGenreTracks).mockResolvedValue(many);
    vi.mocked(finalizeStationCatalog).mockImplementation(async (tracks) => tracks);

    const res = await POST(
      jsonRequest({
        genres: ["hip hop"],
        decades: ["90s"],
        limit: 50,
      }),
    );
    const data = (await res.json()) as { tracks: StationTrack[] };

    expect(res.status).toBe(200);
    expect(data.tracks).toHaveLength(40);
    expect(fetchGenreTracks).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Set),
      "90s",
      { limit: 50 },
    );
  });

  it("skips prepend when the seed cannot resolve to YouTube or a preview", async () => {
    vi.mocked(resolveTrackVideoId).mockResolvedValue(null);
    vi.mocked(fetchGenreTracks).mockResolvedValue(mockTracks);
    vi.mocked(finalizeStationCatalog).mockImplementation(async (tracks) => tracks);

    const res = await POST(
      jsonRequest({
        genres: ["hip hop"],
        decades: ["90s"],
        seedTrack: { title: "Missing", artist: "Nobody" },
      }),
    );
    const data = (await res.json()) as { tracks: StationTrack[] };

    expect(res.status).toBe(200);
    expect(data.tracks[0]?.title).toBe("N.Y. State of Mind");
    expect(data.tracks).toEqual(mockTracks);
  });
});

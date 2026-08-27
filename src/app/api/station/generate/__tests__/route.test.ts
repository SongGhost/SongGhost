import { afterEach, describe, expect, it, vi } from "vitest";
import type { StationTrack } from "@/data/stations";
import { fetchGenreTracks, finalizeStationCatalog } from "@/lib/station/catalog-builder";
import { POST } from "../route";

vi.mock("@/lib/station/catalog-builder", () => ({
  fetchGenreTracks: vi.fn(),
  finalizeStationCatalog: vi.fn(),
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
  });

  it("rejects an empty mix with 400", async () => {
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
    expect(fetchGenreTracks).not.toHaveBeenCalled();
  });
});

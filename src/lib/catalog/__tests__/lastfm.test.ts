import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchLastFmSimilarArtistsScored,
  fetchLastFmTopTracks,
  filterGreatSongs,
} from "../lastfm";

const LASTFM_KEY = "test-lastfm-key";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

describe("filterGreatSongs", () => {
  it("always keeps the #1 track even when it is the only one above the ratio", () => {
    const filtered = filterGreatSongs([
      { title: "Biggest Hit", playcount: 1000 },
      { title: "Deep Cut", playcount: 50 },
    ]);
    expect(filtered.map((t) => t.title)).toEqual(["Biggest Hit"]);
  });

  it("keeps tracks at or above 20% of the top play count", () => {
    const filtered = filterGreatSongs([
      { title: "Hit A", playcount: 1000 },
      { title: "Hit B", playcount: 200 },
      { title: "Hit C", playcount: 199 },
      { title: "Album Filler", playcount: 10 },
    ]);
    expect(filtered.map((t) => t.title)).toEqual(["Hit A", "Hit B"]);
  });

  it("drops tracks below the ratio and re-ranks by play count descending", () => {
    const filtered = filterGreatSongs(
      [
        { title: "Mid", playcount: 400 },
        { title: "Top", playcount: 1000 },
        { title: "Low", playcount: 50 },
      ],
      0.2,
    );
    expect(filtered.map((t) => t.title)).toEqual(["Top", "Mid"]);
  });

  it("returns an empty list for an empty pool", () => {
    expect(filterGreatSongs([])).toEqual([]);
  });
});

describe("fetchLastFmTopTracks / fetchLastFmSimilarArtistsScored", () => {
  const originalKey = process.env.LASTFM_API_KEY;
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.LASTFM_API_KEY = LASTFM_KEY;
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.LASTFM_API_KEY;
    else process.env.LASTFM_API_KEY = originalKey;
    globalThis.fetch = originalFetch;
  });

  it("returns [] when Last.fm is not configured", async () => {
    delete process.env.LASTFM_API_KEY;
    await expect(fetchLastFmTopTracks("Snow Patrol")).resolves.toEqual([]);
    await expect(fetchLastFmSimilarArtistsScored("Snow Patrol")).resolves.toEqual(
      [],
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses artist.gettoptracks and dedupes by normalized title", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        toptracks: {
          track: [
            { name: "Chasing Cars", playcount: "5000", artist: { name: "Snow Patrol" } },
            { name: "chasing cars", playcount: "10", artist: { name: "Snow Patrol" } },
            { name: "Run", playcount: "3000", artist: { name: "Snow Patrol" } },
          ],
        },
      }),
    );

    const tracks = await fetchLastFmTopTracks("Snow Patrol", 30);
    expect(tracks).toEqual([
      { title: "Chasing Cars", playcount: 5000 },
      { title: "Run", playcount: 3000 },
    ]);

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("method=artist.gettoptracks");
    expect(url).toContain("artist=Snow+Patrol");
  });

  it("returns similar artists WITH match scores and does not drop loose matches at this layer", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        similarartists: {
          artist: [
            { name: "Keane", match: "0.91" },
            { name: "Travis Scott", match: "0.12" },
            { name: "Snow Patrol", match: "1" },
          ],
        },
      }),
    );

    const scored = await fetchLastFmSimilarArtistsScored("Snow Patrol", 12);
    expect(scored).toEqual([
      { name: "Keane", match: 0.91 },
      { name: "Travis Scott", match: 0.12 },
    ]);

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("method=artist.getsimilar");
  });

  it("returns [] when lastFmGet fails or Last.fm reports an error", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 6, message: "Artist not found" }),
    );
    await expect(fetchLastFmTopTracks("Unknown")).resolves.toEqual([]);

    fetchMock.mockResolvedValueOnce(jsonResponse({}, false));
    await expect(fetchLastFmSimilarArtistsScored("Unknown")).resolves.toEqual([]);
  });
});

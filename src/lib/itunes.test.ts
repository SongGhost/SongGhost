import { afterEach, describe, expect, it, vi } from "vitest";
import { clearITunesCache, searchITunesSongs, upgradeITunesArtworkUrl } from "./itunes";

function itunesResponse(results: unknown[]) {
  return {
    ok: true,
    json: async () => ({ resultCount: results.length, results }),
  };
}

describe("parseSongResult artworkUrl", () => {
  afterEach(() => {
    clearITunesCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("populates artworkUrl from artworkUrl100", async () => {
    const artworkUrl100 = "https://is1-ssl.mzstatic.com/image/thumb/Music/foo/100x100bb.jpg";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        itunesResponse([
          {
            trackName: "N.Y. State of Mind",
            artistName: "Nas",
            artworkUrl100,
          },
        ]),
      ),
    );

    const songs = await searchITunesSongs("boom bap hip hop 90s", 8);
    expect(songs).toHaveLength(1);
    expect(songs[0]?.artworkUrl).toBe(upgradeITunesArtworkUrl(artworkUrl100));
    expect(songs[0]?.artworkUrl).toContain("600x600bb");
  });

  it("falls back to artworkUrl60 when artworkUrl100 is missing", async () => {
    const artworkUrl60 = "https://is1-ssl.mzstatic.com/image/thumb/Music/foo/60x60bb.jpg";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        itunesResponse([
          {
            trackName: "Juicy",
            artistName: "The Notorious B.I.G.",
            artworkUrl60,
          },
        ]),
      ),
    );

    const songs = await searchITunesSongs("east coast hip hop", 8);
    expect(songs[0]?.artworkUrl).toBe(upgradeITunesArtworkUrl(artworkUrl60));
    expect(songs[0]?.artworkUrl).toContain("600x600bb");
  });

  it("omits artworkUrl when neither size is present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        itunesResponse([
          {
            trackName: "No Art",
            artistName: "Unknown",
          },
        ]),
      ),
    );

    const songs = await searchITunesSongs("no art", 8);
    expect(songs[0]?.artworkUrl).toBeUndefined();
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(file: string): string {
  return readFileSync(path.resolve(file), "utf8");
}

describe("Songs Mix and Radio call the shared artist builders", () => {
  it("does not leave the old Song Radio weave on the search click", () => {
    const search = source("src/components/search/SmartSearchBar.tsx");
    expect(search).not.toContain("/api/song-radio");
    expect(search).not.toContain("launchSongRadio");
    expect(search).not.toContain('label="Song Radio"');
    expect(search).toContain("onSongMix");
    expect(search).toContain("onSongRadio");
    expect(search).toContain("aria-label={`Mix starting with");
    expect(search).toContain("aria-label={`Radio starting with");
    expect(search).toContain("seedTitle");
    expect(search).toContain("artistRadioUrl(track.artist, launchMode");
    expect(search).toContain('launchMode === "mixed" ? "Mix" : "Radio"');
    expect(search).toContain("excludeNeighbors");
    expect(search).toContain("artistRadioUrl(name, artistMode)");
  });

  it("pins the picked song inside the shared artist-radio builder", () => {
    const route = source("src/app/api/artist-radio/route.ts");
    expect(route).toContain("assembleMixNeighbors(matchedArtist, previousNeighbors)");
    expect(route).toContain("resolvePinnedSeedSong");
    expect(route).toContain("pinExactSongFirst");
    expect(route).toContain('mode === "mixed" ? MIX_SEED_SONGS : ARTIST_RADIO_PAYLOAD_SIZE');
    expect(route).not.toContain("fetchSimilarArtistsScored");
    expect(route).toContain('!trackIsSeedArtist(track.artist, matchedArtist)');
    expect(route).toContain("trackIsSeedArtist(track.artist, matchedArtist)");
  });

  it("forwards the old song-radio URL into that same builder", () => {
    const route = source("src/app/api/song-radio/route.ts");
    expect(route).toContain("getArtistRadio");
    expect(route).toContain('params.set("seedTitle"');
    expect(route).toContain('=== "artist-only" ? "artist-only" : "mixed"');
    expect(route).not.toContain("fetchSimilarArtists");
    expect(route).not.toContain("fetchLastFmTopTracks");
    expect(route).not.toContain("SEED_ARTIST_EXTRA_PICKS");
  });

  it("keeps a locked song opener ahead of Artist Radio rotation", () => {
    const queue = source("src/hooks/useStationQueue.ts");
    const radioStart = queue.indexOf("if (isArtistRadioStation(stationIdRef.current))");
    const lockAt = queue.indexOf("openerLock", radioStart);
    const rotateAt = queue.indexOf("const ordered = rotateStarter(", radioStart);
    expect(radioStart).toBeGreaterThan(-1);
    expect(lockAt).toBeGreaterThan(radioStart);
    expect(rotateAt).toBeGreaterThan(lockAt);
    expect(queue).toContain("pinExactSongFirst");
  });
});

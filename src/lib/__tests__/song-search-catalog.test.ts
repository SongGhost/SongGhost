import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createArtistRadioStation } from "@/lib/artist-radio";
import {
  ITUNES_LOOKUP_CAP,
  loadSongCatalogPage,
  recordingDedupeKey,
  SONG_PAGE_SIZE,
  type RawCatalogSong,
  type SongCatalogCursor,
  type SongCatalogDeps,
  type SongCatalogTrack,
} from "@/lib/song-search-catalog";

function song(
  title: string,
  artist = "The National",
  trackId?: number,
): RawCatalogSong {
  return {
    title,
    artist,
    trackId,
    durationMs: 200_000,
  };
}

function numbered(start: number, count: number, artist = "The National"): RawCatalogSong[] {
  return Array.from({ length: count }, (_, index) =>
    song(`Song ${start + index}`, artist, start + index + 1),
  );
}

function deps(overrides: Partial<SongCatalogDeps>): SongCatalogDeps {
  return {
    findArtist: async () => ({ name: "The National", artistId: 42 }),
    searchSongs: async () => ({ songs: [], rawCount: 0 }),
    lookupSongs: async () => [],
    resolveMbid: async () => "mbid-national",
    browseRecordings: async () => ({ songs: [], rawCount: 0, total: 0 }),
    neighbors: async () => [],
    ...overrides,
  };
}

async function drain(catalog: SongCatalogDeps, pageSize = SONG_PAGE_SIZE) {
  const pages: Array<{
    tracks: SongCatalogTrack[];
    cursor: SongCatalogCursor | null;
    exhausted: boolean;
    similarOpen: boolean;
  }> = [];
  let cursor: SongCatalogCursor | null = null;
  const seen: string[] = [];
  for (let guard = 0; guard < 40; guard += 1) {
    const page = await loadSongCatalogPage({
      query: "The National",
      cursor,
      seen,
      deps: catalog,
      pageSize,
    });
    pages.push(page);
    for (const track of page.tracks) {
      const key = recordingDedupeKey(track);
      if (key) seen.push(key);
    }
    cursor = page.cursor;
    if (page.exhausted) break;
  }
  return pages;
}

describe("song station titles", () => {
  const pinned = {
    title: "Bloodbuzz Ohio",
    artist: "The National",
    youtubeId: "abcdefghijk",
    openerLock: true as const,
  };

  it("names the wide station after the song and the narrow station after the artist", () => {
    expect(
      createArtistRadioStation("The National", [pinned], "standard-broadcast", "mixed").name,
    ).toBe("Bloodbuzz Ohio Radio");
    expect(
      createArtistRadioStation("The National", [pinned], "standard-broadcast", "artist-only").name,
    ).toBe("The National only");
    expect(
      createArtistRadioStation(
        "The National",
        [{ ...pinned, openerLock: false }],
        "standard-broadcast",
        "mixed",
      ).name,
    ).toBe("Artist Radio: The National");
  });
});

describe("Songs catalog pages", () => {
  it("keeps paging past the old 25 cap, drops dupes and junk, and opens similar only after the artist is done", async () => {
    let neighborCalls = 0;
    const catalog = deps({
      searchSongs: async (term, _limit, offset) => {
        if (term === "The National") {
          if (offset === 0) return { songs: numbered(0, 25), rawCount: 25 };
          if (offset === 25) {
            return {
              songs: [
                ...numbered(25, 10),
                song("Song 0", "The National", 900),
                song("Midnight Karaoke", "The National", 901),
              ],
              rawCount: 12,
            };
          }
        }
        if (term === "Phoebe Bridgers") {
          return { songs: [song("Garden Song", "Phoebe Bridgers", 500)], rawCount: 1 };
        }
        return { songs: [], rawCount: 0 };
      },
      lookupSongs: async () => [song("Song 0", "The National", 902), song("About Today", "The National", 90)],
      neighbors: async () => {
        neighborCalls += 1;
        return ["Phoebe Bridgers"];
      },
    });

    const pages = await drain(catalog);
    const artistTracks = pages.flatMap((page) => page.tracks).filter((track) => track.section === "artist");
    const similarTracks = pages.flatMap((page) => page.tracks).filter((track) => track.section === "similar");
    const firstSimilar = pages.findIndex((page) => page.tracks.some((track) => track.section === "similar"));

    expect(artistTracks.length).toBeGreaterThan(SONG_PAGE_SIZE);
    expect(artistTracks.filter((track) => track.title === "Song 0")).toHaveLength(1);
    expect(artistTracks.some((track) => /karaoke/i.test(track.title))).toBe(false);
    expect(pages[0]?.similarOpen).toBe(false);
    expect(neighborCalls).toBe(1);
    expect(firstSimilar).toBeGreaterThan(0);
    expect(pages.slice(0, firstSimilar).every((page) => page.tracks.every((track) => track.section === "artist"))).toBe(true);
    expect(similarTracks.map((track) => track.title)).toEqual(["Garden Song"]);
    expect(pages.at(-1)?.exhausted).toBe(true);
  });

  it("skips empty iTunes search windows until lookup yields songs", async () => {
    const offsets: number[] = [];
    const catalog = deps({
      searchSongs: async (_term, _limit, offset) => {
        offsets.push(offset);
        if (offset === 0) return { songs: numbered(0, 25), rawCount: 25 };
        return { songs: numbered(0, 25), rawCount: 25 };
      },
      lookupSongs: async () => [song("Deep Lookup", "The National", 5000)],
    });

    const first = await loadSongCatalogPage({
      query: "The National",
      cursor: null,
      seen: [],
      deps: catalog,
    });
    const seen = first.tracks.map((track) => recordingDedupeKey(track)).filter(Boolean);
    const second = await loadSongCatalogPage({
      query: "The National",
      cursor: first.cursor,
      seen,
      deps: catalog,
    });

    expect(second.tracks.map((track) => track.title)).toContain("Deep Lookup");
    expect(second.cursor?.phase === "itunes-lookup" || second.cursor?.phase === "similar" || second.cursor?.phase === "musicbrainz").toBe(true);
    expect(offsets.filter((offset) => offset > 0).length).toBeLessThan(6);
  });

  it("uses MusicBrainz after iTunes lookup hits its 200 cap, before similar artists", async () => {
    let browsed = false;
    let neighborCalls = 0;
    const catalog = deps({
      searchSongs: async (term) => {
        if (term === "Neighbor") return { songs: [song("Neighbor Song", "Neighbor", 3)], rawCount: 1 };
        return { songs: [], rawCount: 0 };
      },
      lookupSongs: async () => numbered(0, ITUNES_LOOKUP_CAP),
      browseRecordings: async () => {
        browsed = true;
        return { songs: [song("Deep Cut", "The National", undefined)], rawCount: 1, total: 1 };
      },
      neighbors: async () => {
        neighborCalls += 1;
        return ["Neighbor"];
      },
    });

    const pages = await drain(catalog, 25);
    const browseAt = pages.findIndex((page) => page.tracks.some((track) => track.title === "Deep Cut"));
    const similarAt = pages.findIndex((page) => page.tracks.some((track) => track.section === "similar"));

    expect(browsed).toBe(true);
    expect(browseAt).toBeGreaterThan(-1);
    expect(similarAt).toBeGreaterThan(browseAt);
    expect(pages[browseAt]?.tracks.every((track) => track.section === "artist")).toBe(true);
    expect(neighborCalls).toBe(1);
    expect(pages.flatMap((page) => page.tracks).filter((track) => track.section === "artist").length).toBe(
      ITUNES_LOOKUP_CAP + 1,
    );
  });

  it("rotates similar artists and never plays more than two songs in a row from one neighbor", async () => {
    const neighbors = ["Bon Iver", "Sufjan Stevens", "Phoebe Bridgers", "Arcade Fire", "The War on Drugs"];
    const catalog = deps({
      searchSongs: async (term, limit, offset) => {
        if (term === "The National") return { songs: [song("Bloodbuzz Ohio", "The National", 1)], rawCount: 1 };
        const songs = Array.from({ length: 4 }, (_, index) => {
          const number = offset + index + 1;
          return song(`${term} ${number}`, term, number * 100 + term.length);
        }).slice(0, limit);
        const rawCount = offset >= 4 ? 0 : songs.length;
        return { songs: offset >= 4 ? [] : songs, rawCount };
      },
      lookupSongs: async () => [],
      neighbors: async () => neighbors,
    });

    const pages = await drain(catalog, 10);
    const similar = pages.flatMap((page) => page.tracks).filter((track) => track.section === "similar");
    const firstTen = similar.slice(0, 10).map((track) => `${track.artist} — ${track.title}`);
    expect(firstTen).toEqual([
      "Bon Iver — Bon Iver 1",
      "Bon Iver — Bon Iver 2",
      "Sufjan Stevens — Sufjan Stevens 1",
      "Sufjan Stevens — Sufjan Stevens 2",
      "Phoebe Bridgers — Phoebe Bridgers 1",
      "Phoebe Bridgers — Phoebe Bridgers 2",
      "Arcade Fire — Arcade Fire 1",
      "Arcade Fire — Arcade Fire 2",
      "The War on Drugs — The War on Drugs 1",
      "The War on Drugs — The War on Drugs 2",
    ]);
    let runArtist = "";
    let run = 0;
    for (const track of similar) {
      if (track.artist === runArtist) {
        run += 1;
        expect(run).toBeLessThanOrEqual(2);
      } else {
        runArtist = track.artist;
        run = 1;
      }
    }
    const keys = similar.map((track) => recordingDedupeKey(track));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("Songs search wiring", () => {
  it("starts wide radio from the row and artist-only from the chip", () => {
    const search = readFileSync(path.resolve("src/components/search/SmartSearchBar.tsx"), "utf8");
    const route = readFileSync(path.resolve("src/app/api/search/songs/route.ts"), "utf8");

    expect(search).toContain("onClick={() => onSongMix(track)}");
    expect(search).toContain("Artist only");
    expect(search).toContain('onSongRadio(track)');
    expect(search).toContain('selectSong(track, "mixed")');
    expect(search).toContain('selectSong(track, "artist-only")');
    expect(search).toContain("`${track.title} Radio`");
    expect(search).toContain("`${track.artist} only`");
    expect(search).toContain("/api/search/songs");
    expect(search).toContain("Similar artists");
    expect(search).toContain("That&apos;s everything");
    expect(search).not.toContain("aria-label={`Mix starting with");
    expect(search).not.toContain("aria-label={`Radio starting with");
    expect(search).not.toContain(">Mix<");
    expect(search).not.toContain(">Radio<");
    expect(search).not.toContain('launchMode === "mixed" ? "Mix" : "Radio"');
    expect(search).not.toContain('mode === "artist-only" ? "artist-only" : "mixed"');
    expect(search).toContain('onSelectArtist(artist, "artist-only")');
    expect(search).toContain('selectArtist(active.item, "mixed")');
    expect(search).toContain("launchMode: ArtistRadioMode");
    expect(route).toContain("recallNeighborhoodPool");
    expect(route).not.toContain("assembleMixNeighbors");
  });
});

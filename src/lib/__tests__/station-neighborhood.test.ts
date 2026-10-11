import { describe, expect, it, vi } from "vitest";
import { GENRE_STATIONS, STATIONS, getStationById } from "@/data/stations";
import { MIX_SEED_SONGS } from "@/lib/artist-mix";
import { clearNeighborhoodPools, rememberNeighborhoodPool } from "@/lib/mix-neighbors";
import { tunerStationIdForLabel } from "@/components/studio/TuneStationPanel";
import { pickDailySleeve, resolveCardArtwork } from "@/components/studio/stationArtwork";
import { formatStationMetaTag } from "@/lib/station-meta";
import { onPinClick, stationsInDecade, stationsInFamily } from "@/lib/station/shelf";
import { fetchCatalogSceneHour } from "@/lib/station/scene-client";
import {
  catalogCardSubtitle,
  composeStationHour,
  isStationShareable,
  loadStationSceneHour,
  queueForListen,
  stationPoolKey,
} from "@/lib/station/scene-hour";
import { sortStationsWithPinsFirst, togglePinStation } from "@/lib/user/preferences";
import type { StationTrack } from "@/data/stations";

function names(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `Artist ${index}`);
}

function songsFor(artist: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    artist,
    title: `${artist} Song ${index}`,
    releaseYear: 1995,
  }));
}

describe("station shelf", () => {
  it("gives every catalog station a family", () => {
    for (const station of STATIONS) {
      expect(station.family, station.id).toBeTruthy();
    }
  });

  it("returns distinct country lanes from the Country chip", () => {
    const country = stationsInFamily(STATIONS, "Country");
    const titles = country.map((station) => station.name);
    expect(country.length).toBeGreaterThan(1);
    expect(country.length).toBeLessThanOrEqual(8);
    expect(titles).toEqual(
      expect.arrayContaining([
        "Country Gold",
        "Outlaw Country",
        "90s Country Radio",
        "Modern Country",
        "Americana & Songwriters",
      ]),
    );
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles.filter((title) => title === "Country Gold")).toHaveLength(1);
    const bluegrass = getStationById("bluegrass-roots");
    expect(bluegrass?.family).toBe("Folk & Americana");
  });

  it("narrows a decade to one family", () => {
    const rock = stationsInDecade(STATIONS, "70s", "Rock");
    expect(rock.length).toBeGreaterThan(0);
    expect(rock.every((station) => station.family === "Rock" && station.era === "70s")).toBe(true);
    expect(rock.some((station) => station.id === "70s-disco-funk")).toBe(false);
    const country = stationsInDecade(STATIONS, "90s", "Country");
    expect(country.map((station) => station.id)).toContain("90s-country-radio");
    expect(country.some((station) => station.id === "90s-hip-hop")).toBe(false);
    expect(stationsInDecade(STATIONS, "70s", null).some((station) => !station.era)).toBe(false);
  });

  it("points trap at the trap lane", () => {
    expect(tunerStationIdForLabel("Trap")).toBe("modern-trap");
    expect(tunerStationIdForLabel("Trap")).not.toBe("drum-and-bass");
    expect(tunerStationIdForLabel("Hair Metal")).toBe("80s-hair-metal");
    expect(tunerStationIdForLabel("East Coast Hip-Hop")).toBe("east-coast-hip-hop");
  });
});

describe("station hour", () => {
  it("drops a 2004 song and a song with no year on a 90s station", () => {
    const hour = composeStationHour({
      pool: ["Nas", "Wu-Tang Clan"],
      eraLock: "90s",
      rng: () => 0.2,
      songsFor: (artist) => [
        { artist, title: "Too Late", releaseYear: 2004 },
        { artist, title: "No Year" },
        { artist, title: "In the Decade", releaseYear: 1994 },
      ],
    });
    expect(hour.tracks.some((track) => track.title === "Too Late")).toBe(false);
    expect(hour.tracks.some((track) => track.title === "No Year")).toBe(false);
    expect(hour.tracks.some((track) => track.title === "In the Decade")).toBe(true);
  });

  it("builds 18 + 16 + 16 and counts the starter toward the cap of 3", () => {
    const pool = names(41);
    const starter = { artist: "Artist 0", title: "Artist 0 Song 0", releaseYear: 1995 };
    const hour = composeStationHour({
      pool,
      starter,
      eraLock: "all",
      rng: () => 0.17,
      songsFor,
    });
    expect(hour.counts.close).toBe(18);
    expect(hour.counts.peer).toBe(16);
    expect(hour.counts.deep).toBe(16);
    const byArtist = new Map<string, number>();
    for (const track of hour.tracks) {
      byArtist.set(track.artist, (byArtist.get(track.artist) ?? 0) + 1);
    }
    for (const count of byArtist.values()) expect(count).toBeLessThanOrEqual(3);
    const starterSongs = hour.tracks.filter((track) => track.artist === "Artist 0");
    expect(starterSongs.length).toBeGreaterThan(0);
    expect(starterSongs.length).toBeLessThanOrEqual(3);
    expect(starterSongs.some((track) => track.title === starter.title)).toBe(true);
    expect(hour.tracks[0]?.title).toBe(starter.title);
  });

  it("keeps 3 close names and moves the deep shelf on the second draw", () => {
    const pool = names(41);
    const first = composeStationHour({
      pool,
      eraLock: "all",
      rng: () => 0.2,
      songsFor,
    });
    const second = composeStationHour({
      pool,
      previous: {
        close: pool.slice(0, 3),
        peer: first.cast.peer,
        deep: pool.slice(25),
      },
      eraLock: "all",
      rng: () => 0.8,
      songsFor,
    });
    const kept = second.cast.close.filter((name) => pool.slice(0, 3).includes(name));
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThanOrEqual(3);
    expect(second.cast.deep.join("|")).not.toBe(pool.slice(25).join("|"));
  });

  it("does not call the model when the station pool is fresh", async () => {
    clearNeighborhoodPools();
    const station = getStationById("country-gold");
    expect(station).toBeTruthy();
    const pool = names(16).map((name) => ({ name }));
    rememberNeighborhoodPool(stationPoolKey(station!.id), pool, Date.now());
    const suggest = vi.fn(async () => ["Should Not Run"]);
    const launch = vi.fn(async () => ({
      tracks: [
        {
          youtubeId: "abcdefghijk",
          title: "Ring of Fire",
          artist: "Johnny Cash",
          releaseYear: 1963,
        },
      ] satisfies StationTrack[],
      tailPlan: [],
      cast: { close: ["Johnny Cash"], peer: [], deep: [] },
    }));
    const hour = await loadStationSceneHour({
      station: station!,
      suggest,
      launch,
    });
    expect(suggest).not.toHaveBeenCalled();
    expect(hour.poolFresh).toBe(true);
    expect(launch).toHaveBeenCalled();
    clearNeighborhoodPools();
  });

  it("still gives an artist search 8 songs", () => {
    expect(MIX_SEED_SONGS).toBe(8);
  });

  it("opens a 90s station on the dated hour, not one authored starter", async () => {
    clearNeighborhoodPools();
    const station = getStationById("britpop-invasion");
    expect(station).toBeTruthy();
    expect(station!.tracks[0]?.releaseYear).toBeUndefined();

    const artists = ["Oasis", "Blur", "Pulp", "Suede", "Supergrass", "Elastica"];
    const dated: StationTrack[] = artists.flatMap((artist, artistIndex) =>
      [0, 1, 2].map((songIndex) => ({
        youtubeId: `bpt${artistIndex}${songIndex}xxxxxx`.slice(0, 11),
        title: `${artist} Song ${songIndex}`,
        artist,
        releaseYear: 1994,
      })),
    );
    const beat1: StationTrack[] = [
      { youtubeId: "drop2004xxx", title: "Too Late", artist: "Oasis", releaseYear: 2004 },
      { youtubeId: "dropnoyearx", title: "No Year", artist: "Blur" },
      ...dated.slice(0, 8),
    ];
    const tailTracks = dated.slice(8);
    const hour = await loadStationSceneHour({
      station: station!,
      suggest: async () => artists,
      launch: async (input) => {
        if (input.beat === "2") {
          return {
            tracks: tailTracks,
            tailPlan: [],
            cast: { close: [], peer: [], deep: [] },
          };
        }
        return {
          tracks: beat1,
          tailPlan: tailTracks.map((track) => ({ artist: track.artist, title: track.title })),
          cast: {
            close: artists.slice(0, 2),
            peer: artists.slice(2, 4),
            deep: artists.slice(4),
          },
        };
      },
    });

    expect(hour.tracks.some((track) => track.title === "Too Late")).toBe(false);
    expect(hour.tracks.some((track) => track.title === "No Year")).toBe(false);
    expect(hour.tracks).toHaveLength(dated.length);
    const listen = queueForListen(hour.tracks);
    expect(listen.map((track) => track.title)).toEqual(hour.tracks.map((track) => track.title));
    expect(listen[0]?.title).not.toBe(station!.tracks[0]?.title);
    expect(listen.length).toBeGreaterThan(1);
    const counts = new Map<string, number>();
    for (const track of listen) counts.set(track.artist, (counts.get(track.artist) ?? 0) + 1);
    for (const count of counts.values()) expect(count).toBeLessThanOrEqual(3);
    expect(queueForListen([])).toEqual([]);
    clearNeighborhoodPools();
  });

  it("does not turn an empty lookup into one authored starter", async () => {
    clearNeighborhoodPools();
    const station = getStationById("country-gold");
    expect(station?.tracks[0]).toBeTruthy();
    const hour = await loadStationSceneHour({
      station: station!,
      suggest: async () => ["Johnny Cash"],
      launch: async () => ({
        tracks: [],
        tailPlan: [],
        cast: { close: [], peer: [], deep: [] },
      }),
    });
    expect(hour.tracks).toEqual([]);
    expect(queueForListen(hour.tracks)).toEqual([]);
    clearNeighborhoodPools();
  });

  it("treats an empty station-tracks body as a failed hour", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ tracks: [] }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const hour = await fetchCatalogSceneHour("britpop-invasion", "90s");
    expect(hour.ok).toBe(false);
    expect(queueForListen(hour.ok ? hour.tracks : [])).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe("station cards", () => {
  it("keeps the description and shows family and era chips", () => {
    const station = getStationById("90s-country-radio");
    expect(station).toBeTruthy();
    expect(catalogCardSubtitle(station!)).toBe(station!.description);
    expect(catalogCardSubtitle(station!)).not.toContain("—");
    expect(formatStationMetaTag(station!)).toBe("Country • 90s");
    const gold = getStationById("country-gold")!;
    expect(formatStationMetaTag(gold)).toBe("Country • All eras");
    expect(formatStationMetaTag(gold)).not.toContain("GOLD");
  });

  it("rotates sleeves by day, keeps an uploaded cover, and uses now-playing art on air", () => {
    const station = getStationById("country-gold")!;
    const sleeves = [
      "https://example.com/a.jpg",
      "https://example.com/b.jpg",
      "https://example.com/c.jpg",
    ];
    const first = pickDailySleeve(sleeves, station.id, 1);
    const second = pickDailySleeve(sleeves, station.id, 2);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
    const covered = { ...station, coverUrl: "https://example.com/uploaded.jpg" };
    expect(resolveCardArtwork({ station: covered, daySeed: 1, artPool: sleeves })).toBe(
      "https://example.com/uploaded.jpg",
    );
    expect(
      resolveCardArtwork({ station: covered, daySeed: 2, artPool: sleeves }),
    ).toBe("https://example.com/uploaded.jpg");
    expect(
      resolveCardArtwork({
        station,
        daySeed: 1,
        artPool: sleeves,
        isOnAir: true,
        nowPlayingArtwork: "https://example.com/now.jpg",
      }),
    ).toBe("https://example.com/now.jpg");
  });

  it("pins without starting playback, and a shared listen uses the scene hour", () => {
    const country = stationsInFamily(GENRE_STATIONS, "Country");
    const target = country[1] ?? country[0];
    expect(target).toBeTruthy();
    const pinned = togglePinStation(target!.id, []);
    expect(pinned[0]).toBe(target!.id);
    expect(sortStationsWithPinsFirst(country, pinned)[0]?.id).toBe(target!.id);
    const play = vi.fn();
    const toggle = vi.fn();
    onPinClick({ stopPropagation: () => undefined }, target!.id, toggle);
    expect(toggle).toHaveBeenCalledWith(target!.id);
    expect(play).not.toHaveBeenCalled();

    expect(isStationShareable("country-gold")).toBe(true);
    expect(getStationById("country-gold")).toBeTruthy();
    expect(isStationShareable("ai-curator-live")).toBe(false);
    const authored = (getStationById("country-gold")?.tracks ?? []).slice(0, 3);
    const scene: StationTrack[] = Array.from({ length: 12 }, (_, index) => ({
      youtubeId: `scene${index}xxxxx`,
      title: `Scene ${index}`,
      artist: `Artist ${index}`,
      releaseYear: 1978,
    }));
    const listen = queueForListen(scene);
    expect(listen).toHaveLength(scene.length);
    expect(listen).not.toEqual(authored);
    expect(listen[0]?.title).toBe("Scene 0");
  });
});

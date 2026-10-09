import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildArtistMixOpening, finalizeArtistRadioTracks } from "@/lib/artist-radio";
import {
  clearMixNeighborMemory,
  drawNeighborhood,
  formatMixNeighborParam,
  mergeMixNeighbors,
  mixOpensOnSeed,
  openOnPlayableSeed,
  parseMixNeighborParam,
  pinExactSongFirst,
  pinSeedArtistFirst,
  plannedMixCounts,
  recallMixNeighbors,
  rememberMixNeighbors,
  selectFreshNeighbors,
  weaveNeighborhood,
} from "@/lib/artist-mix";
import type { Ranked } from "@/lib/track-shuffle";
import type { StationTrack } from "@/data/stations";

function track(artist: string, title: string, extra?: Partial<StationTrack>): StationTrack {
  return {
    artist,
    title,
    youtubeId: title.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 11) || "abcdefghijk",
    ...extra,
  };
}

function ranked(
  artist: string,
  title: string,
  extra?: Partial<StationTrack> & { rank?: number; isPrimaryArtist?: boolean },
): Ranked<StationTrack> {
  const rank = extra?.rank ?? 0;
  const isPrimaryArtist = extra?.isPrimaryArtist ?? true;
  const row = track(artist, title, extra);
  return { item: row, rank, tier: 1, isPrimaryArtist };
}

const canPlay = (row: StationTrack) => Boolean(row.youtubeId?.trim());

describe("Artist Mix opener", () => {
  it("opens on the seed when a neighbor is listed first", () => {
    const ordered = pinSeedArtistFirst(
      [
        track("Love Battery", "Between the Eyes"),
        track("Nirvana", "Drain You"),
        track("Mudhoney", "Touch Me I'm Sick"),
      ],
      "Nirvana",
    );

    expect(ordered[0]?.artist).toBe("Nirvana");
    expect(ordered.map((row) => row.artist)).toEqual([
      "Nirvana",
      "Love Battery",
      "Mudhoney",
    ]);
    expect(mixOpensOnSeed(ordered, "Nirvana")).toBe(true);
  });

  it("does not let a neighbor preview take the opening slot", () => {
    const ordered = finalizeArtistRadioTracks(
      [
        track("Nirvana", "Smells Like Teen Spirit"),
        track("Love Battery", "Between the Eyes", { previewUrl: "https://preview.example/lb" }),
      ],
      "Nirvana",
    );

    expect(ordered[0]?.artist).toBe("Nirvana");
    expect(ordered[0]?.title).toBe("Smells Like Teen Spirit");
  });

  it("fails if queue[0] is not the seed when a neighbor is shuffled first", () => {
    const shuffled = openOnPlayableSeed(
      [
        track("Stone Temple Pilots", "Plush", { previewUrl: "https://preview.example/plush" }),
        track("Nirvana", "Drain You", { youtubeId: "" }),
        track("Nirvana", "Smells Like Teen Spirit", { youtubeId: "nirvana11111" }),
      ],
      "Nirvana",
      canPlay,
    );

    expect(shuffled[0]?.artist).toBe("Nirvana");
    expect(shuffled[0]?.title).toBe("Smells Like Teen Spirit");
    expect(shuffled.map((row) => row.title)).toEqual(["Smells Like Teen Spirit", "Plush"]);
  });

  it("does not let shuffle, preview, or first-playable open on a neighbor", () => {
    const ordered = buildArtistMixOpening(
      [
        ranked("Nirvana", "Drain You", { youtubeId: "", rank: 0 }),
        ranked("Nirvana", "Smells Like Teen Spirit", { youtubeId: "nirvana11111", rank: 9 }),
      ],
      [
        ranked("Stone Temple Pilots", "Plush", {
          previewUrl: "https://preview.example/plush",
          youtubeId: "plush1111111",
          rank: 0,
          isPrimaryArtist: false,
        }),
      ],
      "Nirvana",
      { rng: () => 0.99, isPlayable: canPlay },
    );

    expect(ordered[0]?.artist).toBe("Nirvana");
    expect(ordered[0]?.title).not.toBe("Plush");
    expect(ordered.findIndex((row) => row.title === "Plush")).toBeGreaterThan(0);
  });

  it("returns no queue when the only playable track is a neighbor", () => {
    const ordered = buildArtistMixOpening(
      [ranked("Nirvana", "Drain You", { youtubeId: "", rank: 0 })],
      [
        ranked("Stone Temple Pilots", "Plush", {
          previewUrl: "https://preview.example/plush",
          youtubeId: "plush1111111",
          rank: 0,
          isPrimaryArtist: false,
        }),
      ],
      "Nirvana",
      { rng: () => 0, isPlayable: canPlay },
    );

    expect(ordered).toEqual([]);
    expect(ordered[0]?.artist).not.toBe("Stone Temple Pilots");
  });

  it("keeps the exact picked song in front of a same-artist neighbor song", () => {
    const ordered = pinExactSongFirst(
      [
        track("The National", "Bloodbuzz Ohio"),
        track("The National", "Fake Empire"),
        track("Bon Iver", "Holocene"),
      ],
      "The National",
      "Fake Empire",
    );

    expect(ordered.map((row) => row.title)).toEqual([
      "Fake Empire",
      "Bloodbuzz Ohio",
      "Holocene",
    ]);
  });

  it("returns no queue when the picked song is missing", () => {
    const ordered = pinExactSongFirst(
      [track("Arcade Fire", "Wake Up"), track("The National", "Bloodbuzz Ohio")],
      "The National",
      "Fake Empire",
    );

    expect(ordered).toEqual([]);
  });

  it("plays a short mix of the seed when no neighbors came back", () => {
    const ordered = pinSeedArtistFirst([track("Nirvana", "Drain You")], "Nirvana");

    expect(ordered).toHaveLength(1);
    expect(ordered[0]?.artist).toBe("Nirvana");
    expect(mixOpensOnSeed(ordered, "Nirvana")).toBe(true);
  });
});

describe("Artist Mix replay", () => {
  it("asks for a new neighbor slice instead of reshuffling the last one", () => {
    clearMixNeighborMemory();
    const page = Array.from({ length: 20 }, (_, index) => `Neighbor ${index + 1}`);
    const first = selectFreshNeighbors(page, []);
    rememberMixNeighbors("Nirvana", first);

    const params = new URLSearchParams({ artist: "Nirvana", mode: "mixed" });
    const previous = mergeMixNeighbors(recallMixNeighbors("Nirvana"), []);
    const encoded = formatMixNeighborParam(previous);
    expect(encoded).not.toBe("");
    params.set("excludeNeighbors", encoded);

    const second = selectFreshNeighbors(page, parseMixNeighborParam(params.get("excludeNeighbors")));
    const shuffledFirst = [...first].reverse();

    expect(first).toHaveLength(12);
    expect(second).toEqual([
      "Neighbor 13",
      "Neighbor 14",
      "Neighbor 15",
      "Neighbor 16",
      "Neighbor 17",
      "Neighbor 18",
      "Neighbor 19",
      "Neighbor 20",
    ]);
    expect(new Set(second)).not.toEqual(new Set(first));
    expect(second).not.toEqual(shuffledFirst);
    expect(second.every((name) => page.includes(name))).toBe(true);
  });

  it("replays the short list when no other same-feel neighbor is left", () => {
    expect(selectFreshNeighbors(["Keane"], ["Keane"])).toEqual(["Keane"]);
  });

  it("does not refuse a thin mix in the artist-radio route", () => {
    const route = readFileSync(path.resolve("src/app/api/artist-radio/route.ts"), "utf8");
    const launch = readFileSync(path.resolve("src/lib/neighborhood-launch.ts"), "utf8");
    expect(route).not.toContain("Could not expand");
    expect(route).not.toContain("Could not find similar artists");
    expect(route).not.toContain("uniquePrimaryArtists");
    expect(launch).toContain("assembleMixNeighbors");
    expect(launch).toContain("drawNeighborhood");
    expect(launch).toContain("weaveNeighborhood");
    expect(launch).toContain("fetchLastFmTopTracks");
    expect(launch).toContain("MIX_SEED_SONGS");
    expect(launch).toContain("ARTIST_RADIO_PAYLOAD_SIZE");
    expect(launch).not.toContain("!trackIsSeedArtist");

    const queue = readFileSync(path.resolve("src/hooks/useStationQueue.ts"), "utf8");
    const mixStart = queue.indexOf("if (hasNeighbor)");
    const mixEnd = queue.indexOf("if (!seedName)", mixStart);
    const mixBody = queue.slice(mixStart, mixEnd);
    expect(mixBody).toContain("openOnPlayableSeed");
    expect(mixBody).toContain("keepOrder: true");
    expect(mixBody).not.toContain("rotateStarter");
    const curatorStart = queue.indexOf("if (isCuratorStation(stationIdRef.current))");
    const curatorBody = queue.slice(curatorStart, curatorStart + 400);
    expect(curatorBody).not.toContain("shuffle(");
  });
});

function rngFor(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe("neighborhood draw", () => {
  const pool = Array.from({ length: 40 }, (_, index) => `Artist ${index + 1}`);

  it("plans 8 seed songs plus 18, 16, and 8 from a full pool", () => {
    const cast = drawNeighborhood(pool, {}, rngFor(3));
    const counts = plannedMixCounts(cast);
    expect(cast.close).toHaveLength(6);
    expect(cast.peer).toHaveLength(8);
    expect(cast.deep).toHaveLength(8);
    expect(counts).toEqual({ seed: 8, close: 18, peer: 16, deep: 8, total: 50 });
    const used = new Set([...cast.close, ...cast.peer, ...cast.deep]);
    expect(used.size).toBe(22);
    expect([...used].every((name) => pool.includes(name))).toBe(true);
  });

  it("drops deep slots first on a short pool and does not invent names", () => {
    const short = pool.slice(0, 10);
    const cast = drawNeighborhood(short, {}, rngFor(4));
    expect(cast.deep).toEqual([]);
    expect(cast.peer).toEqual([]);
    expect(cast.close.length).toBeGreaterThan(0);
    expect(cast.close.length).toBeLessThanOrEqual(6);
    expect(cast.close.every((name) => short.includes(name))).toBe(true);
  });

  it("keeps exactly 3 close names, changes at least 4 neighbors, and does not always open on rank 1", () => {
    const first = drawNeighborhood(pool, {}, rngFor(8));
    const second = drawNeighborhood(
      pool,
      { close: first.close, peer: first.peer, deep: first.deep },
      rngFor(9),
    );
    const firstClose = new Set(first.close);
    const shared = second.close.filter((name) => firstClose.has(name));
    expect(shared).toHaveLength(3);

    const firstAll = new Set([...first.close, ...first.peer, ...first.deep]);
    const novel = [...second.close, ...second.peer, ...second.deep].filter((name) => !firstAll.has(name));
    expect(novel.length).toBeGreaterThanOrEqual(4);

    const rankOne = pool[0] ?? "";
    const included = Array.from({ length: 16 }, (_, index) =>
      drawNeighborhood(pool, {}, rngFor(index + 1)).close.includes(rankOne),
    );
    expect(included.some((hit) => hit)).toBe(true);
    expect(included.some((hit) => !hit)).toBe(true);
  });
});

describe("neighborhood weave", () => {
  it("opens on the pin, keeps the seed songs, and does not play one artist twice in a row", () => {
    const close = Array.from({ length: 6 }, (_, index) => ({
      artist: `Close ${index + 1}`,
      titles: ["One", "Two", "Three"],
    }));
    const peer = Array.from({ length: 8 }, (_, index) => ({
      artist: `Peer ${index + 1}`,
      titles: ["One", "Two"],
    }));
    const deep = Array.from({ length: 8 }, (_, index) => ({
      artist: `Deep ${index + 1}`,
      titles: ["One"],
    }));
    const seedTitles = ["Pin", "S2", "S3", "S4", "S5", "S6", "S7", "S8"];
    const woven = weaveNeighborhood({
      seedArtist: "The National",
      seedSongs: seedTitles.map((title) => ({ title })),
      close,
      peer,
      deep,
    });

    expect(woven[0]).toEqual({ artist: "The National", title: "Pin" });
    const seedSongs = woven.filter((song) => song.artist === "The National");
    expect(seedSongs).toHaveLength(8);
    expect(seedSongs.map((song) => song.title)).toEqual(expect.arrayContaining(seedTitles));
    for (let index = 1; index < woven.length; index += 1) {
      expect(woven[index]?.artist).not.toBe(woven[index - 1]?.artist);
    }
    const closeOne = woven
      .map((song, index) => (song.artist === "Close 1" ? index : -1))
      .filter((index) => index >= 0);
    expect(closeOne.length).toBeGreaterThan(1);
    for (let index = 1; index < closeOne.length; index += 1) {
      expect((closeOne[index] ?? 0) - (closeOne[index - 1] ?? 0)).toBeGreaterThan(1);
    }
    expect(mixOpensOnSeed(woven, "The National")).toBe(true);
  });
});

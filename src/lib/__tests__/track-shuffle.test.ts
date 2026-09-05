import { describe, expect, it } from "vitest";
import type { StationTrack } from "@/data/stations";
import {
  buildOrderedStationQueue,
  isPlayableStationTrack,
  orderQueue,
  repairArtistAdjacency,
  selectStarter,
  splitTiers,
  stationTrackIdentity,
  TIER_1_SIZE,
  toRanked,
  weightedSample,
  type RankedTrack,
} from "../track-shuffle";

function track(title: string, artist: string, overrides?: Partial<StationTrack>): StationTrack {
  return {
    youtubeId: `yt-${title.toLowerCase().replace(/\s+/g, "-")}`,
    title,
    artist,
    ...overrides,
  };
}

/**
 * Deterministic LCG so weighted draws are reproducible across runs. Warmed up
 * because consecutive small seeds otherwise produce highly correlated first draws.
 */
function seededRng(seed: number): () => number {
  let state = (seed * 2654435761) >>> 0;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  for (let i = 0; i < 10; i++) next();
  return next;
}

function rankedCatalog(size: number, artist = "The National"): RankedTrack[] {
  return splitTiers(
    Array.from({ length: size }, (_, index) => ({
      item: track(`Song ${index}`, artist),
      rank: index,
      tier: 1 as const,
      isPrimaryArtist: true,
    })),
  );
}

describe("isPlayableStationTrack", () => {
  it("accepts YouTube or a licensed stream, not a 30-second preview", () => {
    expect(isPlayableStationTrack(track("Full", "A"))).toBe(true);
    expect(
      isPlayableStationTrack({
        youtubeId: "",
        title: "Licensed",
        artist: "A",
        streamUrl: "https://cdn.example/full.mp3",
      }),
    ).toBe(true);
    expect(
      isPlayableStationTrack({
        youtubeId: "",
        title: "Clip",
        artist: "A",
        previewUrl: "https://preview.example/clip.m4a",
      }),
    ).toBe(false);
  });
});

describe("splitTiers", () => {
  it("assigns the top 10 primary-artist ranks to tier 1", () => {
    const tiered = rankedCatalog(30);

    expect(tiered.filter((entry) => entry.tier === 1)).toHaveLength(TIER_1_SIZE);
    expect(tiered.slice(0, TIER_1_SIZE).every((entry) => entry.tier === 1)).toBe(true);
    expect(tiered.slice(TIER_1_SIZE).every((entry) => entry.tier === 2)).toBe(true);
  });

  it("keeps similar-artist tracks out of tier 1 regardless of rank", () => {
    const tiered = splitTiers([
      { item: track("Guest Hit", "Interpol"), rank: 0, tier: 1, isPrimaryArtist: false },
    ]);

    expect(tiered[0].tier).toBe(2);
  });

  it("treats Infinity-rank deep cuts as tier 2", () => {
    const tiered = splitTiers([
      { item: track("B Side", "The National"), rank: Infinity, tier: 1, isPrimaryArtist: true },
    ]);

    expect(tiered[0].tier).toBe(2);
  });
});

describe("selectStarter", () => {
  it("always draws from tier 1", () => {
    const catalog = rankedCatalog(50);

    for (let seed = 1; seed <= 200; seed++) {
      const starter = selectStarter(catalog, seededRng(seed));
      expect(starter?.tier).toBe(1);
      expect(starter?.rank).toBeLessThan(TIER_1_SIZE);
    }
  });

  it("spreads openers across tier 1 instead of locking onto the #1 hit", () => {
    const catalog = rankedCatalog(50);
    const counts = new Map<string, number>();
    const rng = seededRng(42);

    for (let run = 0; run < 500; run++) {
      const starter = selectStarter(catalog, rng);
      const title = starter?.item.title ?? "none";
      counts.set(title, (counts.get(title) ?? 0) + 1);
    }

    // The regression this engine fixes: one title winning every single launch.
    expect(counts.size).toBeGreaterThanOrEqual(8);
    expect(Math.max(...counts.values())).toBeLessThan(500 * 0.35);
    expect(counts.get("Song 0") ?? 0).toBeGreaterThan(0);
  });

  it("favors more popular ranks on average", () => {
    const catalog = rankedCatalog(50);
    const rng = seededRng(7);
    let topThree = 0;

    for (let run = 0; run < 500; run++) {
      const starter = selectStarter(catalog, rng);
      if ((starter?.rank ?? Infinity) < 3) topThree += 1;
    }

    // Uniform selection over tier 1 would land near 3/10.
    expect(topThree / 500).toBeGreaterThan(3 / TIER_1_SIZE);
  });

  it("avoids the previous session's opener when alternatives exist", () => {
    const catalog = rankedCatalog(50);
    const avoid = new Set([stationTrackIdentity(catalog[0].item)]);

    for (let seed = 1; seed <= 100; seed++) {
      const starter = selectStarter(catalog, seededRng(seed), {
        avoidIds: avoid,
        identify: stationTrackIdentity,
      });
      expect(starter?.item.title).not.toBe("Song 0");
    }
  });

  it("prefers playable candidates", () => {
    const catalog = splitTiers([
      { item: { youtubeId: "", title: "Unplayable", artist: "A" }, rank: 0, tier: 1 as const, isPrimaryArtist: true },
      { item: track("Playable", "B"), rank: 1, tier: 1 as const, isPrimaryArtist: true },
    ]);

    for (let seed = 1; seed <= 50; seed++) {
      const starter = selectStarter(catalog, seededRng(seed), {
        isPlayable: isPlayableStationTrack,
      });
      expect(starter?.item.title).toBe("Playable");
    }
  });

  it("returns undefined for an empty pool", () => {
    expect(selectStarter([], seededRng(1))).toBeUndefined();
  });
});

describe("weightedSample", () => {
  it("falls back to a uniform pick when every weight is zero", () => {
    const deepCuts = splitTiers(
      Array.from({ length: 5 }, (_, index) => ({
        item: track(`Deep ${index}`, "The National"),
        rank: Infinity,
        tier: 2 as const,
        isPrimaryArtist: true,
      })),
    );

    const picked = new Set<string>();
    const rng = seededRng(3);
    for (let run = 0; run < 100; run++) {
      picked.add(weightedSample(deepCuts, rng)?.item.title ?? "none");
    }

    expect(picked.size).toBeGreaterThan(1);
    expect(picked.has("none")).toBe(false);
  });
});

describe("orderQueue", () => {
  it("preserves length and loses no tracks", () => {
    const catalog = rankedCatalog(60);

    for (let seed = 1; seed <= 50; seed++) {
      const ordered = orderQueue(catalog, seededRng(seed));
      expect(ordered).toHaveLength(catalog.length);
      expect(new Set(ordered.map((entry) => entry.item.title)).size).toBe(catalog.length);
    }
  });

  it("clusters hits earlier than deep cuts on average", () => {
    const mixed = splitTiers([
      ...Array.from({ length: 10 }, (_, index) => ({
        item: track(`Hit ${index}`, "The National"),
        rank: index,
        tier: 1 as const,
        isPrimaryArtist: true,
      })),
      ...Array.from({ length: 40 }, (_, index) => ({
        item: track(`Cut ${index}`, "The National"),
        rank: Infinity,
        tier: 2 as const,
        isPrimaryArtist: true,
      })),
    ]);

    let hitPositionTotal = 0;
    const runs = 100;

    for (let seed = 1; seed <= runs; seed++) {
      const ordered = orderQueue(mixed, seededRng(seed));
      const positions = ordered
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.item.title.startsWith("Hit "))
        .map(({ index }) => index);
      hitPositionTotal += positions.reduce((a, b) => a + b, 0) / positions.length;
    }

    // Uniform shuffle would average ~24.5 across 50 slots.
    expect(hitPositionTotal / runs).toBeLessThan(20);
  });

  it("handles an empty pool", () => {
    expect(orderQueue([], seededRng(1))).toEqual([]);
  });
});

describe("repairArtistAdjacency", () => {
  it("removes back-to-back tracks by the same artist", () => {
    const repaired = repairArtistAdjacency([
      track("A1", "Alpha"),
      track("A2", "Alpha"),
      track("B1", "Beta"),
      track("C1", "Gamma"),
    ]);

    for (let i = 1; i < repaired.length; i++) {
      expect(repaired[i].artist).not.toBe(repaired[i - 1].artist);
    }
  });

  it("treats 'The X' and 'X' as the same artist", () => {
    const repaired = repairArtistAdjacency([
      track("A1", "The National"),
      track("A2", "National"),
      track("B1", "Interpol"),
    ]);

    expect(repaired[1].artist).toBe("Interpol");
  });

  it("never moves the starter out of slot 0", () => {
    const repaired = repairArtistAdjacency([
      track("Opener", "Alpha"),
      track("A2", "Alpha"),
      track("B1", "Beta"),
    ]);

    expect(repaired[0].title).toBe("Opener");
  });

  it("passes single-artist playlists through unchanged", () => {
    const input = [track("A1", "Alpha"), track("A2", "Alpha"), track("A3", "Alpha")];
    const repaired = repairArtistAdjacency(input);

    expect(repaired.map((t) => t.title)).toEqual(["A1", "A2", "A3"]);
  });

  it("preserves length and contents", () => {
    const input = [
      track("A1", "Alpha"),
      track("A2", "Alpha"),
      track("B1", "Beta"),
      track("B2", "Beta"),
      track("C1", "Gamma"),
    ];
    const repaired = repairArtistAdjacency(input);

    expect(repaired).toHaveLength(input.length);
    expect(new Set(repaired.map((t) => t.title))).toEqual(new Set(input.map((t) => t.title)));
  });

  it("handles empty and single-item inputs", () => {
    expect(repairArtistAdjacency([])).toEqual([]);
    expect(repairArtistAdjacency([track("Solo", "Alpha")])).toHaveLength(1);
  });
});

describe("buildOrderedStationQueue", () => {
  it("preserves length when no payload cap is set", () => {
    const catalog = rankedCatalog(40);

    for (let seed = 1; seed <= 25; seed++) {
      const ordered = buildOrderedStationQueue(catalog, { rng: seededRng(seed) });
      expect(ordered).toHaveLength(catalog.length);
      expect(new Set(ordered.map((t) => t.title)).size).toBe(catalog.length);
    }
  });

  it("trims to the payload size with the starter intact", () => {
    const catalog = rankedCatalog(100);
    const ordered = buildOrderedStationQueue(catalog, { rng: seededRng(7), payloadSize: 30 });

    expect(ordered).toHaveLength(30);
    expect(ordered[0].artist).toBe("The National");
  });

  it("opens on a tier 1 hit across many seeds", () => {
    const catalog = rankedCatalog(60);
    const tier1Titles = new Set(
      catalog.filter((entry) => entry.tier === 1).map((entry) => entry.item.title),
    );

    for (let seed = 1; seed <= 100; seed++) {
      const ordered = buildOrderedStationQueue(catalog, { rng: seededRng(seed) });
      expect(tier1Titles.has(ordered[0].title)).toBe(true);
    }
  });

  it("produces a different opening track across launches", () => {
    const catalog = rankedCatalog(60);
    const openers = new Set<string>();
    const rng = seededRng(11);

    for (let run = 0; run < 100; run++) {
      openers.add(buildOrderedStationQueue(catalog, { rng })[0].title);
    }

    expect(openers.size).toBeGreaterThanOrEqual(5);
  });

  it("enforces artist adjacency on a multi-artist pool", () => {
    const artists = ["Alpha", "Beta", "Gamma", "Delta"];
    const catalog = splitTiers(
      Array.from({ length: 40 }, (_, index) => ({
        item: track(`Song ${index}`, artists[index % artists.length]),
        rank: index,
        tier: 1 as const,
        isPrimaryArtist: true,
      })),
    );

    for (let seed = 1; seed <= 50; seed++) {
      const ordered = buildOrderedStationQueue(catalog, { rng: seededRng(seed) });
      for (let i = 1; i < ordered.length; i++) {
        expect(ordered[i].artist).not.toBe(ordered[i - 1].artist);
      }
    }
  });

  it("returns an empty array for an empty pool", () => {
    expect(buildOrderedStationQueue([], { rng: seededRng(1) })).toEqual([]);
  });
});

describe("toRanked", () => {
  it("wraps plain tracks using position as the rank proxy", () => {
    const ranked = toRanked([track("A", "Alpha"), track("B", "Beta")]);

    expect(ranked.map((entry) => entry.rank)).toEqual([0, 1]);
    expect(ranked.every((entry) => entry.tier === 1)).toBe(true);
  });
});

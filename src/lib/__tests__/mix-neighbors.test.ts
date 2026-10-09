import { afterEach, describe, expect, it, vi } from "vitest";
import { MIX_SEED_SONGS, type MixPoolName } from "@/lib/artist-mix";
import {
  MIX_NEIGHBOR_MODEL,
  MIX_NEIGHBOR_SYSTEM_PROMPT,
  MIX_NEIGHBOR_TEMPERATURE,
  assembleMixNeighbors,
  catalogNameKeepable,
  clearNeighborhoodPools,
  mixNeighborUserPrompt,
  parseSuggestedNeighborNames,
  promoteSupportedWithinBands,
  seedWorldFromSongs,
  spreadNeighborTake,
  suggestNeighborArtists,
  takeStreamName,
  type CatalogSong,
} from "@/lib/mix-neighbors";

const LAST_FM_HEAD = [
  { name: "Arcade Fire", match: 0.91 },
  { name: "The War on Drugs", match: 0.84 },
  { name: "EL VY", match: 0.62 },
  { name: "Matt Berninger", match: 0.55 },
  { name: "Frightened Rabbit", match: 0.48 },
];

const WIDER_RING = [
  "Local Natives",
  "The Walkmen",
  "Grizzly Bear",
  "Fleet Foxes",
  "The Antlers",
  "Wye Oak",
  "Okkervil River",
  "Phosphorescent",
  "The Tallest Man on Earth",
  "Menomena",
  "Wolf Parade",
  "Spoon",
  "Iron & Wine",
  "Band of Horses",
  "Sharon Van Etten",
  "Manchester Orchestra",
  "The Decemberists",
  "Wilco",
  "Big Thief",
  "Japanese Breakfast",
  "Alvvays",
  "Soccer Mommy",
  "Snail Mail",
  "Lucy Dacus",
];

function nationalSong(title: string, year: number, genre = "Alternative"): CatalogSong {
  return {
    artist: "The National",
    title,
    primaryGenreName: genre,
    releaseYear: year,
    durationMs: 220_000,
  };
}

function names(pool: readonly MixPoolName[]): string[] {
  return pool.map((entry) => entry.name);
}

describe("parseSuggestedNeighborNames", () => {
  it("keeps a plain list and drops the seed, titles, and junk", () => {
    const raw = [
      "Local Natives",
      "The National",
      "Not a song title - Fake Track",
      "http://example.com",
      "",
      "1. Spoon",
      "- Grizzly Bear",
      "Spoon",
      "Here is a sentence about the band.",
    ].join("\n");

    expect(parseSuggestedNeighborNames(raw, "The National")).toEqual([
      "Local Natives",
      "Spoon",
      "Grizzly Bear",
    ]);
  });

  it("still reads a JSON list when the model sends one", () => {
    const raw = JSON.stringify({
      artists: ["Local Natives", "The National", "Spoon"],
    });
    expect(parseSuggestedNeighborNames(raw, "The National")).toEqual(["Local Natives", "Spoon"]);
  });

  it("returns nothing for a story instead of a list", () => {
    expect(parseSuggestedNeighborNames("Here are some artists you might like.", "The National")).toEqual(
      [],
    );
  });

  it("reads one streamed line and drops the seed", () => {
    const seen = new Set<string>();
    expect(takeStreamName("1. Local Natives", "The National", seen)).toBe("Local Natives");
    expect(takeStreamName("The National", "The National", seen)).toBeNull();
    expect(takeStreamName("Local Natives", "The National", seen)).toBeNull();
    expect(takeStreamName("Not a song - Fake", "The National", seen)).toBeNull();
  });
});

describe("catalog world", () => {
  const world = seedWorldFromSongs(
    [nationalSong("Bloodbuzz Ohio", 2010), nationalSong("I Need My Girl", 2013)],
    "The National",
  );

  it("drops a hip-hop primary genre for an alternative seed and keeps a missing genre", () => {
    expect(
      catalogNameKeepable(
        [
          {
            artist: "Drake",
            title: "Hotline Bling",
            primaryGenreName: "Hip-Hop/Rap",
            releaseYear: 2015,
            durationMs: 200_000,
          },
        ],
        "Drake",
        world,
      ),
    ).toBe(false);

    expect(
      catalogNameKeepable(
        [
          {
            artist: "Fleet Foxes",
            title: "Mykonos",
            durationMs: 200_000,
          },
        ],
        "Fleet Foxes",
        world,
      ),
    ).toBe(true);
  });

  it("keeps a 1997 song for a later alternative seed", () => {
    const later = seedWorldFromSongs([nationalSong("Bloodbuzz Ohio", 2011)], "The National");
    expect(
      catalogNameKeepable(
        [
          {
            artist: "Nick Cave & The Bad Seeds",
            title: "Into My Arms",
            primaryGenreName: "Alternative",
            releaseYear: 1997,
            durationMs: 200_000,
          },
        ],
        "Nick Cave & The Bad Seeds",
        later,
      ),
    ).toBe(true);
  });
});

describe("suggestNeighborArtists", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns nothing when OpenAI is not configured", async () => {
    const fetchImpl = vi.fn();
    const names = await suggestNeighborArtists("The National", [], {
      fetchImpl,
      apiKey: "",
    });
    expect(names).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("asks gpt-4o to judge Last.fm evidence and does not keep the seed", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: ["Local Natives", "The National", "The Walkmen *"].join("\n"),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const lastFm = [{ name: "Arcade Fire", match: 0.82 }];
    const names = await suggestNeighborArtists("The National", ["Arcade Fire"], {
      fetchImpl,
      apiKey: "test-key",
      lastFm,
    });

    expect(names).toEqual(["Local Natives", "The Walkmen"]);
    const call = fetchImpl.mock.calls[0] as unknown[] | undefined;
    const init = call?.[1] as { body?: string } | undefined;
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe(MIX_NEIGHBOR_MODEL);
    expect(body.model).toBe("gpt-4o");
    expect(body.temperature).toBe(MIX_NEIGHBOR_TEMPERATURE);
    expect(body.temperature).toBe(0.4);
    expect(body.response_format).toBeUndefined();
    expect(body.messages[0].content).toBe(MIX_NEIGHBOR_SYSTEM_PROMPT);
    expect(body.messages[0].content).toContain("Timbre and vocal (25%)");
    expect(body.messages[0].content).toContain("Rhythm and arrangement (25%)");
    expect(body.messages[0].content).toContain("Lyrics and ideas (20%)");
    expect(body.messages[0].content).toContain("Ecosystem (20%)");
    expect(body.messages[0].content).toContain("Quality (10%)");
    expect(body.messages[0].content).toContain("Example of the judgment, not a list to reuse");
    expect(body.messages[0].content).toContain("The National");
    expect(body.messages[0].content).toContain("Last.fm");
    expect(body.messages[0].content.toLowerCase()).not.toContain(
      "do not fill the list with side projects",
    );
    expect(body.messages[1].content).toBe(
      mixNeighborUserPrompt("The National", ["Arcade Fire"], lastFm),
    );
    expect(body.messages[1].content).toContain("Arcade Fire (match 0.82)");
    expect(body.messages[1].content).toContain("Avoid list");
    expect(body.messages[1].content).toContain("The National");
  });
});

describe("assembleMixNeighbors", () => {
  afterEach(() => {
    clearNeighborhoodPools();
  });

  const keepReal = async (incoming: readonly string[]) =>
    incoming.filter((name) => name !== "Not A Real Band" && name !== "Drake");

  it("keeps the model order and does not pad a full list with Last.fm", async () => {
    const backup = vi.fn(async () => LAST_FM_HEAD);
    const pool = await assembleMixNeighbors("The National", [], {
      suggest: async () => WIDER_RING,
      backup,
      verify: keepReal,
    });

    expect(backup).not.toHaveBeenCalled();
    expect(names(pool)).toEqual(WIDER_RING);
    expect(names(pool)).not.toEqual(WIDER_RING.slice(0, 12));
  });

  it("moves a supported Last.fm name up inside its band only", () => {
    const scores = new Map<string, number>([["walkmen", 0.8]]);
    const ordered = promoteSupportedWithinBands(
      ["Local Natives", "The Walkmen", "Grizzly Bear"],
      scores,
    );
    expect(ordered[0]).toBe("The Walkmen");
    expect(ordered).toContain("Local Natives");
    expect(ordered).toContain("Grizzly Bear");
  });

  it("passes the avoid list through and does not ban those names from the pool", async () => {
    const suggest = vi.fn(async (_seed: string, avoid: readonly string[]) => {
      void avoid;
      return WIDER_RING;
    });
    const pool = await assembleMixNeighbors("The National", ["Local Natives", "Spoon"], {
      suggest,
      verify: keepReal,
    });

    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest.mock.calls[0]?.[1]).toEqual(["Local Natives", "Spoon"]);
    expect(names(pool)).toContain("Local Natives");
    expect(names(pool)).toContain("Spoon");
  });

  it("does not pad a short model list with the old four-name backup", async () => {
    const backup = vi.fn(async () => LAST_FM_HEAD);
    const pool = await assembleMixNeighbors("The National", [], {
      suggest: async () => ["Local Natives", "Drake", "Not A Real Band"],
      backup,
      verify: keepReal,
    });

    expect(backup).not.toHaveBeenCalled();
    expect(names(pool)).toEqual(["Local Natives"]);
  });

  it("falls back to Last.fm when the model returns nothing", async () => {
    const pool = await assembleMixNeighbors("The National", [], {
      suggest: async () => [],
      backup: async () => LAST_FM_HEAD,
      anchors: async () => ["Wilco"],
      verify: keepReal,
    });

    expect(names(pool)).toEqual([
      "Arcade Fire",
      "The War on Drugs",
      "EL VY",
      "Matt Berninger",
      "Frightened Rabbit",
      "Wilco",
    ]);
  });

  it("does not wait out a slow model", async () => {
    const started = Date.now();
    const pool = await assembleMixNeighbors("The National", [], {
      budgetMs: 120,
      modelBudgetMs: 40,
      suggest: (_seed, _avoid, ctx) =>
        new Promise((resolve) => {
          const timer = setTimeout(() => resolve(["Slow Band"]), 5_000);
          ctx?.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve([]);
          });
        }),
      backup: async () => ["Keane"],
      anchors: async () => [],
      verify: async (incoming) => [...incoming],
    });

    expect(Date.now() - started).toBeLessThan(1000);
    expect(names(pool)).toEqual(["Keane"]);
  });

  it("spreads a long list when a caller asks, and the live path does not", () => {
    const source = WIDER_RING;
    const taken = spreadNeighborTake(source, 12);
    expect(taken).toHaveLength(12);
    expect(taken[0]).toBe(source[0]);
    expect(source.indexOf(taken[taken.length - 1] ?? "")).toBeGreaterThan(12);
  });
});

describe("Artist Mix seed slot", () => {
  it("plans eight seed songs on a wide station", () => {
    expect(MIX_SEED_SONGS).toBe(8);
  });
});

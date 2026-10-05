import { afterEach, describe, expect, it, vi } from "vitest";
import { MIX_NEIGHBOR_TAKE, MIX_SEED_SONGS } from "@/lib/artist-mix";
import {
  MIX_BACKUP_CAP,
  MIX_NEIGHBOR_MODEL,
  MIX_NEIGHBOR_SYSTEM_PROMPT,
  assembleMixNeighbors,
  catalogSongsFitWorld,
  mixNeighborUserPrompt,
  parseSuggestedNeighborNames,
  seedWorldFromSongs,
  spreadNeighborTake,
  suggestNeighborArtists,
  takeStreamName,
  type CatalogSong,
} from "@/lib/mix-neighbors";

const LAST_FM_HEAD = [
  "Arcade Fire",
  "The War on Drugs",
  "EL VY",
  "Matt Berninger",
  "Frightened Rabbit",
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

function nationalSong(title: string, year: number): CatalogSong {
  return {
    artist: "The National",
    title,
    primaryGenreName: "Alternative",
    releaseYear: year,
    durationMs: 220_000,
  };
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

  it("keeps a same-era neighbor and drops a different world or a different era", () => {
    expect(
      catalogSongsFitWorld(
        [
          {
            artist: "Fleet Foxes",
            title: "Mykonos",
            primaryGenreName: "Alternative",
            releaseYear: 2008,
            durationMs: 200_000,
          },
        ],
        "Fleet Foxes",
        world,
      ),
    ).toBe(true);

    expect(
      catalogSongsFitWorld(
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
      catalogSongsFitWorld(
        [
          {
            artist: "The Beatles",
            title: "Hey Jude",
            primaryGenreName: "Rock",
            releaseYear: 1968,
            durationMs: 200_000,
          },
        ],
        "The Beatles",
        world,
      ),
    ).toBe(false);

    expect(catalogSongsFitWorld([], "Fleet Foxes", world)).toBe(false);
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

  it("asks the existing model for a plain list and does not keep the seed", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: ["Local Natives", "The National", "The Walkmen"].join("\n"),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const names = await suggestNeighborArtists("The National", ["Arcade Fire"], {
      fetchImpl,
      apiKey: "test-key",
    });

    expect(names).toEqual(["Local Natives", "The Walkmen"]);
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.model).toBe(MIX_NEIGHBOR_MODEL);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.response_format).toBeUndefined();
    expect(body.messages[0].content).toBe(MIX_NEIGHBOR_SYSTEM_PROMPT);
    expect(body.messages[0].content).toContain("one artist name per line");
    expect(body.messages[0].content).toContain("Never invent a name");
    expect(body.messages[0].content).toContain("20 to 30");
    expect(body.messages[1].content).toBe(mixNeighborUserPrompt("The National", ["Arcade Fire"]));
    expect(body.messages[1].content).toContain("Arcade Fire");
    expect(body.messages[1].content).toContain("The National");
  });
});

describe("assembleMixNeighbors", () => {
  const keepReal = async (names: readonly string[]) =>
    names.filter((name) => name !== "Not A Real Band" && name !== "Drake");

  it("plays the model list and does not lead with the Last.fm circle", async () => {
    const backup = vi.fn(async () => LAST_FM_HEAD);
    const pool = await assembleMixNeighbors("The National", [], {
      suggest: async () => WIDER_RING,
      backup,
      verify: keepReal,
    });

    expect(backup).not.toHaveBeenCalled();
    expect(pool).toHaveLength(MIX_NEIGHBOR_TAKE);
    expect(pool.some((name) => LAST_FM_HEAD.includes(name))).toBe(false);
    expect(pool).not.toEqual(WIDER_RING.slice(0, MIX_NEIGHBOR_TAKE));
    expect(pool).toContain("Snail Mail");
    expect(pool).toContain("Local Natives");
  });

  it("runs a new model pass and prefers neighbors that were not just used", async () => {
    const suggest = vi.fn(async (_seed: string, avoid: readonly string[]) =>
      WIDER_RING.filter((name) => !avoid.includes(name)),
    );
    const backup = vi.fn(async () => LAST_FM_HEAD);

    const first = await assembleMixNeighbors("The National", [], {
      suggest,
      backup,
      verify: keepReal,
    });
    const second = await assembleMixNeighbors("The National", first, {
      suggest,
      backup,
      verify: keepReal,
    });

    expect(suggest).toHaveBeenCalledTimes(2);
    expect(suggest.mock.calls[1]?.[1]).toEqual(first);
    expect(second.length).toBeGreaterThan(0);
    expect(second.every((name) => !first.includes(name))).toBe(true);
    expect(second.some((name) => LAST_FM_HEAD.includes(name))).toBe(false);
    expect(second).not.toEqual([...first].reverse());
    expect(backup).not.toHaveBeenCalled();
  });

  it("adds only a small Last.fm backup when the model keeps too few names", async () => {
    const pool = await assembleMixNeighbors("The National", [], {
      suggest: async () => ["Local Natives", "Drake", "Not A Real Band"],
      backup: async () => [...LAST_FM_HEAD, "Spoon", "Wilco"],
      verify: keepReal,
    });

    expect(pool[0]).toBe("Local Natives");
    expect(pool.slice(1)).toEqual(LAST_FM_HEAD.slice(0, MIX_BACKUP_CAP));
    expect(pool).not.toContain("Drake");
    expect(pool).not.toContain("Not A Real Band");
    expect(pool.filter((name) => LAST_FM_HEAD.includes(name))).toHaveLength(MIX_BACKUP_CAP);
  });

  it("does not pad a usable model name with neighbors that were just played", async () => {
    const pool = await assembleMixNeighbors("The National", LAST_FM_HEAD, {
      suggest: async () => ["Local Natives"],
      backup: async () => LAST_FM_HEAD,
      verify: keepReal,
    });

    expect(pool).toEqual(["Local Natives"]);
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
      verify: async (names) => [...names],
    });

    expect(Date.now() - started).toBeLessThan(1000);
    expect(pool).toEqual(["Keane"]);
  });

  it("spreads a long list instead of keeping only its head", () => {
    const taken = spreadNeighborTake(WIDER_RING, MIX_NEIGHBOR_TAKE);
    expect(taken).toHaveLength(MIX_NEIGHBOR_TAKE);
    expect(taken).not.toEqual(WIDER_RING.slice(0, MIX_NEIGHBOR_TAKE));
    expect(taken[0]).toBe(WIDER_RING[0]);
    expect(WIDER_RING.indexOf(taken[taken.length - 1] ?? "")).toBeGreaterThan(MIX_NEIGHBOR_TAKE);
  });
});

describe("Artist Mix seed slot", () => {
  it("keeps the opener to one seed song", () => {
    expect(MIX_SEED_SONGS).toBe(1);
  });
});

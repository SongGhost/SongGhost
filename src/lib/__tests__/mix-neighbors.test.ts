import { afterEach, describe, expect, it, vi } from "vitest";
import { MIX_NEIGHBOR_TAKE, MIX_SEED_SONGS, selectFreshNeighbors } from "@/lib/artist-mix";
import {
  assembleMixNeighbors,
  interleaveNeighborNames,
  parseSuggestedNeighborNames,
  suggestNeighborArtists,
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
];

describe("parseSuggestedNeighborNames", () => {
  it("keeps artist names and drops the seed, titles, and junk", () => {
    const raw = JSON.stringify({
      artists: [
        "Local Natives",
        "The National",
        "Not a song title - Fake Track",
        "http://example.com",
        "",
        "Spoon",
        "Spoon",
        12,
      ],
    });

    expect(parseSuggestedNeighborNames(raw, "The National")).toEqual(["Local Natives", "Spoon"]);
  });

  it("returns nothing when the model did not send JSON", () => {
    expect(parseSuggestedNeighborNames("Arcade Fire, Spoon", "The National")).toEqual([]);
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

  it("asks for a new name list and does not keep the seed", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  artists: ["Local Natives", "The National", "The Walkmen"],
                }),
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
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages[1].content).toContain("Arcade Fire");
    expect(body.messages[1].content).toContain("The National");
  });
});

describe("assembleMixNeighbors", () => {
  it("opens a wider pool than Last.fm's head, then shifts on the next pass", async () => {
    const seenAvoid: string[][] = [];
    const pool = await assembleMixNeighbors("The National", [], {
      fetchLastFm: async () => LAST_FM_HEAD,
      suggest: async (_seed, avoid) => {
        seenAvoid.push([...avoid]);
        return [...WIDER_RING, "Not A Real Band", "Drake"];
      },
      verifyCatalog: async (names) => names.filter((name) => name !== "Not A Real Band"),
      filterFeel: async (_seed, names) => names.filter((name) => name !== "Drake"),
    });

    const first = selectFreshNeighbors(pool, []);
    const second = selectFreshNeighbors(pool, first);

    expect(seenAvoid).toEqual([[]]);
    expect(pool.length).toBe(LAST_FM_HEAD.length + WIDER_RING.length);
    expect(first).toHaveLength(MIX_NEIGHBOR_TAKE);
    expect(first.filter((name) => !LAST_FM_HEAD.includes(name)).length).toBeGreaterThan(4);
    expect(second.length).toBeGreaterThan(0);
    expect(second.every((name) => !first.includes(name))).toBe(true);
    expect(second).not.toEqual([...first].reverse());
    expect([...first, ...second].every((name) => name !== "Drake" && name !== "Not A Real Band")).toBe(
      true,
    );
  });

  it("passes the previous neighbors into a new suggestion pass", async () => {
    const seenAvoid: string[][] = [];
    await assembleMixNeighbors("The National", ["Arcade Fire", "EL VY"], {
      fetchLastFm: async () => LAST_FM_HEAD,
      suggest: async (_seed, avoid) => {
        seenAvoid.push([...avoid]);
        return ["Local Natives"];
      },
      verifyCatalog: async (names) => [...names],
      filterFeel: async (_seed, names) => [...names],
    });

    expect(seenAvoid[0]).toEqual(["Arcade Fire", "EL VY"]);
  });

  it("plays the short Last.fm list when extra names are not real or do not fit", async () => {
    const pool = await assembleMixNeighbors("The National", ["Keane"], {
      fetchLastFm: async () => ["Keane"],
      suggest: async () => ["Drake", "Made Up Person"],
      verifyCatalog: async (names) => names.filter((name) => name === "Drake"),
      filterFeel: async () => [],
    });

    expect(pool).toEqual(["Keane"]);
    expect(selectFreshNeighbors(pool, ["Keane"])).toEqual(["Keane"]);
  });

  it("still plays Last.fm when the model pass fails", async () => {
    const pool = await assembleMixNeighbors("The National", [], {
      fetchLastFm: async () => ["Keane"],
      suggest: async () => {
        throw new Error("openai down");
      },
      verifyCatalog: async () => {
        throw new Error("should not verify");
      },
      filterFeel: async () => {
        throw new Error("should not filter");
      },
    });

    expect(pool).toEqual(["Keane"]);
  });

  it("does not pad a thin Last.fm list with the handwritten club", () => {
    const mixed = interleaveNeighborNames(["Keane"], []);
    expect(mixed).toEqual(["Keane"]);
    expect(mixed).not.toContain("Arcade Fire");
  });
});

describe("Artist Mix seed slot", () => {
  it("keeps the opener to one seed song", () => {
    expect(MIX_SEED_SONGS).toBe(1);
  });
});

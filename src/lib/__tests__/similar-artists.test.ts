import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchLastFmArtistTags,
  fetchLastFmSimilarArtistsScored,
  isLastFmConfigured,
} from "@/lib/catalog/lastfm";
import { fetchSimilarArtists, fetchSimilarArtistsScored, MIXED_RADIO_SIMILAR_PAGE } from "../similar-artists";

vi.mock("@/lib/catalog/lastfm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/catalog/lastfm")>();
  return {
    ...actual,
    isLastFmConfigured: vi.fn(),
    fetchLastFmSimilarArtistsScored: vi.fn(),
    fetchLastFmArtistTags: vi.fn(async () => []),
  };
});

describe("fetchSimilarArtistsScored", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("filters by matchThreshold, dedupes normalized names, and slices to limit", async () => {
    vi.mocked(isLastFmConfigured).mockReturnValue(true);
    vi.mocked(fetchLastFmSimilarArtistsScored).mockResolvedValue([
      { name: "Keane", match: 0.91 },
      { name: "keane", match: 0.88 },
      { name: "Coldplay", match: 0.7 },
      { name: "Death Cab for Cutie", match: 0.55 },
      { name: "Travis Scott", match: 0.12 },
      { name: "Modest Mouse", match: 0.5 },
    ]);

    const scored = await fetchSimilarArtistsScored("Snow Patrol", 3, 0.4);

    expect(scored).toEqual([
      { name: "Keane", match: 0.91 },
      { name: "Coldplay", match: 0.7 },
      { name: "Death Cab for Cutie", match: 0.55 },
    ]);
    expect(scored.some((a) => a.name.toLowerCase().includes("travis"))).toBe(
      false,
    );
    expect(fetchLastFmSimilarArtistsScored).toHaveBeenCalledWith(
      "Snow Patrol",
      6,
    );
  });

  it("falls back to ANCHOR_PROFILES with match 1.0 when Last.fm is not configured", async () => {
    vi.mocked(isLastFmConfigured).mockReturnValue(false);

    const scored = await fetchSimilarArtistsScored("The National", 4, 0.4);

    expect(scored.length).toBeGreaterThan(0);
    expect(scored.length).toBeLessThanOrEqual(4);
    expect(scored.every((item) => item.match === 1.0)).toBe(true);
    expect(
      scored.every((item) => item.name.toLowerCase() !== "the national"),
    ).toBe(true);
    expect(fetchLastFmSimilarArtistsScored).not.toHaveBeenCalled();
  });
});

const NATIONAL_CLUB = [
  "Arcade Fire",
  "Interpol",
  "The Strokes",
  "Vampire Weekend",
  "Bon Iver",
  "Modest Mouse",
  "Death Cab for Cutie",
  "The Killers",
  "Radiohead",
];

describe("fetchSimilarArtists mixed radio neighborhood", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchLastFmArtistTags).mockReset();
    vi.mocked(fetchLastFmArtistTags).mockResolvedValue([]);
  });

  function tagsFor(seed: string[], byArtist: Record<string, string[]>) {
    vi.mocked(fetchLastFmArtistTags).mockImplementation(async (name: string) => {
      if (name === "The National") return seed;
      return byArtist[name] ?? ["seen live", "favorites"];
    });
  }

  it("keeps a wider same-feel page and does not stop at the first 8", async () => {
    vi.mocked(isLastFmConfigured).mockReturnValue(true);
    const neighbors = Array.from({ length: 12 }, (_, index) => `Neighbor ${index + 1}`);
    vi.mocked(fetchLastFmSimilarArtistsScored).mockResolvedValue(
      neighbors.map((name, index) => ({ name, match: 1 - index * 0.01 })),
    );
    tagsFor(
      ["indie rock", "seen live", "90s"],
      Object.fromEntries(
        neighbors.map((name, index) => [
          name,
          index === 11 ? ["seen live", "favorites", "hip hop"] : ["indie rock", "seen live"],
        ]),
      ),
    );

    const names = await fetchSimilarArtists("The National");

    expect(fetchLastFmSimilarArtistsScored).toHaveBeenCalledWith(
      "The National",
      MIXED_RADIO_SIMILAR_PAGE,
    );
    expect(MIXED_RADIO_SIMILAR_PAGE).toBeGreaterThan(8);
    expect(names).toHaveLength(11);
    expect(names).toContain("Neighbor 9");
    expect(names).toContain("Neighbor 11");
    expect(names).not.toContain("Neighbor 12");
    expect(names).not.toContain("Arcade Fire");
  });

  it("drops a neighbor that shares no real genre or era tag with the seed", async () => {
    vi.mocked(isLastFmConfigured).mockReturnValue(true);
    vi.mocked(fetchLastFmSimilarArtistsScored).mockResolvedValue([
      { name: "Keane", match: 0.9 },
      { name: "Only Seen Live", match: 0.4 },
    ]);
    tagsFor(["indie rock", "seen live", "90s"], {
      Keane: ["indie rock", "seen live", "british"],
      "Only Seen Live": ["seen live", "favorites", "american", "hip hop"],
    });

    const names = await fetchSimilarArtists("The National");

    expect(names).toEqual(["Keane"]);
    expect(names).not.toContain("Only Seen Live");
  });

  it("plays the shorter honest set and does not pad with the handwritten club", async () => {
    vi.mocked(isLastFmConfigured).mockReturnValue(true);
    vi.mocked(fetchLastFmSimilarArtistsScored).mockResolvedValue([
      { name: "Keane", match: 0.9 },
      { name: "Distant One", match: 0.5 },
      { name: "Distant Two", match: 0.4 },
    ]);
    tagsFor(["indie rock", "seen live"], {
      Keane: ["indie rock", "seen live"],
      "Distant One": ["hip hop", "seen live"],
      "Distant Two": ["favorites", "seen live"],
    });

    const names = await fetchSimilarArtists("The National");

    expect(names).toEqual(["Keane"]);
    for (const clubName of NATIONAL_CLUB) {
      expect(names).not.toContain(clubName);
    }
  });

  it("still uses the handwritten club only when Last.fm returns nobody", async () => {
    vi.mocked(isLastFmConfigured).mockReturnValue(true);
    vi.mocked(fetchLastFmSimilarArtistsScored).mockResolvedValue([]);

    const names = await fetchSimilarArtists("The National");

    expect(names.length).toBeGreaterThan(0);
    expect(names.length).toBeLessThanOrEqual(8);
    expect(names).toContain("Arcade Fire");
    expect(names).not.toContain("The National");
    expect(names.every((name) => NATIONAL_CLUB.includes(name))).toBe(true);
    expect(fetchLastFmArtistTags).not.toHaveBeenCalled();
  });

  it("does not let the full Last.fm similar page own Artist Mix", () => {
    const route = readFileSync(path.resolve("src/app/api/artist-radio/route.ts"), "utf8");
    const launch = readFileSync(path.resolve("src/lib/neighborhood-launch.ts"), "utf8");
    const mix = readFileSync(path.resolve("src/lib/mix-neighbors.ts"), "utf8");
    expect(route).not.toMatch(/fetchSimilarArtists\(\s*matchedArtist\s*,\s*8\s*\)/);
    expect(launch).toContain("assembleMixNeighbors");
    expect(mix).not.toContain("fetchSimilarArtists");
    expect(mix).not.toContain("MIXED_RADIO_SIMILAR_PAGE");
    expect(mix).toContain('MIX_NEIGHBOR_MODEL = "gpt-4o"');
    expect(mix).not.toContain("gpt-4o-mini");
    expect(mix).toContain("fetchLastFmSimilarArtistsScored");
  });
});

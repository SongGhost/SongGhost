import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchLastFmSimilarArtistsScored,
  isLastFmConfigured,
} from "@/lib/catalog/lastfm";
import { fetchSimilarArtistsScored } from "../similar-artists";

vi.mock("@/lib/catalog/lastfm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/catalog/lastfm")>();
  return {
    ...actual,
    isLastFmConfigured: vi.fn(),
    fetchLastFmSimilarArtistsScored: vi.fn(),
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

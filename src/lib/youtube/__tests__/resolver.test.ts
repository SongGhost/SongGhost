import { describe, expect, it } from "vitest";
import {
  isDurationWithinTolerance,
  MAX_DURATION_MISMATCH_SEC,
} from "@/lib/youtube/resolver";
import { buildMusicSearchQueries, YOUTUBE_MUSIC_CATEGORY_ID } from "@/lib/youtube/youtube-search";

describe("buildMusicSearchQueries", () => {
  it("prioritizes Official Audio then Topic channel wording", () => {
    expect(buildMusicSearchQueries("Radiohead", "Creep")).toEqual([
      "Radiohead - Creep Official Audio",
      "Radiohead - Creep Topic",
    ]);
  });

  it("trims artist and title whitespace", () => {
    expect(buildMusicSearchQueries("  ABBA ", " Dancing Queen ")).toEqual([
      "ABBA - Dancing Queen Official Audio",
      "ABBA - Dancing Queen Topic",
    ]);
  });
});

describe("YOUTUBE_MUSIC_CATEGORY_ID", () => {
  it("targets the Music category", () => {
    expect(YOUTUBE_MUSIC_CATEGORY_ID).toBe("10");
  });
});

describe("isDurationWithinTolerance", () => {
  it("accepts matches within the 25s window", () => {
    expect(isDurationWithinTolerance(240, 240)).toBe(true);
    expect(isDurationWithinTolerance(240 + MAX_DURATION_MISMATCH_SEC, 240)).toBe(true);
    expect(isDurationWithinTolerance(240 - MAX_DURATION_MISMATCH_SEC, 240)).toBe(true);
  });

  it("rejects mismatches beyond 25s", () => {
    expect(isDurationWithinTolerance(240 + MAX_DURATION_MISMATCH_SEC + 1, 240)).toBe(false);
    expect(isDurationWithinTolerance(180, 240)).toBe(false);
  });

  it("skips the gate when either duration is unknown", () => {
    expect(isDurationWithinTolerance(undefined, 240)).toBe(true);
    expect(isDurationWithinTolerance(240, undefined)).toBe(true);
    expect(isDurationWithinTolerance(undefined, undefined)).toBe(true);
  });
});

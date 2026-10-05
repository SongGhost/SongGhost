import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("GET /api/song-radio", () => {
  it("does not build the old similar-artist weave", () => {
    const route = readFileSync(path.resolve("src/app/api/song-radio/route.ts"), "utf8");
    expect(route).toContain('from "../artist-radio/route"');
    expect(route).not.toContain("fetchSimilarArtistsScored");
    expect(route).not.toContain("Could not expand Song Radio");
  });
});

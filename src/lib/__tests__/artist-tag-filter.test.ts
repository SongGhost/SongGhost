import { describe, expect, it } from "vitest";
import {
  realGenreOrEraTags,
  sharesRealGenreOrEra,
} from "../artist-tag-filter";

describe("real genre and era tags", () => {
  it("ignores junk such as seen live so that tag cannot pass a neighbor", () => {
    expect(realGenreOrEraTags(["seen live", "favorites", "90s", "indie rock"])).toEqual([
      "90s",
      "indie rock",
    ]);
    expect(
      sharesRealGenreOrEra(
        ["seen live", "indie rock"],
        ["seen live", "favorites", "hip hop"],
      ),
    ).toBe(false);
  });

  it("keeps a neighbor that shares an era even when the genres differ", () => {
    expect(
      sharesRealGenreOrEra(
        ["seen live", "indie rock", "90s"],
        ["hip hop", "favorites", "90s"],
      ),
    ).toBe(true);
  });

  it("does not treat a shared place or mood word as a genre", () => {
    expect(
      sharesRealGenreOrEra(
        ["american", "melancholic", "seen live"],
        ["american", "melancholic", "seen live", "hip hop"],
      ),
    ).toBe(false);
  });
});
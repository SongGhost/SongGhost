import { describe, expect, it, vi } from "vitest";
import { fisherYatesShuffle, shuffleRemainingTracks } from "../shuffle";

describe("fisherYatesShuffle", () => {
  it("returns the same array reference", () => {
    const items = [1, 2, 3];
    expect(fisherYatesShuffle(items)).toBe(items);
  });
});

describe("shuffleRemainingTracks", () => {
  it("keeps the head through currentIndex and only shuffles the tail", () => {
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0.9)
      .mockReturnValueOnce(0.1);

    const queue = ["a", "b", "c", "d", "e"];
    const next = shuffleRemainingTracks(queue, 1);

    expect(next.slice(0, 2)).toEqual(["a", "b"]);
    expect(next.slice(2).sort()).toEqual(["c", "d", "e"]);
    expect(next).not.toBe(queue);
    expect(queue).toEqual(["a", "b", "c", "d", "e"]);

    vi.restoreAllMocks();
  });

  it("returns a copy when there is nothing to shuffle", () => {
    expect(shuffleRemainingTracks(["only"], 0)).toEqual(["only"]);
    expect(shuffleRemainingTracks(["a", "b"], 1)).toEqual(["a", "b"]);
  });

  it("clamps a bad currentIndex", () => {
    const queue = ["a", "b", "c"];
    expect(shuffleRemainingTracks(queue, -1)[0]).toBe("a");
    expect(shuffleRemainingTracks(queue, 99)).toEqual(["a", "b", "c"]);
  });
});

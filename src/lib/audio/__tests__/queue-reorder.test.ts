import { describe, expect, it } from "vitest";
import { anchorCurrentIndex, reorderQueueItems } from "../queue-reorder";

const QUEUE = ["a", "b", "c", "d", "e"] as const;

describe("reorderQueueItems", () => {
  it("moves a track down and keeps the array length", () => {
    const result = reorderQueueItems(QUEUE, 1, 3, 0);
    expect(result?.queue).toEqual(["a", "c", "d", "b", "e"]);
  });

  it("moves a track up", () => {
    const result = reorderQueueItems(QUEUE, 3, 1, 0);
    expect(result?.queue).toEqual(["a", "d", "b", "c", "e"]);
  });

  it("returns null for no-op moves", () => {
    expect(reorderQueueItems(QUEUE, 2, 2, 0)).toBeNull();
  });

  it("returns null when the source index is out of range", () => {
    expect(reorderQueueItems(QUEUE, -1, 2, 0)).toBeNull();
    expect(reorderQueueItems(QUEUE, 5, 2, 0)).toBeNull();
  });

  it("returns null for non-integer indices", () => {
    expect(reorderQueueItems(QUEUE, 1.5, 3, 0)).toBeNull();
    expect(reorderQueueItems(QUEUE, 1, Number.NaN, 0)).toBeNull();
  });

  it("returns null for queues too short to reorder", () => {
    expect(reorderQueueItems([], 0, 0, 0)).toBeNull();
    expect(reorderQueueItems(["a"], 0, 1, 0)).toBeNull();
  });

  it("clamps an out-of-range destination to the last slot", () => {
    const result = reorderQueueItems(QUEUE, 0, 99, 2);
    expect(result?.queue).toEqual(["b", "c", "d", "e", "a"]);
  });

  it("does not mutate the input queue", () => {
    const input = [...QUEUE];
    reorderQueueItems(input, 0, 4, 0);
    expect(input).toEqual([...QUEUE]);
  });
});

describe("current index anchoring", () => {
  /** The on-air track must survive any reorder that does not involve it. */
  function playingTrackAfterMove(from: number, to: number, current: number): string {
    const result = reorderQueueItems(QUEUE, from, to, current);
    if (!result) throw new Error("expected a reorder");
    return result.queue[result.currentIndex];
  }

  it("keeps the playing track anchored when an upcoming track is dragged above it", () => {
    // "e" (index 4) dragged to the top while "c" (index 2) is on air.
    const result = reorderQueueItems(QUEUE, 4, 0, 2);
    expect(result?.queue).toEqual(["e", "a", "b", "c", "d"]);
    expect(result?.currentIndex).toBe(3);
    expect(playingTrackAfterMove(4, 0, 2)).toBe("c");
  });

  it("keeps the playing track anchored when a played track is dragged below it", () => {
    const result = reorderQueueItems(QUEUE, 0, 4, 2);
    expect(result?.queue).toEqual(["b", "c", "d", "e", "a"]);
    expect(result?.currentIndex).toBe(1);
    expect(playingTrackAfterMove(0, 4, 2)).toBe("c");
  });

  it("leaves the index untouched when both endpoints sit below the current track", () => {
    const result = reorderQueueItems(QUEUE, 3, 4, 1);
    expect(result?.currentIndex).toBe(1);
    expect(playingTrackAfterMove(3, 4, 1)).toBe("b");
  });

  it("leaves the index untouched when both endpoints sit above the current track", () => {
    const result = reorderQueueItems(QUEUE, 0, 1, 3);
    expect(result?.currentIndex).toBe(3);
    expect(playingTrackAfterMove(0, 1, 3)).toBe("d");
  });

  it("follows the current track when the current track itself is dragged", () => {
    const result = reorderQueueItems(QUEUE, 2, 0, 2);
    expect(result?.queue).toEqual(["c", "a", "b", "d", "e"]);
    expect(result?.currentIndex).toBe(0);
    expect(playingTrackAfterMove(2, 0, 2)).toBe("c");
  });

  it("anchors the playing track for every move pair in the queue", () => {
    for (let current = 0; current < QUEUE.length; current++) {
      for (let from = 0; from < QUEUE.length; from++) {
        for (let to = 0; to < QUEUE.length; to++) {
          if (from === to) continue;
          expect(playingTrackAfterMove(from, to, current)).toBe(QUEUE[current]);
        }
      }
    }
  });
});

describe("anchorCurrentIndex", () => {
  it("returns the destination when the current row is the one being moved", () => {
    expect(anchorCurrentIndex(2, 0, 2)).toBe(0);
  });

  it("shifts down when a track above the current one moves to or past it", () => {
    expect(anchorCurrentIndex(0, 2, 2)).toBe(1);
    expect(anchorCurrentIndex(0, 4, 2)).toBe(1);
  });

  it("shifts up when a track below the current one moves to or above it", () => {
    expect(anchorCurrentIndex(4, 2, 2)).toBe(3);
    expect(anchorCurrentIndex(4, 0, 2)).toBe(3);
  });
});

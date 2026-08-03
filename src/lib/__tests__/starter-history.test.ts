import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isStarterHistoryReady,
  moveToFront,
  readStarterHistory,
  rememberStarter,
  selectFreshStarterIndex,
  STARTER_HISTORY_LIMIT,
} from "../starter-history";

const track = (youtubeId: string, artist = "Various") => ({
  youtubeId,
  title: youtubeId,
  artist,
});

const identify = (item: { youtubeId: string }) => item.youtubeId;

/** The suite runs in the node environment, so `window.localStorage` is stubbed in. */
function installStorageStub(): void {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  };
}

describe("selectFreshStarterIndex", () => {
  const pool = [track("a"), track("b"), track("c")];

  it("returns the first item when nothing has played", () => {
    expect(selectFreshStarterIndex(pool, identify, [])).toBe(0);
  });

  it("skips past recent openers to the earliest fresh item", () => {
    expect(selectFreshStarterIndex(pool, identify, ["a"])).toBe(1);
    expect(selectFreshStarterIndex(pool, identify, ["b", "a"])).toBe(2);
  });

  it("gives back the least recent opener once the pool is exhausted", () => {
    // History is most-recent-first, so "a" is the oldest and the safest repeat.
    expect(selectFreshStarterIndex(pool, identify, ["c", "b", "a"])).toBe(0);
  });

  it("ignores history entries that are not in the pool", () => {
    expect(selectFreshStarterIndex(pool, identify, ["z", "y"])).toBe(0);
  });

  it("handles single-item and empty pools", () => {
    expect(selectFreshStarterIndex([track("a")], identify, ["a"])).toBe(0);
    expect(selectFreshStarterIndex([], identify, [])).toBe(-1);
  });
});

describe("moveToFront", () => {
  it("promotes the target and preserves the order of the rest", () => {
    const pool = [track("a"), track("b"), track("c"), track("d")];
    expect(moveToFront(pool, 2).map(identify)).toEqual(["c", "a", "b", "d"]);
  });

  it("passes through for a no-op or out-of-range index", () => {
    const pool = [track("a"), track("b")];
    expect(moveToFront(pool, 0).map(identify)).toEqual(["a", "b"]);
    expect(moveToFront(pool, -1).map(identify)).toEqual(["a", "b"]);
    expect(moveToFront(pool, 9).map(identify)).toEqual(["a", "b"]);
  });

  it("does not mutate the input", () => {
    const pool = [track("a"), track("b"), track("c")];
    moveToFront(pool, 2);
    expect(pool.map(identify)).toEqual(["a", "b", "c"]);
  });
});

describe("starter history persistence", () => {
  beforeEach(installStorageStub);
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("reads back nothing for an unseen station", () => {
    expect(readStarterHistory("70s-classic-rock")).toEqual([]);
  });

  it("stores the newest opener first", () => {
    rememberStarter("70s-classic-rock", "a");
    rememberStarter("70s-classic-rock", "b");
    expect(readStarterHistory("70s-classic-rock")).toEqual(["b", "a"]);
  });

  it("keeps stations independent", () => {
    rememberStarter("70s-classic-rock", "a");
    rememberStarter("90s-alt", "z");
    expect(readStarterHistory("70s-classic-rock")).toEqual(["a"]);
    expect(readStarterHistory("90s-alt")).toEqual(["z"]);
  });

  it("moves a repeated opener to the front instead of duplicating it", () => {
    rememberStarter("s", "a");
    rememberStarter("s", "b");
    rememberStarter("s", "a");
    expect(readStarterHistory("s")).toEqual(["a", "b"]);
  });

  it("caps the history at the limit, dropping the oldest", () => {
    for (let i = 0; i < STARTER_HISTORY_LIMIT + 3; i++) rememberStarter("s", `t${i}`);
    const history = readStarterHistory("s");
    expect(history).toHaveLength(STARTER_HISTORY_LIMIT);
    expect(history[0]).toBe(`t${STARTER_HISTORY_LIMIT + 2}`);
    expect(history).not.toContain("t0");
  });

  it("ignores empty ids", () => {
    rememberStarter("s", "");
    expect(readStarterHistory("s")).toEqual([]);
  });

  it("recovers from corrupted stored values", () => {
    window.localStorage.setItem("songghost:starter-history:s", "not json");
    expect(readStarterHistory("s")).toEqual([]);
  });

  it("drops non-string entries from stored values", () => {
    window.localStorage.setItem("songghost:starter-history:s", JSON.stringify(["a", 7, null, "b"]));
    expect(readStarterHistory("s")).toEqual(["a", "b"]);
  });

  it("rotates through the whole pool across consecutive launches", () => {
    const pool = [track("a"), track("b"), track("c")];
    const openers: string[] = [];

    for (let launch = 0; launch < 3; launch++) {
      const index = selectFreshStarterIndex(pool, identify, readStarterHistory("s"));
      const opener = identify(pool[index]);
      openers.push(opener);
      rememberStarter("s", opener);
    }

    expect(new Set(openers).size).toBe(3);
  });
});

describe("deep preset pools", () => {
  beforeEach(installStorageStub);
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  const deepPool = Array.from({ length: 40 }, (_, i) => track(`t${i}`));

  /** Mirrors `pickStarter`: shuffle the pool, then skip recent openers. */
  function launch(bucket: string, pool: typeof deepPool): string {
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const index = selectFreshStarterIndex(shuffled, identify, readStarterHistory(bucket));
    const opener = identify(shuffled[index]);
    rememberStarter(bucket, opener);
    return opener;
  }

  it("never repeats an opener inside the remembered window", () => {
    const openers = Array.from({ length: 40 }, () => launch("alternative-rock", deepPool));

    for (let i = STARTER_HISTORY_LIMIT; i < openers.length; i++) {
      const window = openers.slice(i - STARTER_HISTORY_LIMIT, i);
      expect(window).not.toContain(openers[i]);
    }
  });

  it("spreads openers across the pool rather than favoring the front", () => {
    // Until the window fills, every previous opener is still excluded, so a pool
    // deeper than the window owes the listener a brand new song every launch.
    const launches = Array.from({ length: STARTER_HISTORY_LIMIT }, () =>
      launch("country-gold", deepPool),
    );
    expect(new Set(launches).size).toBe(STARTER_HISTORY_LIMIT);
  });

  it("still rotates a pool smaller than the remembered window", () => {
    const smallPool = [track("a"), track("b"), track("c")];
    const openers = Array.from({ length: 12 }, () => launch("lofi-chillhop", smallPool));

    // Three tracks cannot fill a 20-deep window, but consecutive repeats are
    // still the thing a listener notices, and the relaxation must avoid them.
    for (let i = 1; i < openers.length; i++) {
      expect(openers[i]).not.toBe(openers[i - 1]);
    }
  });
});

describe("client readiness", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("is not ready during server-side rendering", () => {
    expect(isStarterHistoryReady()).toBe(false);
  });

  it("is ready once a window with localStorage exists", () => {
    installStorageStub();
    expect(isStarterHistoryReady()).toBe(true);
  });

  it("is not ready when storage access throws", () => {
    (globalThis as { window?: unknown }).window = {
      get localStorage(): never {
        throw new Error("blocked by cookie policy");
      },
    };
    expect(isStarterHistoryReady()).toBe(false);
  });

  it("degrades to no history without a window", () => {
    expect(readStarterHistory("s")).toEqual([]);
    expect(() => rememberStarter("s", "a")).not.toThrow();
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isPinnedStation,
  loadPinnedStations,
  PINNED_PRESETS_STORAGE_KEY,
  savePinnedStations,
  sortStationsWithPinsFirst,
  togglePinStation,
} from "../preferences";

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

beforeEach(() => {
  installStorageStub();
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("loadPinnedStations / savePinnedStations", () => {
  it("returns empty when nothing is stored", () => {
    expect(loadPinnedStations()).toEqual([]);
  });

  it("round-trips pinned ids", () => {
    savePinnedStations(["70s-classic-rock", "indie-rock"]);
    expect(loadPinnedStations()).toEqual(["70s-classic-rock", "indie-rock"]);
  });

  it("dedupes and drops junk on read", () => {
    window.localStorage.setItem(
      PINNED_PRESETS_STORAGE_KEY,
      JSON.stringify(["a", "a", "", 7, null, "b"]),
    );
    expect(loadPinnedStations()).toEqual(["a", "b"]);
  });

  it("returns empty on corrupt JSON", () => {
    window.localStorage.setItem(PINNED_PRESETS_STORAGE_KEY, "not json");
    expect(loadPinnedStations()).toEqual([]);
  });
});

describe("togglePinStation", () => {
  it("pins a new station at the front", () => {
    expect(togglePinStation("b", ["a"])).toEqual(["b", "a"]);
    expect(loadPinnedStations()).toEqual(["b", "a"]);
  });

  it("unpins an existing station", () => {
    expect(togglePinStation("a", ["a", "b"])).toEqual(["b"]);
    expect(loadPinnedStations()).toEqual(["b"]);
  });

  it("loads from storage when current list is omitted", () => {
    savePinnedStations(["x"]);
    expect(togglePinStation("y")).toEqual(["y", "x"]);
  });
});

describe("isPinnedStation", () => {
  it("reports membership", () => {
    expect(isPinnedStation("a", ["a", "b"])).toBe(true);
    expect(isPinnedStation("c", ["a", "b"])).toBe(false);
  });
});

describe("sortStationsWithPinsFirst", () => {
  const stations = [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" },
    { id: "d", name: "D" },
  ];

  it("leaves order alone when nothing is pinned", () => {
    expect(sortStationsWithPinsFirst(stations, []).map((s) => s.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("surfaces pinned ids in pin order, then the rest", () => {
    expect(sortStationsWithPinsFirst(stations, ["c", "a"]).map((s) => s.id)).toEqual([
      "c",
      "a",
      "b",
      "d",
    ]);
  });

  it("ignores pin ids that are not in the list", () => {
    expect(sortStationsWithPinsFirst(stations, ["z", "b"]).map((s) => s.id)).toEqual([
      "b",
      "a",
      "c",
      "d",
    ]);
  });
});

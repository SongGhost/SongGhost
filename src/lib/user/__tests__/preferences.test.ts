import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Station } from "@/data/stations";
import {
  isDynamicStationId,
  isPersistedLaunchStationId,
  isPinnedStation,
  loadPinnedStations,
  PINNED_PRESETS_STORAGE_KEY,
  prefsStorageKey,
  savePinnedStations,
  serializeStationForSave,
  sortStationsWithPinsFirst,
  togglePinStation,
  toggleSaveStation,
  upsertSavedStation,
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

describe("dynamic station persistence", () => {
  const artistRadio: Station = {
    id: "artist-radio-neon",
    name: "Artist Radio: Neon",
    frequency: 99.9,
    category: "genres",
    defaultPersonaId: "kira-nova",
    accentColor: "#FF0055",
    youtubeVideoId: "abc123",
    tracks: [
      { youtubeId: "abc123", title: "Glow", artist: "Neon", spotifyId: "sp1" },
      { youtubeId: "def456", title: "Pulse", artist: "Neon" },
    ],
    description: "Broad radio station blending Neon with similar artists",
  };

  it("keys prefs per account", () => {
    expect(prefsStorageKey("user_123")).toBe("songhost:prefs:user_123");
    expect(prefsStorageKey(null)).toBe("songhost:prefs:guest");
  });

  it("recognizes ephemeral station ids", () => {
    expect(isDynamicStationId("artist-radio-neon")).toBe(true);
    expect(isDynamicStationId("song-radio-seed-1")).toBe(true);
    expect(isDynamicStationId("ai-curator-9")).toBe(true);
    expect(isDynamicStationId("70s-classic-rock")).toBe(false);
    expect(isPersistedLaunchStationId("artist-radio-neon")).toBe(true);
    expect(isPersistedLaunchStationId("saved-station-mix")).toBe(true);
  });

  it("serializes a complete Artist Radio payload by value", () => {
    const live: Station = {
      ...artistRadio,
      tracks: artistRadio.tracks.map((track) => ({ ...track })),
    };
    const serialized = serializeStationForSave(live);
    expect(serialized.id).toBe("artist-radio-neon");
    expect(serialized.tracks).toHaveLength(2);
    expect(serialized.tracks[0]?.spotifyId).toBe("sp1");
    // Mutating the live station must not touch the snapshot.
    live.tracks[0]!.title = "Mutated";
    expect(serialized.tracks[0]?.title).toBe("Glow");
  });

  it("upserts and toggles into savedStations", () => {
    const once = upsertSavedStation([], artistRadio);
    expect(once).toHaveLength(1);
    expect(once[0]?.id).toBe("artist-radio-neon");

    const toggledOff = toggleSaveStation(once, artistRadio);
    expect(toggledOff.saved).toBe(false);
    expect(toggledOff.stations).toHaveLength(0);

    const toggledOn = toggleSaveStation([], artistRadio);
    expect(toggledOn.saved).toBe(true);
    expect(toggledOn.stations[0]?.tracks).toHaveLength(2);
  });
});

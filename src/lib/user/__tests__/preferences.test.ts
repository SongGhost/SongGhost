import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Station } from "@/data/stations";
import {
  buildCloudPreferencesPayload,
  isDynamicStationId,
  isPersistedLaunchStationId,
  isPinnedStation,
  isUserSyncPostBodyValid,
  loadPinnedStations,
  mergeCloudPreferencesOverLocal,
  normalizeCloudPreferences,
  normalizeUserPreferences,
  PINNED_PRESETS_STORAGE_KEY,
  prefsStorageKey,
  savePinnedStations,
  serializeStationForSave,
  sortStationsWithPinsFirst,
  togglePinStation,
  toggleSaveStation,
  upsertSavedStation,
} from "../preferences";
import { DEFAULT_PREFERENCES } from "@/types/user";

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
    expect(isDynamicStationId("album-deep-dive-rumours")).toBe(true);
    expect(isDynamicStationId("studio-mix-1")).toBe(true);
    expect(isDynamicStationId("tuner-123")).toBe(true);
    expect(isDynamicStationId("70s-classic-rock")).toBe(false);
    expect(isPersistedLaunchStationId("artist-radio-neon")).toBe(true);
    expect(isPersistedLaunchStationId("saved-station-mix")).toBe(true);
    expect(isPersistedLaunchStationId("album-deep-dive-rumours")).toBe(true);
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

  it("stores Station Profile seeds instead of a frozen studio queue", () => {
    const studio: Station = {
      ...artistRadio,
      id: "studio-blueprint-1",
      seedArtists: ["The Cure"],
      seedGenres: ["Post-Punk"],
      energyLevel: 62,
      catalogDepth: 40,
      vibePrompt: "neon rain",
    };
    const serialized = serializeStationForSave(studio);
    expect(serialized.tracks).toHaveLength(0);
    expect(serialized.seedArtists).toEqual(["The Cure"]);
    expect(serialized.seedGenres).toEqual(["Post-Punk"]);
    expect(serialized.vibePrompt).toBe("neon rain");
  });

  it("keeps Spotify-only album tracks when serializing", () => {
    const album: Station = {
      ...artistRadio,
      id: "album-deep-dive-rumours",
      tracks: [
        {
          youtubeId: "",
          title: "Dreams",
          artist: "Fleetwood Mac",
          spotifyId: "spotify-dreams",
        },
      ],
    };
    const serialized = serializeStationForSave(album);
    expect(serialized.tracks).toHaveLength(1);
    expect(serialized.tracks[0]?.spotifyId).toBe("spotify-dreams");
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

describe("normalizeUserPreferences", () => {
  it("preserves Host Studio mood and personality from a stored blob", () => {
    const prefs = normalizeUserPreferences({
      mood: "hyped",
      personality: "sarcastic",
    });
    expect(prefs.mood).toBe("hyped");
    expect(prefs.personality).toBe("sarcastic");
  });

  it("falls back to Even Keel / Normal for missing or unknown values", () => {
    expect(normalizeUserPreferences({}).mood).toBe("even_keel");
    expect(normalizeUserPreferences({}).personality).toBe("normal");
    expect(normalizeUserPreferences({ mood: "amped" as never }).mood).toBe("even_keel");
    expect(normalizeUserPreferences({ personality: "sassy" as never }).personality).toBe(
      "normal",
    );
  });

  it("keeps per-station mood and personality inside stationConfigs", () => {
    const prefs = normalizeUserPreferences({
      mood: "chill",
      personality: "kind",
      stationConfigs: {
        "90s-alt": { stationId: "90s-alt", mood: "hyped", personality: "dry" },
      },
    });
    expect(prefs.mood).toBe("chill");
    expect(prefs.stationConfigs["90s-alt"]?.mood).toBe("hyped");
    expect(prefs.stationConfigs["90s-alt"]?.personality).toBe("dry");
  });

  it("preserves lastStationId from a stored blob", () => {
    expect(normalizeUserPreferences({ lastStationId: " 90s-alt " }).lastStationId).toBe(
      "90s-alt",
    );
    expect(normalizeUserPreferences({}).lastStationId).toBeUndefined();
  });
});

describe("normalizeCloudPreferences", () => {
  it("returns null for empty or non-object payloads", () => {
    expect(normalizeCloudPreferences(null)).toBeNull();
    expect(normalizeCloudPreferences({})).toBeNull();
    expect(normalizeCloudPreferences([])).toBeNull();
  });

  it("keeps Director's Cut, vibePrompt, hostRetention, and lastStationId", () => {
    const payload = normalizeCloudPreferences({
      activePersonaId: "jasper-reed",
      commentaryFormat: "directors_cut",
      mood: "hyped",
      personality: "dry",
      stationConfigs: {
        "90s-alt": { stationId: "90s-alt", vibePrompt: "  neon rain  " },
      },
      hostRetention: { activeHostId: "jasper-reed", isHostLocked: true },
      lastStationId: "90s-alt",
    });
    expect(payload?.activePersonaId).toBe("jasper-reed");
    expect(payload?.commentaryFormat).toBe("directors_cut");
    expect(payload?.stationConfigs?.["90s-alt"]?.vibePrompt).toBe("neon rain");
    expect(payload?.hostRetention).toEqual({
      activeHostId: "jasper-reed",
      isHostLocked: true,
    });
    expect(payload?.lastStationId).toBe("90s-alt");
  });
});

describe("mergeCloudPreferencesOverLocal", () => {
  it("lets remote cloud fields win without dropping local memory dials", () => {
    const local = normalizeUserPreferences({
      ...DEFAULT_PREFERENCES,
      commentaryFormat: "standard",
      lastStationId: "local-station",
      stationConfigs: {
        "70s-classic-rock": { stationId: "70s-classic-rock", vibePrompt: "local" },
      },
    });
    const merged = mergeCloudPreferencesOverLocal(local, {
      commentaryFormat: "directors_cut",
      lastStationId: "90s-alt",
      stationConfigs: {
        "90s-alt": { stationId: "90s-alt", vibePrompt: "cloud" },
      },
    });
    expect(merged.commentaryFormat).toBe("directors_cut");
    expect(merged.lastStationId).toBe("local-station");
    expect(merged.stationConfigs["70s-classic-rock"]?.vibePrompt).toBe("local");
    expect(merged.stationConfigs["90s-alt"]?.vibePrompt).toBe("cloud");
    expect(merged.memoryPresets).toEqual(local.memoryPresets);
  });

  it("fills lastStationId from cloud when local has none", () => {
    const local = normalizeUserPreferences({
      ...DEFAULT_PREFERENCES,
    });
    const merged = mergeCloudPreferencesOverLocal(local, {
      lastStationId: "90s-alt",
    });
    expect(merged.lastStationId).toBe("90s-alt");
  });
});

describe("isUserSyncPostBodyValid", () => {
  it("accepts a preferences-only body", () => {
    expect(isUserSyncPostBodyValid({ preferences: { lastStationId: "90s-alt" } })).toBe(
      true,
    );
    expect(isUserSyncPostBodyValid({ memoryPresets: [] })).toBe(true);
    expect(isUserSyncPostBodyValid({ savedStations: [] })).toBe(true);
    expect(isUserSyncPostBodyValid({})).toBe(false);
  });
});

describe("buildCloudPreferencesPayload", () => {
  it("snapshots hostRetention alongside Host Studio fields", () => {
    const payload = buildCloudPreferencesPayload(
      normalizeUserPreferences({
        commentaryFormat: "directors_cut",
        lastStationId: "90s-alt",
      }),
      { activeHostId: "jasper-reed", isHostLocked: true },
    );
    expect(payload.commentaryFormat).toBe("directors_cut");
    expect(payload.lastStationId).toBe("90s-alt");
    expect(payload.hostRetention).toEqual({
      activeHostId: "jasper-reed",
      isHostLocked: true,
    });
  });
});

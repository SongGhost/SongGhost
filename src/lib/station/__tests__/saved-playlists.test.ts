import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StationDefinition } from "@/types/user";
import {
  hydrateSavedPlaylists,
  loadSavedPlaylists,
  normalizeSavedPlaylist,
  normalizeSavedPlaylists,
  saveSavedPlaylists,
  SAVED_PLAYLISTS_STORAGE_KEY,
  savedPlaylistsStorageKey,
} from "../saved-playlists";

/** The suite runs in the node environment, so `window.localStorage` is stubbed in. */
function installStorageStub(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  };
  return store;
}

const sampleStation: StationDefinition = {
  id: "custom-neon-rain",
  name: "Neon Rain",
  frequency: 103.7,
  category: "genres",
  defaultPersonaId: "kira-nova",
  accentColor: "#FF6B00",
  youtubeVideoId: "abc123",
  tracks: [
    { youtubeId: "abc123", title: "Midnight City", artist: "M83" },
    { youtubeId: "def456", title: "Wait", artist: "M83" },
  ],
  description: "A late-night synth mix",
};

beforeEach(() => {
  installStorageStub();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { window?: unknown }).window;
});

describe("normalizeSavedPlaylist", () => {
  it("fills missing optional fields instead of dropping a legacy station", () => {
    const station = normalizeSavedPlaylist({
      id: "legacy-mix",
      name: "Legacy Mix",
      tracks: [{ youtubeId: "x1", title: "Song", artist: "Artist" }],
    });
    expect(station).toMatchObject({
      id: "legacy-mix",
      name: "Legacy Mix",
      frequency: 101.5,
      category: "decades",
      accentColor: "#C4882A",
      youtubeVideoId: "x1",
      description: "",
    });
    expect(station?.tracks).toHaveLength(1);
  });

  it("rejects entries that cannot be salvaged", () => {
    expect(normalizeSavedPlaylist(null)).toBeNull();
    expect(normalizeSavedPlaylist({ name: "No Id" })).toBeNull();
    expect(normalizeSavedPlaylist({ id: "x", name: "" })).toBeNull();
  });

  it("hydrates a seed-only Station Profile without tracks", () => {
    const station = normalizeSavedPlaylist({
      id: "studio-blueprint-1",
      name: "Neon Rain",
      seedArtists: ["The Cure"],
      seedGenres: ["Post-Punk"],
      vibePrompt: "wet asphalt",
      tracks: [],
    });
    expect(station).toMatchObject({
      id: "studio-blueprint-1",
      name: "Neon Rain",
      seedArtists: ["The Cure"],
      seedGenres: ["Post-Punk"],
      vibePrompt: "wet asphalt",
    });
    expect(station?.tracks).toEqual([]);
  });
});

describe("loadSavedPlaylists / saveSavedPlaylists", () => {
  it("round-trips a saved playlist through the per-account key", () => {
    saveSavedPlaylists([sampleStation]);
    const raw = window.localStorage.getItem(savedPlaylistsStorageKey(null));
    expect(raw).toContain("custom-neon-rain");
    expect(loadSavedPlaylists()).toEqual([sampleStation]);
  });

  it("survives a reload-shaped re-read without clearing storage", () => {
    saveSavedPlaylists([sampleStation]);
    const first = loadSavedPlaylists();
    const second = loadSavedPlaylists();
    expect(first).toEqual([sampleStation]);
    expect(second).toEqual([sampleStation]);
    expect(window.localStorage.getItem(savedPlaylistsStorageKey(null))).toContain("Neon Rain");
  });

  it("logs corrupt JSON and leaves the raw value on disk", () => {
    const key = savedPlaylistsStorageKey(null);
    window.localStorage.setItem(key, "not json{{{");
    expect(loadSavedPlaylists()).toEqual([]);
    expect(window.localStorage.getItem(key)).toBe("not json{{{");
    expect(console.warn).toHaveBeenCalledWith(
      "[SongHost] savedPlaylistsHydrateFailed",
      expect.objectContaining({ error: expect.anything() }),
    );
  });

  it("migrates the legacy global key into the per-account shelf", () => {
    window.localStorage.setItem(
      SAVED_PLAYLISTS_STORAGE_KEY,
      JSON.stringify([sampleStation]),
    );
    expect(loadSavedPlaylists()).toEqual([sampleStation]);
    expect(window.localStorage.getItem(savedPlaylistsStorageKey(null))).toContain("Neon Rain");
  });

  it("logs a schema mismatch without overwriting storage", () => {
    const key = savedPlaylistsStorageKey(null);
    const junk = JSON.stringify({ stations: [sampleStation] });
    window.localStorage.setItem(key, junk);
    expect(loadSavedPlaylists()).toEqual([]);
    expect(window.localStorage.getItem(key)).toBe(junk);
    expect(console.warn).toHaveBeenCalledWith(
      "[SongHost] savedPlaylistsSchemaMismatch",
      expect.objectContaining({ reason: "not-array" }),
    );
  });

  it("keeps salvageable entries when a sibling row is junk", () => {
    expect(
      normalizeSavedPlaylists([
        sampleStation,
        { id: "", name: "bad" },
        { id: "ok-2", name: "Second", tracks: [] },
      ]),
    ).toHaveLength(2);
  });
});

describe("hydrateSavedPlaylists", () => {
  it("migrates a prefs-blob slice onto the dedicated key", () => {
    const result = hydrateSavedPlaylists([sampleStation]);
    expect(result.stations).toEqual([sampleStation]);
    expect(result.migrated).toBe(true);
    expect(loadSavedPlaylists()).toEqual([sampleStation]);
  });

  it("merges the dedicated key with a prefs slice so dynamic stations survive", () => {
    saveSavedPlaylists([sampleStation]);
    const other: StationDefinition = {
      ...sampleStation,
      id: "artist-radio-neon",
      name: "Artist Radio: Neon",
      tracks: [
        { youtubeId: "z1", title: "Glow", artist: "Neon" },
        { youtubeId: "z2", title: "Pulse", artist: "Neon" },
      ],
    };
    const result = hydrateSavedPlaylists([other]);
    expect(result.stations.map((s) => s.id).sort()).toEqual(
      ["artist-radio-neon", "custom-neon-rain"].sort(),
    );
    expect(result.migrated).toBe(true);
  });
});

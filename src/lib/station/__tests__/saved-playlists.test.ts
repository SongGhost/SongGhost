import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StationDefinition } from "@/types/user";
import {
  hydrateSavedPlaylists,
  loadSavedPlaylists,
  normalizeSavedPlaylist,
  normalizeSavedPlaylists,
  saveSavedPlaylists,
  SAVED_PLAYLISTS_STORAGE_KEY,
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
});

describe("loadSavedPlaylists / saveSavedPlaylists", () => {
  it("round-trips a saved playlist through songghost:saved-playlists", () => {
    saveSavedPlaylists([sampleStation]);
    const raw = window.localStorage.getItem(SAVED_PLAYLISTS_STORAGE_KEY);
    expect(raw).toContain("custom-neon-rain");
    expect(loadSavedPlaylists()).toEqual([sampleStation]);
  });

  it("survives a reload-shaped re-read without clearing storage", () => {
    saveSavedPlaylists([sampleStation]);
    const first = loadSavedPlaylists();
    const second = loadSavedPlaylists();
    expect(first).toEqual([sampleStation]);
    expect(second).toEqual([sampleStation]);
    expect(window.localStorage.getItem(SAVED_PLAYLISTS_STORAGE_KEY)).toContain("Neon Rain");
  });

  it("logs corrupt JSON and leaves the raw value on disk", () => {
    window.localStorage.setItem(SAVED_PLAYLISTS_STORAGE_KEY, "not json{{{");
    expect(loadSavedPlaylists()).toEqual([]);
    expect(window.localStorage.getItem(SAVED_PLAYLISTS_STORAGE_KEY)).toBe("not json{{{");
    expect(console.warn).toHaveBeenCalledWith(
      "[SongGhost] savedPlaylistsHydrateFailed",
      expect.objectContaining({ error: expect.anything() }),
    );
  });

  it("logs a schema mismatch without overwriting storage", () => {
    const junk = JSON.stringify({ stations: [sampleStation] });
    window.localStorage.setItem(SAVED_PLAYLISTS_STORAGE_KEY, junk);
    expect(loadSavedPlaylists()).toEqual([]);
    expect(window.localStorage.getItem(SAVED_PLAYLISTS_STORAGE_KEY)).toBe(junk);
    expect(console.warn).toHaveBeenCalledWith(
      "[SongGhost] savedPlaylistsSchemaMismatch",
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

  it("prefers the dedicated key over a prefs slice", () => {
    saveSavedPlaylists([sampleStation]);
    const other: StationDefinition = {
      ...sampleStation,
      id: "other-mix",
      name: "Other Mix",
    };
    const result = hydrateSavedPlaylists([other]);
    expect(result.stations).toEqual([sampleStation]);
    expect(result.migrated).toBe(false);
  });
});

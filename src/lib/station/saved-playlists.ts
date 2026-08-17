/**
 * Listener-saved playlists (custom stations built from a live queue).
 *
 * Persisted under a dedicated localStorage key so the catalog survives prefs
 * schema churn and so a corrupt preferences blob cannot wipe named mixes on
 * hydrate. The React preferences context dual-writes here on every save.
 */

import { resolvePersonaId } from "@/data/personas";
import type { Station, StationCategory, StationTrack } from "@/data/stations";
import type { StationDefinition } from "@/types/user";
import {
  clampFmFrequency,
  DEFAULT_SAVED_STATION_ACCENT,
  DEFAULT_SAVED_STATION_FREQUENCY,
} from "@/lib/saved-stations";

/** Legacy global mirror — migrated into per-account keys on first read. */
export const SAVED_PLAYLISTS_STORAGE_KEY = "songghost:saved-playlists";

/** Account-scoped playlist mirror (`songhost:saved-playlists:${userId}`). */
export function savedPlaylistsStorageKey(userId: string | null | undefined): string {
  return userId?.trim()
    ? `songhost:saved-playlists:${userId.trim()}`
    : "songhost:saved-playlists:guest";
}

function isStorageReady(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage?.getItem === "function";
  } catch {
    return false;
  }
}

/** Union two catalogs; on id conflict keep the entry with the richer track list. */
export function mergeSavedStationLists(
  primary: readonly StationDefinition[],
  secondary: readonly StationDefinition[],
): StationDefinition[] {
  const byId = new Map<string, StationDefinition>();
  for (const station of secondary) byId.set(station.id, station);
  for (const station of primary) {
    const existing = byId.get(station.id);
    if (!existing || station.tracks.length >= existing.tracks.length) {
      byId.set(station.id, station);
    }
  }

  const out: StationDefinition[] = [];
  const seen = new Set<string>();
  for (const station of [...primary, ...secondary]) {
    if (seen.has(station.id)) continue;
    const chosen = byId.get(station.id);
    if (!chosen) continue;
    seen.add(station.id);
    out.push(chosen);
  }
  return out;
}

function normalizeCategory(value: unknown): StationCategory {
  return value === "genres" ? "genres" : "decades";
}

function normalizeSavedTrack(value: unknown): StationTrack | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<StationTrack>;
  if (typeof candidate.youtubeId !== "string" || !candidate.youtubeId.trim()) return null;
  if (typeof candidate.title !== "string" || !candidate.title.trim()) return null;
  if (typeof candidate.artist !== "string" || !candidate.artist.trim()) return null;

  const track: StationTrack = {
    youtubeId: candidate.youtubeId.trim(),
    title: candidate.title.trim(),
    artist: candidate.artist.trim(),
  };

  if (typeof candidate.previewUrl === "string" && candidate.previewUrl.trim()) {
    track.previewUrl = candidate.previewUrl.trim();
  }
  if (typeof candidate.itunesTrackId === "number" && Number.isFinite(candidate.itunesTrackId)) {
    track.itunesTrackId = candidate.itunesTrackId;
  }
  if (typeof candidate.album === "string" && candidate.album.trim()) {
    track.album = candidate.album.trim();
  }
  if (
    typeof candidate.releaseYear === "number" &&
    Number.isInteger(candidate.releaseYear) &&
    candidate.releaseYear > 0
  ) {
    track.releaseYear = candidate.releaseYear;
  }
  if (typeof candidate.spotifyId === "string" && candidate.spotifyId.trim()) {
    track.spotifyId = candidate.spotifyId.trim();
  }

  return track;
}

/**
 * Coerce one persisted custom station into a playable StationDefinition.
 *
 * Missing optional fields get safe defaults; a station without an id or name is
 * skipped rather than poisoning the whole list.
 */
export function normalizeSavedPlaylist(value: unknown): StationDefinition | null {
  if (typeof value !== "object" || value === null) {
    console.warn("[SongHost] savedPlaylistSchemaMismatch", { reason: "not-object" });
    return null;
  }

  const candidate = value as Partial<Station>;
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  if (!id || !name) {
    console.warn("[SongHost] savedPlaylistSchemaMismatch", {
      reason: "missing-id-or-name",
      id: id || null,
    });
    return null;
  }

  const tracks = Array.isArray(candidate.tracks)
    ? candidate.tracks
        .map(normalizeSavedTrack)
        .filter((track): track is StationTrack => track !== null)
    : [];

  const leadId =
    typeof candidate.youtubeVideoId === "string" && candidate.youtubeVideoId.trim()
      ? candidate.youtubeVideoId.trim()
      : (tracks[0]?.youtubeId ?? "");

  const station: StationDefinition = {
    id,
    name,
    frequency: clampFmFrequency(
      typeof candidate.frequency === "number" ? candidate.frequency : DEFAULT_SAVED_STATION_FREQUENCY,
    ),
    category: normalizeCategory(candidate.category),
    defaultPersonaId: resolvePersonaId(
      typeof candidate.defaultPersonaId === "string" ? candidate.defaultPersonaId : null,
    ),
    accentColor:
      typeof candidate.accentColor === "string" && candidate.accentColor.trim()
        ? candidate.accentColor.trim()
        : DEFAULT_SAVED_STATION_ACCENT,
    youtubeVideoId: leadId,
    tracks,
    description: typeof candidate.description === "string" ? candidate.description : "",
  };

  if (typeof candidate.coverUrl === "string" && candidate.coverUrl.trim()) {
    station.coverUrl = candidate.coverUrl.trim();
  }

  if (typeof candidate.youtubePlaylistId === "string" && candidate.youtubePlaylistId.trim()) {
    station.youtubePlaylistId = candidate.youtubePlaylistId.trim();
  }

  return station;
}

/** Normalize a persisted list, dropping only entries that cannot be salvaged. */
export function normalizeSavedPlaylists(value: unknown): StationDefinition[] {
  if (!Array.isArray(value)) {
    if (value !== undefined && value !== null) {
      console.warn("[SongHost] savedPlaylistsSchemaMismatch", { reason: "not-array" });
    }
    return [];
  }

  const seen = new Set<string>();
  const out: StationDefinition[] = [];
  for (const entry of value) {
    const station = normalizeSavedPlaylist(entry);
    if (!station || seen.has(station.id)) continue;
    seen.add(station.id);
    out.push(station);
  }
  return out;
}

/**
 * Current saved playlists, or empty when unavailable / unreadable.
 *
 * Corrupt JSON and schema mismatches are logged and left on disk — returning
 * [] for the session must not `removeItem` / overwrite the listener's catalog.
 */
export function loadSavedPlaylists(userId?: string | null): StationDefinition[] {
  if (!isStorageReady()) return [];
  try {
    const key = savedPlaylistsStorageKey(userId);
    let raw = window.localStorage.getItem(key);

    // Migrate the legacy global mirror (and guest shelf into a signed-in account).
    if (!raw) {
      const legacy =
        window.localStorage.getItem(SAVED_PLAYLISTS_STORAGE_KEY) ??
        (!userId?.trim()
          ? null
          : window.localStorage.getItem(savedPlaylistsStorageKey(null)));
      if (legacy) {
        window.localStorage.setItem(key, legacy);
        raw = legacy;
      }
    }

    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    return normalizeSavedPlaylists(parsed);
  } catch (error) {
    console.warn("[SongHost] savedPlaylistsHydrateFailed", { error });
    return [];
  }
}

export function saveSavedPlaylists(
  stations: readonly StationDefinition[],
  userId?: string | null,
): void {
  if (!isStorageReady()) return;
  try {
    const normalized = normalizeSavedPlaylists(stations);
    window.localStorage.setItem(
      savedPlaylistsStorageKey(userId),
      JSON.stringify(normalized),
    );
  } catch (error) {
    // Quota / private mode: keep the in-memory catalog for the caller.
    console.warn("[SongHost] savedPlaylistsPersistFailed", { error });
  }
}

/**
 * Merge the dedicated mirror with a prefs-blob slice so ephemeral Artist Radio
 * payloads that only landed in one place still survive reboot. Migrates onto
 * the per-account key when either source has stations.
 */
export function hydrateSavedPlaylists(
  prefsSlice: unknown,
  userId?: string | null,
): { stations: StationDefinition[]; migrated: boolean } {
  const fromDedicated = loadSavedPlaylists(userId);
  const fromPrefs = normalizeSavedPlaylists(prefsSlice);
  const merged = mergeSavedStationLists(fromPrefs, fromDedicated);

  if (merged.length === 0) {
    return { stations: [], migrated: false };
  }

  const needsMigrate =
    fromDedicated.length === 0 ||
    merged.length !== fromDedicated.length ||
    merged.some((station, index) => station.id !== fromDedicated[index]?.id);

  if (needsMigrate) {
    saveSavedPlaylists(merged, userId);
    return { stations: merged, migrated: true };
  }

  return { stations: merged, migrated: false };
}

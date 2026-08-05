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

/** Dedicated mirror — readable without waiting on the full prefs context. */
export const SAVED_PLAYLISTS_STORAGE_KEY = "songghost:saved-playlists";

function isStorageReady(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage?.getItem === "function";
  } catch {
    return false;
  }
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
    console.warn("[SongGhost] savedPlaylistSchemaMismatch", { reason: "not-object" });
    return null;
  }

  const candidate = value as Partial<Station>;
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  if (!id || !name) {
    console.warn("[SongGhost] savedPlaylistSchemaMismatch", {
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

  if (typeof candidate.youtubePlaylistId === "string" && candidate.youtubePlaylistId.trim()) {
    station.youtubePlaylistId = candidate.youtubePlaylistId.trim();
  }

  return station;
}

/** Normalize a persisted list, dropping only entries that cannot be salvaged. */
export function normalizeSavedPlaylists(value: unknown): StationDefinition[] {
  if (!Array.isArray(value)) {
    if (value !== undefined && value !== null) {
      console.warn("[SongGhost] savedPlaylistsSchemaMismatch", { reason: "not-array" });
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
export function loadSavedPlaylists(): StationDefinition[] {
  if (!isStorageReady()) return [];
  try {
    const raw = window.localStorage.getItem(SAVED_PLAYLISTS_STORAGE_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    return normalizeSavedPlaylists(parsed);
  } catch (error) {
    console.warn("[SongGhost] savedPlaylistsHydrateFailed", { error });
    return [];
  }
}

export function saveSavedPlaylists(stations: readonly StationDefinition[]): void {
  if (!isStorageReady()) return;
  try {
    window.localStorage.setItem(
      SAVED_PLAYLISTS_STORAGE_KEY,
      JSON.stringify(normalizeSavedPlaylists(stations)),
    );
  } catch (error) {
    // Quota / private mode: keep the in-memory catalog for the caller.
    console.warn("[SongGhost] savedPlaylistsPersistFailed", { error });
  }
}

/**
 * Prefer the dedicated mirror; fall back to a prefs-blob slice and migrate it
 * forward so older installs pick up the standalone key on first load.
 */
export function hydrateSavedPlaylists(
  prefsSlice: unknown,
): { stations: StationDefinition[]; migrated: boolean } {
  const fromDedicated = loadSavedPlaylists();
  if (fromDedicated.length > 0) {
    return { stations: fromDedicated, migrated: false };
  }

  const fromPrefs = normalizeSavedPlaylists(prefsSlice);
  if (fromPrefs.length > 0) {
    saveSavedPlaylists(fromPrefs);
    return { stations: fromPrefs, migrated: true };
  }

  return { stations: [], migrated: false };
}

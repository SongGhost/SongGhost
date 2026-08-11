/**
 * Listener preferences that live outside (and underneath) the full
 * UserPreferences React context — pinned preset IDs for the home browser, plus
 * serialization helpers so ephemeral Artist / Song / Curator radio stations
 * persist a complete `Station` payload across reboots.
 */

import type { PersonaId } from "@/data/personas";
import type { Station, StationTrack } from "@/data/stations";
import { isSavedStationId } from "@/lib/saved-stations";
import type { StationConfig } from "@/types/station";
import type { StationDefinition } from "@/types/user";

export const PINNED_PRESETS_STORAGE_KEY = "songghost:pinned-presets";

/** Account-scoped preferences blob (`songhost:prefs:${userId}`). */
export function prefsStorageKey(userId: string | null | undefined): string {
  return userId?.trim() ? `songhost:prefs:${userId.trim()}` : "songhost:prefs:guest";
}

/** Pre-SongHost key — read once and migrated forward on hydrate. */
export function legacyPrefsStorageKey(userId: string | null | undefined): string {
  return userId?.trim() ? `songghost-prefs-${userId.trim()}` : "songghost-prefs-guest";
}

function isStorageReady(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage?.getItem === "function";
  } catch {
    return false;
  }
}

/**
 * Read the raw prefs JSON for an account, migrating the legacy
 * `songghost-prefs-*` key into `songhost:prefs:*` when needed.
 *
 * Returns null when storage is unavailable or the key is empty — never invents
 * a default blob (callers must not write defaults while auth is still loading).
 */
export function readPrefsRaw(userId: string | null | undefined): string | null {
  if (!isStorageReady()) return null;
  try {
    const key = prefsStorageKey(userId);
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;

    const legacy = window.localStorage.getItem(legacyPrefsStorageKey(userId));
    if (!legacy) return null;

    window.localStorage.setItem(key, legacy);
    return legacy;
  } catch {
    return null;
  }
}

export function writePrefsRaw(userId: string | null | undefined, raw: string): void {
  if (!isStorageReady()) return;
  try {
    window.localStorage.setItem(prefsStorageKey(userId), raw);
  } catch {
    // Quota / private mode: keep the in-memory result for the caller.
  }
}

function normalizePinnedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const id = entry.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Current pinned preset station IDs, or empty when unavailable. */
export function loadPinnedStations(): string[] {
  if (!isStorageReady()) return [];
  try {
    const raw = window.localStorage.getItem(PINNED_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    return normalizePinnedIds(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function savePinnedStations(stationIds: string[]): void {
  if (!isStorageReady()) return;
  try {
    window.localStorage.setItem(
      PINNED_PRESETS_STORAGE_KEY,
      JSON.stringify(normalizePinnedIds(stationIds)),
    );
  } catch {
    // Quota / private mode: keep the in-memory result for the caller.
  }
}

export function isPinnedStation(stationId: string, pinnedIds: readonly string[]): boolean {
  return pinnedIds.includes(stationId);
}

/**
 * Toggle a station in the pinned set and persist. Returns the updated list
 * (pin added to the front when newly pinned so recent pins surface first).
 */
export function togglePinStation(
  stationId: string,
  currentPinnedIds: readonly string[] = loadPinnedStations(),
): string[] {
  const id = stationId.trim();
  if (!id) {
    const next = normalizePinnedIds(currentPinnedIds);
    savePinnedStations(next);
    return next;
  }

  const without = currentPinnedIds.filter((entry) => entry !== id);
  const next = without.length === currentPinnedIds.length ? [id, ...without] : without;
  const normalized = normalizePinnedIds(next);
  savePinnedStations(normalized);
  return normalized;
}

/** Stable sort: pinned stations first (in pin order), then the rest in original order. */
export function sortStationsWithPinsFirst<T extends { id: string }>(
  stations: readonly T[],
  pinnedIds: readonly string[],
): T[] {
  if (pinnedIds.length === 0) return [...stations];

  const byId = new Map(stations.map((station) => [station.id, station]));
  const pinned: T[] = [];
  const pinnedSet = new Set<string>();

  for (const id of pinnedIds) {
    const station = byId.get(id);
    if (!station || pinnedSet.has(id)) continue;
    pinned.push(station);
    pinnedSet.add(id);
  }

  const rest = stations.filter((station) => !pinnedSet.has(station.id));
  return [...pinned, ...rest];
}

/* ------------------------------------------------------------------ *
 * Ephemeral / dynamic station persistence
 * ------------------------------------------------------------------ */

/** Runtime-generated stations that vanish on reboot unless fully serialized. */
export function isDynamicStationId(stationId: string): boolean {
  const id = stationId.trim();
  return (
    id.startsWith("artist-radio-") ||
    id.startsWith("song-radio-") ||
    id.startsWith("ai-curator-") ||
    id.startsWith("heavy-rotation-")
  );
}

/** @deprecated Prefer {@link isDynamicStationId} — same predicate. */
export function isEphemeralStationId(stationId: string): boolean {
  return isDynamicStationId(stationId);
}

/**
 * True for listener-saved mixes and persisted dynamic radio IDs that relaunch
 * from `savedStations` rather than a live API response.
 */
export function isPersistedLaunchStationId(stationId: string): boolean {
  return isSavedStationId(stationId) || isDynamicStationId(stationId);
}

function isPlayableTrack(track: StationTrack): boolean {
  return Boolean(track.youtubeId?.trim() || track.previewUrl?.trim());
}

function cloneTrack(track: StationTrack): StationTrack {
  const out: StationTrack = {
    youtubeId: track.youtubeId?.trim() ?? "",
    title: track.title?.trim() ?? "",
    artist: track.artist?.trim() ?? "",
  };
  if (typeof track.previewUrl === "string" && track.previewUrl.trim()) {
    out.previewUrl = track.previewUrl.trim();
  }
  if (typeof track.itunesTrackId === "number" && Number.isFinite(track.itunesTrackId)) {
    out.itunesTrackId = track.itunesTrackId;
  }
  if (typeof track.album === "string" && track.album.trim()) {
    out.album = track.album.trim();
  }
  if (
    typeof track.releaseYear === "number" &&
    Number.isInteger(track.releaseYear) &&
    track.releaseYear > 0
  ) {
    out.releaseYear = track.releaseYear;
  }
  if (typeof track.spotifyId === "string" && track.spotifyId.trim()) {
    out.spotifyId = track.spotifyId.trim();
  }
  return out;
}

export type SerializeStationOptions = {
  /** Station-level overrides to bake into the saved snapshot (name, host, pacing). */
  config?: Partial<StationConfig> | null;
};

/**
 * Freeze a live (possibly ephemeral) station into a JSON-safe `StationDefinition`.
 *
 * Dynamic stations keep their runtime id (`artist-radio-*`, etc.) so memory
 * presets and the saved-stations drawer can resolve them after a reboot. Track
 * manifests, seed metadata, and host defaults are copied by value — never as a
 * live queue reference.
 */
export function serializeStationForSave(
  station: Station,
  options?: SerializeStationOptions,
): StationDefinition {
  const config = options?.config ?? null;
  const tracks = (station.tracks ?? []).map(cloneTrack).filter(isPlayableTrack);

  const overrideName =
    typeof config?.name === "string" && config.name.trim() ? config.name.trim() : null;
  const hostOverride =
    typeof config?.hostPersonaId === "string" && config.hostPersonaId.trim()
      ? (config.hostPersonaId.trim() as PersonaId)
      : null;

  const name = overrideName || station.name.trim() || "Saved Station";
  const leadId = tracks[0]?.youtubeId || station.youtubeVideoId || "";

  const serialized: StationDefinition = {
    id: station.id.trim(),
    name,
    frequency: typeof config?.frequency === "number" ? config.frequency : station.frequency,
    category: station.category === "genres" ? "genres" : "decades",
    defaultPersonaId: hostOverride ?? station.defaultPersonaId,
    accentColor: station.accentColor?.trim() || "#C4882A",
    youtubeVideoId: leadId,
    tracks,
    description:
      typeof station.description === "string" && station.description.trim()
        ? station.description
        : `Saved station — ${tracks.length} track${tracks.length === 1 ? "" : "s"}`,
  };

  if (typeof station.coverUrl === "string" && station.coverUrl.trim()) {
    serialized.coverUrl = station.coverUrl.trim();
  }

  if (typeof station.youtubePlaylistId === "string" && station.youtubePlaylistId.trim()) {
    serialized.youtubePlaylistId = station.youtubePlaylistId.trim();
  }

  // Chatter pacing lives in stationConfigs (keyed by id); the id retention above
  // is what lets that override map reattach after hydrate.
  return serialized;
}

/** Insert or replace a serialized station at the front of the saved catalog. */
export function upsertSavedStation(
  savedStations: readonly StationDefinition[],
  station: Station,
  options?: SerializeStationOptions,
): StationDefinition[] {
  const serialized = serializeStationForSave(station, options);
  if (!serialized.id) return [...savedStations];
  return [serialized, ...savedStations.filter((entry) => entry.id !== serialized.id)];
}

/**
 * Toggle a station in the saved catalog. Dynamic stations are serialized into a
 * full payload on save — never stored as a bare id reference.
 */
export function toggleSaveStation(
  savedStations: readonly StationDefinition[],
  station: Station,
  options?: SerializeStationOptions,
): { stations: StationDefinition[]; saved: boolean } {
  const id = station.id.trim();
  if (!id) {
    return { stations: [...savedStations], saved: false };
  }
  if (savedStations.some((entry) => entry.id === id)) {
    return {
      stations: savedStations.filter((entry) => entry.id !== id),
      saved: false,
    };
  }
  return {
    stations: upsertSavedStation(savedStations, station, options),
    saved: true,
  };
}

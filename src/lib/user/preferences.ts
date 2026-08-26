/**
 * Listener preferences that live outside (and underneath) the full
 * UserPreferences React context — pinned preset IDs for the home browser, plus
 * serialization helpers so ephemeral Artist / Song / Curator radio stations
 * persist a complete `Station` payload across reboots.
 */

import { resolvePersonaId, type PersonaId } from "@/data/personas";
import type { Station, StationSessionBreak, StationTrack } from "@/data/stations";
import { isSavedStationId } from "@/lib/saved-stations";
import {
  applyBlueprintSeeds,
  readBlueprintSeeds,
  shouldPersistLiveQueue,
} from "@/lib/station/blueprint";
import {
  isCommentaryFormat,
  resolveCommentaryFormat,
  type CommentaryFormat,
} from "@/types/dj";
import {
  isChatterPacing,
  normalizeMemoryPresets,
  normalizeStationConfigs,
  resolveChatterPacing,
  type ChatterPacing,
  type StationConfig,
  type StationConfigMap,
} from "@/types/station";
import {
  DEFAULT_PREFERENCES,
  type StationDefinition,
  type UserPreferences,
} from "@/types/user";
import {
  DEFAULT_VISUALIZER_MODE,
  isVisualizerMode,
} from "@/types/visuals";

export const PINNED_PRESETS_STORAGE_KEY = "songhost:pinned-presets";
const LEGACY_PINNED_PRESETS_STORAGE_KEY = "songghost:pinned-presets";

/**
 * Account-scoped preferences blob.
 * Spec name: `songhost:preferences` — implemented as `songhost:prefs:<userId>`
 * (or `songhost:prefs:guest`). Host Studio persona and lore live here
 * (and under `stationConfigs[stationId]` for per-station overrides).
 */
export const DEFAULT_USER_PREFERENCES: UserPreferences = DEFAULT_PREFERENCES;

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

/**
 * Hydrate a persisted (or partial) prefs blob into a safe `UserPreferences`.
 *
 * Host Studio lore / chatter are preserved when valid so a refresh
 * restores Tuning Console settings. Unknown / missing values fall back
 * rather than dropping the rest of the blob.
 */
export function normalizeUserPreferences(
  stored: Partial<UserPreferences> | null | undefined,
): UserPreferences {
  const source = stored ?? {};
  const {
    mood: _retiredMood,
    personality: _retiredPersonality,
    ...rest
  } = source as Partial<UserPreferences> & {
    mood?: unknown;
    personality?: unknown;
  };
  return {
    ...DEFAULT_USER_PREFERENCES,
    ...rest,
    // Pacing is engine-owned, so a value persisted by an older build must not stick.
    djPacingFrequency: DEFAULT_USER_PREFERENCES.djPacingFrequency,
    activePersonaId: resolvePersonaId(source.activePersonaId),
    chatterPacing: resolveChatterPacing(source.chatterPacing),
    commentaryFormat: resolveCommentaryFormat(source.commentaryFormat),
    homeCity:
      typeof source.homeCity === "string" && source.homeCity.trim()
        ? source.homeCity.trim()
        : undefined,
    visualizerMode: isVisualizerMode(source.visualizerMode)
      ? source.visualizerMode
      : DEFAULT_VISUALIZER_MODE,
    lastStationId:
      typeof source.lastStationId === "string" && source.lastStationId.trim()
        ? source.lastStationId.trim()
        : undefined,
    memoryPresets: normalizeMemoryPresets(source.memoryPresets),
    stationConfigs: normalizeStationConfigs(source.stationConfigs),
    playHistory: Array.isArray(source.playHistory) ? source.playHistory : [],
    likedTracks: Array.isArray(source.likedTracks) ? source.likedTracks : [],
    savedStations: Array.isArray(source.savedStations) ? source.savedStations : [],
    allowExplicit:
      typeof source.allowExplicit === "boolean"
        ? source.allowExplicit
        : DEFAULT_USER_PREFERENCES.allowExplicit,
    alwaysAnnounceSongs:
      typeof source.alwaysAnnounceSongs === "boolean"
        ? source.alwaysAnnounceSongs
        : DEFAULT_USER_PREFERENCES.alwaysAnnounceSongs,
    userTier: source.userTier === "Pro" ? "Pro" : DEFAULT_USER_PREFERENCES.userTier,
  };
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
    if (raw) return normalizePinnedIds(JSON.parse(raw) as unknown);

    const legacy = window.localStorage.getItem(LEGACY_PINNED_PRESETS_STORAGE_KEY);
    if (!legacy) return [];
    const ids = normalizePinnedIds(JSON.parse(legacy) as unknown);
    window.localStorage.setItem(PINNED_PRESETS_STORAGE_KEY, JSON.stringify(ids));
    return ids;
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
    id.startsWith("heavy-rotation-") ||
    id.startsWith("album-deep-dive-") ||
    id.startsWith("studio-") ||
    id.startsWith("tuner-") ||
    id.startsWith("inspired-")
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
  return Boolean(
    track.youtubeId?.trim() ||
      track.streamUrl?.trim() ||
      track.previewUrl?.trim() ||
      track.spotifyId?.trim(),
  );
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
  if (typeof track.streamUrl === "string" && track.streamUrl.trim()) {
    out.streamUrl = track.streamUrl.trim();
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
 * presets and the saved-stations drawer can resolve them after a reboot.
 * Studio / tuner / saved / catalog parks store Station Profile JSON (seeds +
 * StationConfig) rather than a frozen listener-ordered track list.
 */
export function serializeStationForSave(
  station: Station,
  options?: SerializeStationOptions,
): StationDefinition {
  const config = options?.config ?? null;
  const persistQueue = shouldPersistLiveQueue(station.id);
  const tracks = persistQueue
    ? (station.tracks ?? []).map(cloneTrack).filter(isPlayableTrack)
    : [];

  const overrideName =
    typeof config?.name === "string" && config.name.trim() ? config.name.trim() : null;
  const hostOverride =
    typeof config?.hostPersonaId === "string" && config.hostPersonaId.trim()
      ? resolvePersonaId(config.hostPersonaId.trim())
      : null;

  const name = overrideName || station.name.trim() || "Saved Station";
  const leadId = tracks[0]?.youtubeId || station.youtubeVideoId || "";
  const seeds = applyBlueprintSeeds(
    {},
    {
      ...readBlueprintSeeds(station),
      vibePrompt:
        (typeof config?.vibePrompt === "string" && config.vibePrompt.trim()
          ? config.vibePrompt.trim()
          : undefined) ?? readBlueprintSeeds(station).vibePrompt,
    },
  );

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
        : seeds.seedGenres?.length || seeds.seedArtists?.length
          ? `Live channel — ${(seeds.seedGenres ?? seeds.seedArtists ?? []).slice(0, 3).join(" · ")}`
          : "Saved station profile",
    ...seeds,
  };

  if (typeof station.coverUrl === "string" && station.coverUrl.trim()) {
    serialized.coverUrl = station.coverUrl.trim();
  }

  if (typeof station.youtubePlaylistId === "string" && station.youtubePlaylistId.trim()) {
    serialized.youtubePlaylistId = station.youtubePlaylistId.trim();
  }

  if (station.studioBreaks?.length) {
    serialized.studioBreaks = station.studioBreaks.map(cloneSessionBreak);
  }

  // Chatter pacing lives in stationConfigs (keyed by id); the id retention above
  // is what lets that override map reattach after hydrate.
  return serialized;
}

function cloneSessionBreak(cue: StationSessionBreak): StationSessionBreak {
  const next: StationSessionBreak = {};
  if (cue.kind) next.kind = cue.kind;
  if (cue.sessionTrigger) next.sessionTrigger = cue.sessionTrigger;
  if (typeof cue.everyNTracks === "number") next.everyNTracks = cue.everyNTracks;
  if (cue.audioUrl?.trim()) next.audioUrl = cue.audioUrl.trim();
  if (cue.customText?.trim()) next.customText = cue.customText.trim();
  if (cue.voiceId?.trim()) next.voiceId = cue.voiceId.trim();
  if (cue.label?.trim()) next.label = cue.label.trim();
  if (cue.isCallIn === true) next.isCallIn = true;
  return next;
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

/* ------------------------------------------------------------------ *
 * Cross-device cloud preference payload (Postgres users.preferences JSONB)
 * ------------------------------------------------------------------ */

/** Host Retention stamps mirrored into `sessionStore` localStorage keys. */
export type HostRetentionSync = {
  activeHostId: string | null;
  isHostLocked: boolean;
};

/**
 * Slice of listener settings synced through `/api/user/sync`.
 * Memory dials and saved stations stay on their own tables; this blob must
 * never be written to Clerk `unsafeMetadata`.
 */
export type CloudPreferencesPayload = {
  activePersonaId?: PersonaId;
  commentaryFormat?: CommentaryFormat;
  chatterPacing?: ChatterPacing;
  stationConfigs?: StationConfigMap;
  hostRetention?: HostRetentionSync;
  lastStationId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeHostRetentionSync(value: unknown): HostRetentionSync | undefined {
  if (!isRecord(value)) return undefined;
  const rawId = value.activeHostId;
  const activeHostId =
    typeof rawId === "string" && rawId.trim()
      ? resolvePersonaId(rawId)
      : rawId === null
        ? null
        : undefined;
  if (activeHostId === undefined && typeof value.isHostLocked !== "boolean") {
    return undefined;
  }
  return {
    activeHostId: activeHostId === undefined ? null : activeHostId,
    isHostLocked: value.isHostLocked === true,
  };
}

/**
 * Parse a cloud / POST `preferences` object. Returns `null` when the value is
 * absent or carries none of the synced keys — callers must not treat that as
 * "reset to defaults" or they will clobber a healthy local blob.
 */
export function normalizeCloudPreferences(
  value: unknown,
): CloudPreferencesPayload | null {
  if (!isRecord(value)) return null;

  const payload: CloudPreferencesPayload = {};

  if (typeof value.activePersonaId === "string" && value.activePersonaId.trim()) {
    payload.activePersonaId = resolvePersonaId(value.activePersonaId);
  }
  if (isCommentaryFormat(value.commentaryFormat)) {
    payload.commentaryFormat = value.commentaryFormat;
  }
  if (isChatterPacing(value.chatterPacing)) {
    payload.chatterPacing = value.chatterPacing;
  }
  if (isRecord(value.stationConfigs)) {
    payload.stationConfigs = normalizeStationConfigs(value.stationConfigs);
  }
  const hostRetention = normalizeHostRetentionSync(value.hostRetention);
  if (hostRetention) payload.hostRetention = hostRetention;
  if (typeof value.lastStationId === "string" && value.lastStationId.trim()) {
    payload.lastStationId = value.lastStationId.trim();
  }

  return Object.keys(payload).length > 0 ? payload : null;
}

/**
 * Overlay remote cloud fields onto a hydrated local prefs blob. Cloud wins
 * except `lastStationId`: a local id set during the active session must not
 * be clobbered by a stale JSONB document from an in-flight GET.
 */
export function mergeCloudPreferencesOverLocal(
  local: UserPreferences,
  remote: CloudPreferencesPayload,
): UserPreferences {
  const localLastStationId = local.lastStationId?.trim() || "";
  const lastStationId = localLastStationId || remote.lastStationId?.trim() || "";
  return {
    ...local,
    ...(remote.activePersonaId ? { activePersonaId: remote.activePersonaId } : {}),
    ...(remote.commentaryFormat
      ? { commentaryFormat: remote.commentaryFormat }
      : {}),
    ...(remote.chatterPacing
      ? { chatterPacing: remote.chatterPacing }
      : {}),
    ...(lastStationId ? { lastStationId } : {}),
    stationConfigs: remote.stationConfigs
      ? { ...local.stationConfigs, ...remote.stationConfigs }
      : local.stationConfigs,
  };
}

/** Snapshot the cloud-synced slice from live prefs + Host Retention. */
export function buildCloudPreferencesPayload(
  prefs: UserPreferences,
  hostRetention: HostRetentionSync,
): CloudPreferencesPayload {
  return {
    activePersonaId: resolvePersonaId(prefs.activePersonaId),
    commentaryFormat: resolveCommentaryFormat(prefs.commentaryFormat),
    chatterPacing: prefs.chatterPacing,
    stationConfigs: normalizeStationConfigs(prefs.stationConfigs),
    hostRetention: {
      activeHostId: hostRetention.activeHostId?.trim()
        ? resolvePersonaId(hostRetention.activeHostId)
        : null,
      isHostLocked: hostRetention.isHostLocked === true,
    },
    ...(typeof prefs.lastStationId === "string" && prefs.lastStationId.trim()
      ? { lastStationId: prefs.lastStationId.trim() }
      : {}),
  };
}

/** POST `/api/user/sync` is valid when any of the three payloads is present. */
export function isUserSyncPostBodyValid(body: {
  memoryPresets?: unknown;
  savedStations?: unknown;
  preferences?: unknown;
}): boolean {
  return (
    body.memoryPresets !== undefined ||
    body.savedStations !== undefined ||
    body.preferences !== undefined
  );
}

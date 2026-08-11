/**
 * Client helpers for Phase 5B hybrid storage — localStorage first, then
 * background upsert to PostgreSQL via `/api/user/sync`.
 */

import {
  normalizeMemoryPresets,
  normalizeStationConfig,
  type MemoryPresetList,
  type StationConfigMap,
} from "@/types/station";
import type { StationDefinition } from "@/types/user";

export type UserSyncPayload = {
  memoryPresets: MemoryPresetList;
  savedStations: StationDefinition[];
  /** Optional per-station overrides folded into memory-slot JSON on upsert. */
  stationConfigs?: StationConfigMap;
};

export type UserSyncResponse = {
  memoryPresets: MemoryPresetList;
  savedStations: StationDefinition[];
  /**
   * Host / pacing overrides rebuilt from memory-slot JSON (`personaId` + nested
   * `stationConfig`). Present on modern sync responses; older payloads omit it.
   */
  stationConfigs?: StationConfigMap;
};

/** Fetch cloud memory presets + saved stations for the signed-in Clerk user. */
export async function fetchUserSync(): Promise<UserSyncResponse | null> {
  try {
    const res = await fetch("/api/user/sync", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as UserSyncResponse;
  } catch (error) {
    console.warn("[SongGhost] userSyncFetchFailed", { error });
    return null;
  }
}

/**
 * Fire-and-forget POST of the latest memory / saved-station snapshot.
 * Failures are logged only — localStorage remains the source of truth offline.
 */
export function pushUserSync(payload: {
  memoryPresets?: MemoryPresetList;
  savedStations?: StationDefinition[];
  stationConfigs?: StationConfigMap;
}): void {
  if (typeof window === "undefined") return;
  void (async () => {
    try {
      const res = await fetch("/api/user/sync", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        console.warn("[SongGhost] userSyncPushFailed", { status: res.status });
      }
    } catch (error) {
      console.warn("[SongGhost] userSyncPushFailed", { error });
    }
  })();
}

/** True when at least one of the six dial slots is parked. */
export function hasAssignedMemoryPresets(presets: MemoryPresetList | undefined): boolean {
  return Boolean(presets?.some(Boolean));
}

/**
 * Fold cloud memory-slot host settings into the client's `stationConfigs` map.
 *
 * Applies (in order): existing local overrides → remote `stationConfigs` from
 * nested slot JSON → each preset's `personaId` as `hostPersonaId`. That way a
 * parked dial host is available immediately on boot before the listener tunes.
 */
export function rehydrateStationConfigsFromSync(
  existing: StationConfigMap,
  remote: Pick<UserSyncResponse, "memoryPresets" | "stationConfigs">,
): StationConfigMap {
  const next: StationConfigMap = { ...existing };

  if (remote.stationConfigs) {
    for (const [stationId, config] of Object.entries(remote.stationConfigs)) {
      if (!stationId.trim()) continue;
      next[stationId] = normalizeStationConfig(stationId, {
        ...next[stationId],
        ...config,
      });
    }
  }

  for (const preset of normalizeMemoryPresets(remote.memoryPresets)) {
    if (!preset?.personaId || !preset.stationId.trim()) continue;
    const stationId = preset.stationId;
    next[stationId] = normalizeStationConfig(stationId, {
      ...next[stationId],
      hostPersonaId: preset.personaId,
    });
  }

  return next;
}

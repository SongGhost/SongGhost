/**
 * Client-side helpers for `/api/user/sync` rehydration.
 *
 * The live pull still runs inside `UserPreferencesContext` (it owns `setPrefs`);
 * this module exposes the pure merge used on initial boot so call sites and
 * tests can share one definition of "preset persona → stationConfigs".
 *
 * Starter memory presets (`buildStarterMemoryPresets`) populate dial slots only.
 * They must never be merged into account `savedStations` — that list is
 * authenticated + cloud-synced exclusively.
 */

export {
  fetchUserSync,
  hasAssignedMemoryPresets,
  pushUserSync,
  rehydrateStationConfigsFromSync,
  type UserSyncPayload,
  type UserSyncResponse,
} from "@/lib/user/cloud-sync";

export {
  STARTER_MEMORY_STATION_IDS,
  areStarterMemoryPresets,
  buildStarterMemoryPresets,
  type StarterMemoryStationId,
} from "@/lib/user/starter-presets";

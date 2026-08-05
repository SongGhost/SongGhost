/**
 * Lightweight listener preferences that live outside the full UserPreferences
 * context — pin/favorite preset station IDs for the home browser.
 */

export const PINNED_PRESETS_STORAGE_KEY = "songghost:pinned-presets";

function isStorageReady(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage?.getItem === "function";
  } catch {
    return false;
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

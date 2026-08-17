/**
 * Cross-session memory of which track opened each station, so relaunching a
 * station does not replay the same first song.
 *
 * Every launch path draws its opener at random, but chance alone repeats far
 * more often than listeners forgive: preset stations draw from a curated seed
 * pool, and the weighted Tier 1 draw used by artist radio lands on the
 * top-ranked hit disproportionately. Remembering recent openers turns those
 * draws into a rotation.
 *
 * Backed by `localStorage` rather than `sessionStorage` because a fresh tab is
 * the most common way listeners return to a station — session-scoped memory
 * would be empty for exactly the launch that needs it most.
 */

const STORAGE_KEY_PREFIX = "songhost:starter-history:";
const LEGACY_STORAGE_KEY_PREFIX = "songghost:starter-history:";

/**
 * How many recent openers to avoid.
 *
 * Sized against the deep preset pools in `station-seeds.ts` (30-50 staples):
 * remembering only a handful there leaves a launch likely to land on something
 * heard two sessions ago. Pools smaller than the limit stay safe because
 * `rememberStarter` stores unique ids and `selectFreshStarterIndex` relaxes the
 * exclusion when everything has played.
 */
export const STARTER_HISTORY_LIMIT = 20;

function storageKey(bucket: string): string {
  return `${STORAGE_KEY_PREFIX}${bucket}`;
}

/**
 * Whether opener history can be read and written right now.
 *
 * False during SSR and before hydration, and also when storage is present but
 * blocked (private mode, third-party-cookie policies in an embed). Callers must
 * check this rather than treating an empty history as "nothing has played" —
 * that misreading is what makes every launch open on the same index-0 track.
 */
export function isStarterHistoryReady(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.localStorage?.getItem === "function";
  } catch {
    return false;
  }
}

/** Most recent opener first. Empty when unavailable or unreadable. */
export function readStarterHistory(bucket: string): string[] {
  if (!isStarterHistoryReady()) return [];
  try {
    let raw = window.localStorage.getItem(storageKey(bucket));
    if (!raw) {
      raw = window.localStorage.getItem(`${LEGACY_STORAGE_KEY_PREFIX}${bucket}`);
      if (raw) {
        window.localStorage.setItem(storageKey(bucket), raw);
      }
    }
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

/** Records `trackId` as the newest opener for `bucket`, dropping any older entry for it. */
export function rememberStarter(bucket: string, trackId: string): void {
  if (!isStarterHistoryReady() || !trackId) return;
  const next = [trackId, ...readStarterHistory(bucket).filter((id) => id !== trackId)].slice(
    0,
    STARTER_HISTORY_LIMIT,
  );
  try {
    window.localStorage.setItem(storageKey(bucket), JSON.stringify(next));
  } catch {
    // Private mode or a full quota costs us anti-repeat, nothing more.
  }
}

/**
 * Index of the earliest item that is not a recent opener.
 *
 * Callers pass an already-ordered pool — shuffled for preset seeds, weighted for
 * server-ordered queues — so taking the *earliest* fresh item both honors that
 * ordering and keeps artist radio opening on a front-loaded hit.
 *
 * When every item has played recently the exclusion relaxes one entry at a time,
 * giving back the least recent opener first. Returns 0 for a pool of one, and -1
 * only for an empty pool.
 */
export function selectFreshStarterIndex<T>(
  items: readonly T[],
  identify: (item: T) => string,
  history: readonly string[],
): number {
  if (items.length === 0) return -1;

  for (let depth = Math.min(history.length, STARTER_HISTORY_LIMIT); depth > 0; depth--) {
    const avoid = new Set(history.slice(0, depth));
    const index = items.findIndex((item) => !avoid.has(identify(item)));
    if (index >= 0) return index;
  }

  return 0;
}

/** Moves `index` to the front, leaving the relative order of everything else intact. */
export function moveToFront<T>(items: readonly T[], index: number): T[] {
  if (index <= 0 || index >= items.length) return [...items];
  return [items[index], ...items.slice(0, index), ...items.slice(index + 1)];
}

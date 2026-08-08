/**
 * Session-scoped recently played track ids (last 100). Shared between the
 * station queue hook and Song/Artist Radio launch fetches so recommendation
 * pools can exclude tracks already heard this page session.
 */

const MAX_RECENT = 100;

let recentTrackIds: string[] = [];

export function getRecentTrackIds(): readonly string[] {
  return recentTrackIds;
}

export function rememberRecentTrackId(id: string): void {
  const trimmed = id.trim();
  if (!trimmed) return;

  const next = recentTrackIds.filter((entry) => entry !== trimmed);
  next.push(trimmed);
  recentTrackIds = next.slice(-MAX_RECENT);
}

export function rememberRecentTrackIds(ids: readonly string[]): void {
  for (const id of ids) rememberRecentTrackId(id);
}

/** Test / hard-reset helper — not used on normal station changes. */
export function clearRecentTrackIds(): void {
  recentTrackIds = [];
}

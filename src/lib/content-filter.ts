/**
 * Explicit-content / Clean Mode helpers shared by catalog routes and clients.
 */

/** Parse `allowExplicit` query/body values. Missing → Clean Mode (false). */
export function parseAllowExplicit(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

type ExplicitFlagged = { explicit?: boolean | null };

/**
 * Drop tracks marked explicit when Clean Mode is on.
 * Unknown / missing `explicit` is kept (cannot confirm explicitness).
 */
export function filterExplicitTracks<T extends ExplicitFlagged>(
  tracks: readonly T[],
  allowExplicit: boolean,
): T[] {
  if (allowExplicit) return [...tracks];
  return tracks.filter((track) => track.explicit !== true);
}

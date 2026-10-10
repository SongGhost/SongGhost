import type { Station } from "@/data/stations";
import { STATION_FAMILIES } from "@/data/station-lanes";

const DECADE_ORDER = ["50s", "60s", "70s", "80s", "90s", "Y2K", "2000s", "2010s", "2020s"];

/** Decade chip for a station. A lane with no era does not join a decade. */
export function stationEraLabel(station: Pick<Station, "era">): string | null {
  const era = station.era?.trim();
  return era || null;
}

export function stationMatchesDecade(station: Pick<Station, "era">, decade: string): boolean {
  const era = stationEraLabel(station);
  if (!era || !decade.trim()) return false;
  return era.toLowerCase() === decade.trim().toLowerCase();
}

export function stationMatchesFamily(station: Pick<Station, "family">, family: string): boolean {
  const name = station.family?.trim();
  if (!name || !family.trim()) return false;
  return name.toLowerCase() === family.trim().toLowerCase();
}

/** Families that actually have a station, in the shelf order. */
export function familiesOnShelf(stations: readonly Pick<Station, "family">[]): string[] {
  const present = new Set(
    stations.map((station) => station.family?.trim()).filter((name): name is string => Boolean(name)),
  );
  const ordered = STATION_FAMILIES.filter((family) => present.has(family));
  for (const family of present) {
    if (!ordered.includes(family as (typeof STATION_FAMILIES)[number])) ordered.push(family as (typeof STATION_FAMILIES)[number]);
  }
  return ordered;
}

/** Decade chips that have at least one station with that era. */
export function decadesOnShelf(stations: readonly Pick<Station, "era">[]): string[] {
  const present = new Set(
    stations.map((station) => stationEraLabel(station)).filter((era): era is string => Boolean(era)),
  );
  const ordered = DECADE_ORDER.filter((label) => present.has(label));
  for (const label of present) {
    if (!ordered.includes(label)) ordered.push(label);
  }
  return ordered;
}

export function stationsInFamily<T extends Pick<Station, "family">>(
  stations: readonly T[],
  family: string | null,
): T[] {
  if (!family) return [...stations];
  return stations.filter((station) => stationMatchesFamily(station, family));
}

/**
 * Decade shelf. Stations with no era stay off it.
 * A selected decade keeps only that era. A family narrows further.
 */
/** The star pins. It does not start playback. */
export function onPinClick(
  event: { stopPropagation(): void },
  stationId: string,
  toggle: (stationId: string) => void,
): void {
  event.stopPropagation();
  toggle(stationId);
}

export function stationsInDecade<T extends Pick<Station, "era" | "family">>(
  stations: readonly T[],
  decade: string | null,
  family: string | null,
): T[] {
  let next = stations.filter((station) => stationEraLabel(station));
  if (decade) next = next.filter((station) => stationMatchesDecade(station, decade));
  if (family) next = next.filter((station) => stationMatchesFamily(station, family));
  return next;
}

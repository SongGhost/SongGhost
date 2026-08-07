import type { Station } from "@/data/stations";
import { getEraDefinition, type EraLock } from "@/types/station";

const DECADE_SLUG =
  /^(50s|60s|70s|80s|90s|2000s|2010s|2020s)$/i;

/** Keep decade tokens title-cased as `70s` / `2000s`, not `70S`. */
function formatDecadeLabel(value: string): string {
  const lower = value.toLowerCase();
  if (DECADE_SLUG.test(lower)) return lower;
  return value.toUpperCase();
}

function slugWords(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .join(" ")
    .toUpperCase()
    .replace(/\bROOTS\b/g, "ROOT");
}

/**
 * Clean `[GENRE • ERA]` metadata for station cards, memory presets, and the
 * player chrome — replaces skeuomorphic FM dial labels in the UI.
 */
export function formatStationMetaTag(
  station: Pick<Station, "id" | "name" | "category">,
  eraLock: EraLock = "all",
): string {
  const segments = station.id.split("-").filter(Boolean);
  const head = segments[0] ?? "";

  if (DECADE_SLUG.test(head) || station.category === "decades") {
    const era = DECADE_SLUG.test(head)
      ? formatDecadeLabel(head)
      : inferDecadeLabel(station.name) ?? "ERA";
    const genreSegments = DECADE_SLUG.test(head) ? segments.slice(1) : segments;
    const genre = genreSegments.length > 0 ? slugWords(genreSegments.join("-")) : "MIX";
    return `${genre} • ${era}`;
  }

  const genre = (segments[0] ?? "STATION").toUpperCase();
  if (eraLock !== "all") {
    return `${genre} • ${getEraDefinition(eraLock).shortLabel}`;
  }

  const rest = segments.slice(1);
  if (rest.length > 0) {
    return `${genre} • ${slugWords(rest.join("-"))}`;
  }

  return `${genre} • ALL`;
}

function inferDecadeLabel(name: string): string | null {
  const match = name.match(/\b(50s|60s|70s|80s|90s|2000s|2010s|2020s)\b/i);
  return match ? formatDecadeLabel(match[1]) : null;
}

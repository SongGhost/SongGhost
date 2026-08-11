/**
 * Maps station decades and genres onto the standard host roster.
 *
 * Preset stations carry an explicit `defaultPersonaId`; this resolver covers the
 * paths where no host has been chosen yet — artist search, AI Curator prompts, and
 * custom station generation.
 */

import {
  DEFAULT_PERSONA,
  PERSONAS,
  PERSONA_MAP,
  resolvePersonaId,
  type DjPersona,
  type PersonaId,
} from "@/data/personas";

/**
 * Decade → primary host fallback when no genre keyword matches.
 * Genre matching always wins; these cover decade-only queries.
 */
export const DECADE_DJ_MAP: Readonly<Record<string, PersonaId>> = Object.freeze({
  "50s": "devon-pulse",
  "1950s": "devon-pulse",
  "60s": "jasper-reed",
  "1960s": "jasper-reed",
  "70s": "jasper-reed",
  "1970s": "jasper-reed",
  "80s": "sloane-vance",
  "1980s": "sloane-vance",
  "90s": "miles",
  "1990s": "miles",
  y2k: "sloane-vance",
  "2000s": "sloane-vance",
  "2010s": "sloane-vance",
  "2020s": "kira-nova",
});

/**
 * Genre keyword → host, derived from each persona's own `genreTags` so the roster
 * stays the single source of truth.
 */
export const GENRE_DJ_MAP: Readonly<Record<string, PersonaId>> = Object.freeze(
  PERSONAS.reduce<Record<string, PersonaId>>((map, persona) => {
    for (const tag of persona.genreTags) {
      map[normalizeKeyword(tag)] = persona.id;
    }
    return map;
  }, {}),
);

const GENRE_KEYWORDS = Object.keys(GENRE_DJ_MAP).sort((a, b) => b.length - a.length);
const DECADE_KEYWORDS = Object.keys(DECADE_DJ_MAP).sort((a, b) => b.length - a.length);

/** Normalize for matching: lowercase, hyphens/underscores → spaces, collapse whitespace. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKeyword(value: string): string {
  return normalize(value);
}

/**
 * Longest keyword wins, so "smooth jazz" beats "jazz" and "90s country" beats "country".
 * Keywords are pre-sorted longest-first for stable partial / substring matches.
 */
function bestMatch(haystack: string, keywords: readonly string[]): string | undefined {
  for (const keyword of keywords) {
    if (haystack.includes(keyword)) return keyword;
  }
  return undefined;
}

/**
 * Picks the host for a free-text search or custom prompt. Genre wins over decade —
 * "90s boom bap" is Miles' show, not a decade fallback — and an unmatched query falls
 * back to the default host rather than leaving the booth empty.
 */
export function resolveDjForQuery(query: string, genreTags?: string[]): DjPersona {
  const haystack = normalize([query, ...(genreTags ?? [])].join(" "));
  if (!haystack) return DEFAULT_PERSONA;

  const genre = bestMatch(haystack, GENRE_KEYWORDS);
  if (genre) return PERSONA_MAP[GENRE_DJ_MAP[genre]];

  const decade = bestMatch(haystack, DECADE_KEYWORDS);
  if (decade) return PERSONA_MAP[DECADE_DJ_MAP[decade]];

  return DEFAULT_PERSONA;
}

/** Same resolution, id only — convenient for station records and API payloads. */
export function resolveDjIdForQuery(query: string, genreTags?: string[]): PersonaId {
  return resolveDjForQuery(query, genreTags).id;
}

export type StationPersonaInput = {
  name?: string;
  description?: string;
  /** Optional genre / tag strings from the station or tuner */
  genres?: string[];
  genreTags?: string[];
  defaultPersonaId?: string;
};

/**
 * Host for a station record. An explicit assignment always wins; stations built at
 * runtime (curator, artist radio, saved mixes) fall through to genre-keyword matching
 * on name, description, and supplied genre tags before the default host.
 *
 * Examples: "90s Country" → Henry Monroe, "Lo-Fi Study" → Devon Tyler, "90s Boom Bap" → Miles.
 */
export function getPersonaForStation(station: StationPersonaInput): DjPersona {
  if (station.defaultPersonaId) {
    return PERSONA_MAP[resolvePersonaId(station.defaultPersonaId)];
  }

  const tags = [...(station.genres ?? []), ...(station.genreTags ?? [])];
  return resolveDjForQuery(
    [station.name, station.description].filter(Boolean).join(" "),
    tags,
  );
}

/**
 * @deprecated Prefer {@link getPersonaForStation} — same behavior, clearer name.
 */
export function resolveDjForStation(station: StationPersonaInput): DjPersona {
  return getPersonaForStation(station);
}

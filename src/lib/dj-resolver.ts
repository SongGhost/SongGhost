/**
 * Maps station decades and genres onto the host roster.
 *
 * Personas are genre-agnostic (voice / persona / vernacular are independent
 * axes). Auto-assignment without an explicit `defaultPersonaId` lands on
 * Standard Broadcast. Genre vernacular is WS-3.
 */

import {
  DEFAULT_PERSONA,
  PERSONA_MAP,
  resolvePersonaId,
  type DjPersona,
  type PersonaId,
} from "@/data/personas";

/**
 * Decade → host fallback when no explicit persona is set.
 * All decades resolve to Standard Broadcast — personas are not genre-locked.
 */
export const DECADE_DJ_MAP: Readonly<Record<string, PersonaId>> = Object.freeze({
  "50s": "standard-broadcast",
  "1950s": "standard-broadcast",
  "60s": "standard-broadcast",
  "1960s": "standard-broadcast",
  "70s": "standard-broadcast",
  "1970s": "standard-broadcast",
  "80s": "standard-broadcast",
  "1980s": "standard-broadcast",
  "90s": "standard-broadcast",
  "1990s": "standard-broadcast",
  y2k: "standard-broadcast",
  "2000s": "standard-broadcast",
  "2010s": "standard-broadcast",
  "2020s": "standard-broadcast",
});

/**
 * Genre keyword → host. Empty: vernacular (WS-3) layers on the persona
 * rather than swapping the host identity.
 */
export const GENRE_DJ_MAP: Readonly<Record<string, PersonaId>> = Object.freeze({});

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
 * Picks the host for a free-text search or custom prompt.
 * Personas are genre-agnostic — unmatched and matched queries both land on
 * Standard Broadcast unless an explicit persona id is supplied elsewhere.
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
 * Host for a station record. An explicit assignment always wins (legacy ids
 * migrate via {@link resolvePersonaId}); otherwise Standard Broadcast.
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

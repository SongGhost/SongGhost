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
 * Decade → primary host. Rock-era decades belong to Johnny Static, the alt/indie
 * era to Sloane Vance, and the streaming era to Devon Pulse.
 */
export const DECADE_DJ_MAP: Readonly<Record<string, PersonaId>> = Object.freeze({
  "50s": "johnny-static",
  "1950s": "johnny-static",
  "60s": "johnny-static",
  "1960s": "johnny-static",
  "70s": "johnny-static",
  "1970s": "johnny-static",
  "80s": "johnny-static",
  "1980s": "johnny-static",
  "90s": "sloane-vance",
  "1990s": "sloane-vance",
  y2k: "sloane-vance",
  "2000s": "sloane-vance",
  "2010s": "sloane-vance",
  "2020s": "devon-pulse",
});

/**
 * Genre keyword → host, derived from each persona's own `genreTags` so the roster
 * stays the single source of truth.
 */
export const GENRE_DJ_MAP: Readonly<Record<string, PersonaId>> = Object.freeze(
  PERSONAS.reduce<Record<string, PersonaId>>((map, persona) => {
    for (const tag of persona.genreTags) map[tag] = persona.id;
    return map;
  }, {}),
);

const GENRE_KEYWORDS = Object.keys(GENRE_DJ_MAP);
const DECADE_KEYWORDS = Object.keys(DECADE_DJ_MAP);

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Longest keyword wins, so "post-rock" beats "rock" and "smooth jazz" beats "jazz".
 * Ties fall to the earlier entry, which is roster order.
 */
function bestMatch(haystack: string, keywords: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const keyword of keywords) {
    if (!haystack.includes(keyword)) continue;
    if (!best || keyword.length > best.length) best = keyword;
  }
  return best;
}

/**
 * Picks the host for a free-text search or custom prompt. Genre wins over decade —
 * "90s hip hop" is Devon Pulse's show, not Sloane's — and an unmatched query falls
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

/**
 * Host for a station record. An explicit assignment always wins; stations built at
 * runtime (curator, artist radio, saved mixes) fall through to text resolution.
 */
export function resolveDjForStation(station: {
  name?: string;
  description?: string;
  defaultPersonaId?: string;
}): DjPersona {
  if (station.defaultPersonaId) {
    return PERSONA_MAP[resolvePersonaId(station.defaultPersonaId)];
  }
  return resolveDjForQuery([station.name, station.description].filter(Boolean).join(" "));
}

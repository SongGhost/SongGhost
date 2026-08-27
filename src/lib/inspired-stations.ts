/**
 * AI-curated "Inspired" station blueprints.
 *
 * One cheap LLM call returns 5 station profiles (name / vibe / seeds / era /
 * energy / depth / accent). A cheap iTunes song search then picks one seed
 * track per blueprint for card artwork; YouTube is NOT resolved here. The
 * full playlist loads on click via `POST /api/station/generate` (seed first).
 * The set is session-ephemeral; saving one card persists that blueprint only.
 */

import { resolvePersonaId, type PersonaId } from "@/data/personas";
import type { Station } from "@/data/stations";
import { resolveDjIdForQuery } from "@/lib/dj-resolver";
import { normalizeSeedList } from "@/lib/station/blueprint";

export const INSPIRED_STATION_COUNT = 3;
export const INSPIRED_ID_PREFIX = "inspired-";
export const INSPIRED_CARD_STAGGER_MS = 120;

/** Tuner decades accepted by `POST /api/station/generate`. */
export const INSPIRED_TUNER_DECADES = [
  "60s",
  "70s",
  "80s",
  "90s",
  "2000s",
  "2010s",
  "Modern",
] as const;

export type InspiredTunerDecade = (typeof INSPIRED_TUNER_DECADES)[number];

export type InspiredSeed = {
  seedGenres?: string[];
  seedArtists?: string[];
  seedStationName?: string;
};

export type InspiredSeedTrack = {
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  previewUrl?: string;
  durationMs?: number;
  releaseYear?: number;
};

export type InspiredBlueprint = {
  name: string;
  description: string;
  seedGenres: string[];
  eras: string[];
  energyLevel: number;
  catalogDepth: number;
  accentColor: string;
  defaultPersonaId?: PersonaId;
  seedTrack?: InspiredSeedTrack;
};

const HEX_SHORT = /^#([0-9a-fA-F]{3})$/;
const HEX_LONG = /^#([0-9a-fA-F]{6})$/;

/** On-brand CA Dreamin' accents used when the model omits or botches a color. */
const FALLBACK_ACCENTS = [
  "#C4882A",
  "#2992cf",
  "#E07A3D",
  "#5B8FA8",
  "#D4A017",
] as const;

export function isInspiredStationId(stationId: string): boolean {
  return stationId.trim().startsWith(INSPIRED_ID_PREFIX);
}

export function shouldShowInspiredPill(
  inspiredStations: readonly unknown[],
  inspiredLoading: boolean,
): boolean {
  return inspiredLoading || inspiredStations.length > 0;
}

export function clampInspiredUnit(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function slugifyInspiredName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "mix";
}

export function inspiredStationId(name: string, index: number): string {
  return `${INSPIRED_ID_PREFIX}${slugifyInspiredName(name)}-${index}`;
}

export function normalizeInspiredHex(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  const long = HEX_LONG.exec(trimmed);
  if (long) return `#${long[1]!.toLowerCase()}`;
  const short = HEX_SHORT.exec(trimmed);
  if (short) {
    const [r, g, b] = short[1]!.split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}

function seedHaystack(seed: InspiredSeed): string {
  return [seed.seedStationName, ...(seed.seedGenres ?? []), ...(seed.seedArtists ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function seedLabel(seed: InspiredSeed): string {
  const genre = normalizeSeedList(seed.seedGenres)[0];
  if (genre) return genre;
  const artist = normalizeSeedList(seed.seedArtists)[0];
  if (artist) return artist;
  const name = seed.seedStationName?.trim();
  if (name) return name.replace(/^song radio:\s*/i, "").replace(/^artist radio:\s*/i, "");
  return "Groove";
}

function seedGenresFor(seed: InspiredSeed, extras: string[] = []): string[] {
  const fromSeed = normalizeSeedList(seed.seedGenres);
  const merged = normalizeSeedList([...fromSeed, ...extras], 3);
  if (merged.length >= 2) return merged.slice(0, 3);
  if (merged.length === 1) return normalizeSeedList([merged[0]!, extras[0] || "Hits"], 3);
  const label = seedLabel(seed);
  return normalizeSeedList([label, extras[0] || "Hits"], 3);
}

type FallbackDraft = {
  name: string;
  description: string;
  extraGenres: string[];
  eras: string[];
  energyLevel: number;
  catalogDepth: number;
};

function fallbackDrafts(seed: InspiredSeed): FallbackDraft[] {
  const hay = seedHaystack(seed);
  const label = seedLabel(seed);

  if (/\b(hip[- ]?hop|rap|boom bap|trap)\b/.test(hay)) {
    return [
      {
        name: "90s Boom Bap",
        description: "Dusty drums, crisp samples, and golden-era MCs.",
        extraGenres: ["Boom Bap", "East Coast Hip-Hop"],
        eras: ["90s"],
        energyLevel: 62,
        catalogDepth: 48,
      },
      {
        name: "Trap Heavy",
        description: "808s up front — modern trap with a late-night lean.",
        extraGenres: ["Trap", "Southern Hip-Hop"],
        eras: ["Modern"],
        energyLevel: 86,
        catalogDepth: 28,
      },
      {
        name: "Conscious Rhymes",
        description: "Lyrical hip-hop that talks back to the world.",
        extraGenres: ["Conscious Hip-Hop", "Alternative Hip-Hop"],
        eras: ["90s"],
        energyLevel: 54,
        catalogDepth: 62,
      },
      {
        name: "West Coast G-Funk",
        description: "Talkbox, slow-roll grooves, and California sun.",
        extraGenres: ["G-Funk", "West Coast Hip-Hop"],
        eras: ["90s"],
        energyLevel: 58,
        catalogDepth: 44,
      },
      {
        name: "Lo-Fi Hip-Hop",
        description: "Head-nod instrumentals for the long drive.",
        extraGenres: ["Lo-Fi Hip-Hop", "Chillhop"],
        eras: [],
        energyLevel: 28,
        catalogDepth: 70,
      },
    ];
  }

  return [
    {
      name: `${label} After Dark`,
      description: `Late-night ${label.toLowerCase()} with a slower pulse.`,
      extraGenres: [],
      eras: [],
      energyLevel: 32,
      catalogDepth: 58,
    },
    {
      name: `Deep ${label}`,
      description: `Catalog cuts and deep ${label.toLowerCase()} finds.`,
      extraGenres: [],
      eras: [],
      energyLevel: 48,
      catalogDepth: 82,
    },
    {
      name: `Golden ${label}`,
      description: `The era-defining ${label.toLowerCase()} records.`,
      extraGenres: [],
      eras: ["90s"],
      energyLevel: 60,
      catalogDepth: 35,
    },
    {
      name: `${label} Frequency`,
      description: `High-energy ${label.toLowerCase()} built for the commute.`,
      extraGenres: [],
      eras: ["Modern"],
      energyLevel: 84,
      catalogDepth: 22,
    },
    {
      name: `${label} Underground`,
      description: `Left-field ${label.toLowerCase()} just off the main path.`,
      extraGenres: [],
      eras: [],
      energyLevel: 55,
      catalogDepth: 74,
    },
  ];
}

function draftToBlueprint(draft: FallbackDraft, seed: InspiredSeed, index: number): InspiredBlueprint {
  return {
    name: draft.name,
    description: draft.description,
    seedGenres: seedGenresFor(seed, draft.extraGenres),
    eras: normalizeSeedList(draft.eras, 4),
    energyLevel: draft.energyLevel,
    catalogDepth: draft.catalogDepth,
    accentColor: FALLBACK_ACCENTS[index % FALLBACK_ACCENTS.length]!,
  };
}

/** Five blueprint fallbacks so the UI never blanks on LLM failure. */
export function fallbackInspiredBlueprints(seed: InspiredSeed = {}): InspiredBlueprint[] {
  return fallbackDrafts(seed).map((draft, index) => draftToBlueprint(draft, seed, index));
}

function uniqueName(candidate: string, used: Set<string>): string {
  const base = candidate.trim() || "Inspired Mix";
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; n < 12; n += 1) {
    const next = `${base} ${n}`;
    if (!used.has(next.toLowerCase())) return next;
  }
  return `${base} ${used.size + 1}`;
}

function parseBlueprintRow(
  raw: unknown,
  seed: InspiredSeed,
  index: number,
  usedNames: Set<string>,
): InspiredBlueprint {
  const fallback = fallbackInspiredBlueprints(seed)[index] ?? fallbackInspiredBlueprints(seed)[0]!;
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const name = uniqueName(
    typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, 48) : fallback.name,
    usedNames,
  );
  usedNames.add(name.toLowerCase());

  const description =
    typeof row.description === "string" && row.description.trim()
      ? row.description.trim().slice(0, 160)
      : fallback.description;

  const genres = normalizeSeedList(row.seedGenres, 3);
  const seedGenres = genres.length >= 2 ? genres : seedGenresFor(seed, fallback.seedGenres);

  const eras = normalizeSeedList(row.eras, 4).filter((era) => era.toLowerCase() !== "all");

  let defaultPersonaId: PersonaId | undefined;
  if (typeof row.defaultPersonaId === "string" && row.defaultPersonaId.trim()) {
    defaultPersonaId = resolvePersonaId(row.defaultPersonaId);
  }

  return {
    name,
    description,
    seedGenres,
    eras,
    energyLevel: clampInspiredUnit(row.energyLevel, fallback.energyLevel),
    catalogDepth: clampInspiredUnit(row.catalogDepth, fallback.catalogDepth),
    accentColor: normalizeInspiredHex(row.accentColor, FALLBACK_ACCENTS[index % FALLBACK_ACCENTS.length]!),
    ...(defaultPersonaId ? { defaultPersonaId } : {}),
  };
}

function extractRawRows(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.stations)) return record.stations;
    if (Array.isArray(record.blueprints)) return record.blueprints;
  }
  return [];
}

/**
 * Validate, clamp, dedupe names, and force exactly 5 blueprints.
 * Pads from seed-aware fallbacks when the model returns fewer.
 */
export function normalizeInspiredBlueprints(
  raw: unknown,
  seed: InspiredSeed = {},
): InspiredBlueprint[] {
  const rows = extractRawRows(raw);
  const usedNames = new Set<string>();
  const out: InspiredBlueprint[] = [];

  for (const row of rows) {
    if (out.length >= INSPIRED_STATION_COUNT) break;
    out.push(parseBlueprintRow(row, seed, out.length, usedNames));
  }

  const fallbacks = fallbackInspiredBlueprints(seed);
  let pad = 0;
  while (out.length < INSPIRED_STATION_COUNT) {
    const draft = fallbacks[pad % fallbacks.length]!;
    pad += 1;
    out.push(parseBlueprintRow(draft, seed, out.length, usedNames));
  }

  return out.slice(0, INSPIRED_STATION_COUNT);
}

export function blueprintToStation(blueprint: InspiredBlueprint, index: number): Station {
  const persona =
    blueprint.defaultPersonaId ??
    resolveDjIdForQuery(
      [blueprint.name, blueprint.description, ...(blueprint.seedGenres ?? [])].join(" "),
      blueprint.seedGenres,
    );

  const coverUrl = blueprint.seedTrack?.artworkUrl?.trim() || undefined;

  return {
    id: inspiredStationId(blueprint.name, index),
    name: blueprint.name,
    frequency: 0,
    category: "genres",
    defaultPersonaId: persona,
    accentColor: blueprint.accentColor,
    ...(coverUrl ? { coverUrl } : {}),
    ...(blueprint.seedTrack ? { seedTrack: blueprint.seedTrack } : {}),
    youtubeVideoId: "",
    tracks: [],
    description: blueprint.description,
    seedGenres: blueprint.seedGenres,
    eras: blueprint.eras,
    energyLevel: blueprint.energyLevel,
    catalogDepth: blueprint.catalogDepth,
    vibePrompt: blueprint.description,
  };
}

export function blueprintsToStations(blueprints: readonly InspiredBlueprint[]): Station[] {
  return blueprints.slice(0, INSPIRED_STATION_COUNT).map((blueprint, index) =>
    blueprintToStation(blueprint, index),
  );
}

export function fallbackInspiredStations(seed: InspiredSeed = {}): Station[] {
  return blueprintsToStations(fallbackInspiredBlueprints(seed));
}

export function seedFromLaunchedStation(
  station: Pick<Station, "name" | "seedGenres" | "seedArtists">,
  extras?: { seedArtists?: string[]; seedStationName?: string },
): InspiredSeed {
  const seedArtists = normalizeSeedList([
    ...(station.seedArtists ?? []),
    ...(extras?.seedArtists ?? []),
  ]);
  const seedGenres = normalizeSeedList(station.seedGenres);
  const seedStationName = (extras?.seedStationName ?? station.name)?.trim() || undefined;
  return {
    ...(seedGenres.length ? { seedGenres } : {}),
    ...(seedArtists.length ? { seedArtists } : {}),
    ...(seedStationName ? { seedStationName } : {}),
  };
}

export function erasToGenerateDecades(eras: readonly string[] | undefined): InspiredTunerDecade[] {
  const out: InspiredTunerDecade[] = [];
  const seen = new Set<string>();

  for (const raw of eras ?? []) {
    const era = raw.trim();
    if (!era) continue;
    let decade: InspiredTunerDecade | null = null;
    if (/^modern$/i.test(era) || era === "2020s") decade = "Modern";
    else if (era === "Y2K" || era === "y2k") decade = "2000s";
    else if ((INSPIRED_TUNER_DECADES as readonly string[]).includes(era)) {
      decade = era as InspiredTunerDecade;
    }
    if (!decade || seen.has(decade)) continue;
    seen.add(decade);
    out.push(decade);
  }

  return out;
}

export function generateBodyFromBlueprint(station: Station): {
  energy: number;
  catalogDepth: number;
  decades: InspiredTunerDecade[];
  genres: string[];
} {
  return {
    energy: clampInspiredUnit(station.energyLevel, 55),
    catalogDepth: clampInspiredUnit(station.catalogDepth, 35),
    decades: erasToGenerateDecades(station.eras),
    genres: normalizeSeedList(station.seedGenres, 3),
  };
}

type InspiredApiResponse = {
  stations?: unknown[];
  error?: string;
};

/** Read a seed song off a blueprint or Station-shaped API row. */
export function readInspiredSeedTrack(raw: unknown): InspiredSeedTrack | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  const source =
    row.seedTrack && typeof row.seedTrack === "object"
      ? (row.seedTrack as Record<string, unknown>)
      : null;
  if (!source) return undefined;

  const title = typeof source.title === "string" ? source.title.trim() : "";
  const artist = typeof source.artist === "string" ? source.artist.trim() : "";
  if (!title || !artist) return undefined;

  const album = typeof source.album === "string" ? source.album.trim() : "";
  const artworkUrl = typeof source.artworkUrl === "string" ? source.artworkUrl.trim() : "";
  const previewUrl = typeof source.previewUrl === "string" ? source.previewUrl.trim() : "";
  const durationMs =
    typeof source.durationMs === "number" && Number.isFinite(source.durationMs)
      ? source.durationMs
      : undefined;
  const releaseYear =
    typeof source.releaseYear === "number" && Number.isFinite(source.releaseYear)
      ? source.releaseYear
      : undefined;

  return {
    title,
    artist,
    ...(album ? { album } : {}),
    ...(artworkUrl ? { artworkUrl } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    ...(durationMs != null ? { durationMs } : {}),
    ...(releaseYear != null ? { releaseYear } : {}),
  };
}

/**
 * Client helper used by the search-launch path. A new call replaces the prior
 * set at the React layer; this function itself always returns a fresh 5.
 */
export async function fetchInspiredStations(
  seed: InspiredSeed,
  fetchImpl: typeof fetch = fetch,
): Promise<Station[]> {
  try {
    const res = await fetchImpl("/api/inspired-stations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(seed),
    });
    const data = (await res.json().catch(() => null)) as InspiredApiResponse | null;
    if (data?.stations?.length) {
      const rawRows = data.stations;
      const blueprints = normalizeInspiredBlueprints(data, seed).map((blueprint, index) => {
        const seedTrack = readInspiredSeedTrack(rawRows[index]);
        return seedTrack ? { ...blueprint, seedTrack } : blueprint;
      });
      return blueprintsToStations(blueprints);
    }
  } catch {
    // Fall through to local fallbacks so a search launch never blanks the pill.
  }
  return fallbackInspiredStations(seed);
}

export function buildInspiredSystemPrompt(): string {
  return `You are a radio programmer for SongHost, a statutory non-interactive broadcast radio app with a warm "CA Dreamin'" visual identity (ambers, dark slate, cool blues).

Given a seed (genres, artists, and/or a just-launched station name), return STRICT JSON:
{"stations":[<exactly 5 blueprint objects>]}

Each blueprint object:
- "name": a cool, contextual station name rooted in the seed. Distinct from the other 4. Feel like a real radio station, never generic ("Hip-Hop 2", "Mix 3").
- "description": one-line vibe / positioning.
- "seedGenres": 2–3 genres that station leans into (subset or close cousin of the seed; vary across the 5).
- "eras": an era lean such as ["90s"], ["Modern"], ["80s"] — or [] for all eras. Vary across the 5.
- "energyLevel": integer 0–100, varied across the 5 (mellow → high energy).
- "catalogDepth": integer 0–100, varied across the 5 (mainstream hits → deep cuts).
- "accentColor": hex color (#RRGGBB) that fits the vibe — warm ambers, cool blues, dusty golds, on-brand for CA Dreamin'.
- "defaultPersonaId": optional. Only if obvious, one of: standard-broadcast, warm-companion, sarcastic-critic, the-musicologist. Otherwise omit.

Do NOT invent track lists. Return ONLY valid JSON, no markdown.`;
}

export function buildInspiredUserPrompt(seed: InspiredSeed): string {
  const lines = [
    seed.seedStationName ? `Just-launched station: ${seed.seedStationName}` : null,
    seed.seedGenres?.length ? `Seed genres: ${seed.seedGenres.join(", ")}` : null,
    seed.seedArtists?.length ? `Seed artists: ${seed.seedArtists.join(", ")}` : null,
  ].filter(Boolean);
  return lines.join("\n") || "Seed: eclectic contemporary radio. Surprise the listener with five distinct stations.";
}

/**
 * Station Blueprint / Live Channel Dial profile helpers.
 *
 * Seed criteria generate a fresh statutory stream through `useStationQueue`.
 * These fields are the persisted Station Profile JSON — never a frozen,
 * listener-ordered playlist.
 */

import type { Station, StationSessionBreak } from "@/data/stations";
import { isSavedStationId } from "@/lib/saved-stations";

export type StationBlueprintSeeds = {
  seedArtists?: string[];
  seedGenres?: string[];
  eras?: string[];
  energyLevel?: number;
  catalogDepth?: number;
  vibePrompt?: string;
};

const MAX_SEED_LIST = 12;
const MAX_SEED_TOKEN = 80;

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeSeedList(value: unknown, limit = MAX_SEED_LIST): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    const token = asNonEmptyString(entry)?.slice(0, MAX_SEED_TOKEN);
    if (!token) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
    if (out.length >= limit) break;
  }
  return out;
}

export function normalizeEnergyLevel(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function normalizeCatalogDepth(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function readBlueprintSeeds(value: unknown): StationBlueprintSeeds {
  if (typeof value !== "object" || value === null) return {};
  const raw = value as Record<string, unknown>;
  const seeds: StationBlueprintSeeds = {};
  const seedArtists = normalizeSeedList(raw.seedArtists);
  const seedGenres = normalizeSeedList(raw.seedGenres);
  const eras = normalizeSeedList(raw.eras, 8);
  const energyLevel = normalizeEnergyLevel(raw.energyLevel);
  const catalogDepth = normalizeCatalogDepth(raw.catalogDepth);
  const vibePrompt = asNonEmptyString(raw.vibePrompt)?.slice(0, 240);

  if (seedArtists.length) seeds.seedArtists = seedArtists;
  if (seedGenres.length) seeds.seedGenres = seedGenres;
  if (eras.length) seeds.eras = eras;
  if (energyLevel != null) seeds.energyLevel = energyLevel;
  if (catalogDepth != null) seeds.catalogDepth = catalogDepth;
  if (vibePrompt) seeds.vibePrompt = vibePrompt;
  return seeds;
}

export function hasBlueprintSeeds(value: StationBlueprintSeeds | null | undefined): boolean {
  if (!value) return false;
  return Boolean(
    value.seedArtists?.length ||
      value.seedGenres?.length ||
      value.eras?.length ||
      value.vibePrompt?.trim() ||
      typeof value.energyLevel === "number" ||
      typeof value.catalogDepth === "number",
  );
}

/**
 * Artist radio / album deep dives still persist their generated running order.
 * Studio blueprints, tuner mixes, saved stations, and catalog parks do not —
 * recalling them must regenerate a statutory stream from the profile.
 */
export function shouldPersistLiveQueue(stationId: string): boolean {
  const id = stationId.trim();
  return (
    id.startsWith("artist-radio-") ||
    id.startsWith("song-radio-") ||
    id.startsWith("ai-curator-") ||
    id.startsWith("album-deep-dive-") ||
    id.startsWith("heavy-rotation-")
  );
}

export function isStatutoryProfileStation(stationId: string): boolean {
  const id = stationId.trim();
  return (
    id.startsWith("studio-") ||
    id.startsWith("tuner-") ||
    id.startsWith("inspired-") ||
    isSavedStationId(id)
  );
}

export function applyBlueprintSeeds<T extends object>(
  target: T,
  seeds: StationBlueprintSeeds,
): T & StationBlueprintSeeds {
  const next = { ...target } as T & StationBlueprintSeeds;
  if (seeds.seedArtists?.length) next.seedArtists = [...seeds.seedArtists];
  else delete next.seedArtists;
  if (seeds.seedGenres?.length) next.seedGenres = [...seeds.seedGenres];
  else delete next.seedGenres;
  if (seeds.eras?.length) next.eras = [...seeds.eras];
  else delete next.eras;
  if (typeof seeds.energyLevel === "number") next.energyLevel = seeds.energyLevel;
  else delete next.energyLevel;
  if (typeof seeds.catalogDepth === "number") next.catalogDepth = seeds.catalogDepth;
  else delete next.catalogDepth;
  if (seeds.vibePrompt?.trim()) next.vibePrompt = seeds.vibePrompt.trim();
  else delete next.vibePrompt;
  return next;
}

export function copyStationSeeds(station: Station): StationBlueprintSeeds {
  return readBlueprintSeeds(station);
}

export function mergeStationProfile(
  station: Station,
  seeds: StationBlueprintSeeds,
  breaks?: StationSessionBreak[],
): Station {
  const next = applyBlueprintSeeds({ ...station }, seeds);
  if (breaks?.length) next.studioBreaks = breaks;
  return next;
}

export function pickStationSessionBreak(
  cues: readonly StationSessionBreak[] | undefined,
  event: { isSessionOpening: boolean; tracksPlayed: number },
): StationSessionBreak | null {
  if (!cues?.length) return null;
  const opening = event.isSessionOpening;
  const played = Math.max(0, event.tracksPlayed);

  for (const cue of cues) {
    const trigger = cue.sessionTrigger ?? (opening ? "opener" : "between_tracks");
    if (opening && (trigger === "opener" || trigger === "station_launch")) {
      return cue;
    }
    if (opening) continue;
    if (trigger === "every_n_tracks") {
      const n =
        typeof cue.everyNTracks === "number" && cue.everyNTracks > 0
          ? Math.round(cue.everyNTracks)
          : 4;
      if (played > 0 && played % n === 0) return cue;
    }
  }
  return null;
}

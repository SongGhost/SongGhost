/**
 * Listener-saved stations — a queue the user named, gave a dial position, and
 * assigned a DJ to. Shares the `Station` contract with presets so every launch
 * path, queue branch, and DJ break treats it like any other station.
 */

import type { PersonaId } from "@/data/personas";
import type { Station, StationTrack } from "@/data/stations";

export const SAVED_STATION_ID_PREFIX = "saved-station-";

export const MIN_FM_FREQUENCY = 87.5;
export const MAX_FM_FREQUENCY = 108.0;
export const DEFAULT_SAVED_STATION_FREQUENCY = 101.5;

/** Dial accents offered in the save form — tuned to the warm vintage palette. */
export const SAVED_STATION_ACCENTS = [
  "#C4882A",
  "#FF8C00",
  "#E03131",
  "#FF00AA",
  "#7C5CFF",
  "#2F9E8F",
] as const;

export const DEFAULT_SAVED_STATION_ACCENT = SAVED_STATION_ACCENTS[0];

export function isSavedStationId(stationId: string): boolean {
  return stationId.startsWith(SAVED_STATION_ID_PREFIX);
}

export function slugifyStationName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "mix";
}

export function savedStationId(name: string): string {
  return `${SAVED_STATION_ID_PREFIX}${slugifyStationName(name)}`;
}

export function clampFmFrequency(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SAVED_STATION_FREQUENCY;
  const clamped = Math.min(MAX_FM_FREQUENCY, Math.max(MIN_FM_FREQUENCY, value));
  return Math.round(clamped * 10) / 10;
}

export type SavedStationDraft = {
  name: string;
  personaId: PersonaId;
  frequency: number;
  accentColor: string;
  tracks: StationTrack[];
};

function isPlayable(track: StationTrack): boolean {
  return Boolean(track.youtubeId?.trim() || track.previewUrl?.trim());
}

/**
 * Freeze the draft into a `Station`. The id is derived from the name, so saving
 * under an existing name updates that station rather than piling up duplicates.
 */
export function buildSavedStation(draft: SavedStationDraft): Station {
  const name = draft.name.trim() || "My Mix";
  const tracks = draft.tracks.filter(isPlayable);

  return {
    id: savedStationId(name),
    name,
    frequency: clampFmFrequency(draft.frequency),
    category: "genres",
    defaultPersonaId: draft.personaId,
    accentColor: draft.accentColor,
    youtubeVideoId: tracks[0]?.youtubeId ?? "",
    tracks,
    description: `Your saved mix — ${tracks.length} track${tracks.length === 1 ? "" : "s"}`,
  };
}

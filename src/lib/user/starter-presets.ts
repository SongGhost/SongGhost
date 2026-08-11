/**
 * Curated first-run memory dial slots (1–6) when the listener has none parked.
 */

import { getStationById } from "@/data/stations";
import {
  createEmptyMemoryPresets,
  MEMORY_PRESET_COUNT,
  type MemoryPreset,
  type MemoryPresetList,
} from "@/types/station";

/** Catalog station ids for the six starter genre presets. */
export const STARTER_MEMORY_STATION_IDS = [
  "80s-pop-synth", // 80s Pop
  "70s-classic-rock", // Classic Rock
  "country-gold", // 90s Country (closest catalog match)
  "lofi-chillhop", // Lofi Jazz
  "y2k-pop-rock", // Top 40
  "seattle-grunge", // 90s Grunge
] as const;

export type StarterMemoryStationId = (typeof STARTER_MEMORY_STATION_IDS)[number];

/**
 * Build a full 6-slot memory list from the starter catalog stations.
 * Missing catalog entries leave that slot empty.
 */
export function buildStarterMemoryPresets(
  savedAt: string = new Date().toISOString(),
): MemoryPresetList {
  const slots = createEmptyMemoryPresets();
  for (let i = 0; i < MEMORY_PRESET_COUNT; i++) {
    const stationId = STARTER_MEMORY_STATION_IDS[i];
    const station = getStationById(stationId);
    if (!station) continue;
    slots[i] = {
      slot: i + 1,
      stationId: station.id,
      stationName: station.name,
      frequency: station.frequency,
      accentColor: station.accentColor,
      personaId: station.defaultPersonaId,
      savedAt,
    } satisfies MemoryPreset;
  }
  return slots;
}

/** True when every assigned slot matches the starter catalog (order-sensitive). */
export function areStarterMemoryPresets(presets: MemoryPresetList | undefined): boolean {
  if (!presets || presets.length < MEMORY_PRESET_COUNT) return false;
  for (let i = 0; i < MEMORY_PRESET_COUNT; i++) {
    const preset = presets[i];
    if (!preset || preset.stationId !== STARTER_MEMORY_STATION_IDS[i]) return false;
  }
  return true;
}

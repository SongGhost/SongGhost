/**
 * Station configuration contracts — DJ chatter pacing, host overrides, era locking,
 * and the 1–6 dial memory presets.
 *
 * Deliberately dependency-light: `src/lib/dj/scheduler.ts` imports the pacing
 * profiles, so anything runtime-heavy here would drag station data and persona
 * tables into the DJ engine. The `Station` re-exports below are type-only and
 * erase at compile time.
 */

import type { PersonaId } from "@/data/personas";

export type { Station, StationCategory, StationTrack } from "@/data/stations";

/* ------------------------------------------------------------------ *
 * DJ chatter pacing
 * ------------------------------------------------------------------ */

/** Listener-facing DJ talk density. */
export type ChatterPacing = "talkative" | "standard" | "music_focused" | "music_only";

export const CHATTER_PACING_ORDER: readonly ChatterPacing[] = [
  "talkative",
  "standard",
  "music_focused",
  "music_only",
] as const;

export const DEFAULT_CHATTER_PACING: ChatterPacing = "standard";

export type ChatterPacingProfile = {
  id: ChatterPacing;
  label: string;
  /** Deck-sized label for the pacing pill */
  shortLabel: string;
  description: string;
  /** DJ voice is off entirely — no intro, no stinger, no sign-on */
  muted: boolean;
  /** Fewest tracks that must play before the next voiced break */
  minGap: number;
  /** Gap at which a break is forced rather than left to jitter */
  maxGap: number;
  /**
   * Fill the space between full breaks with short station-ID sweepers instead of
   * silence. Only the tightest pacing runs hot enough to want them.
   */
  alternateStinger: boolean;
};

export const CHATTER_PACING_PROFILES: Readonly<Record<ChatterPacing, ChatterPacingProfile>> = {
  talkative: {
    id: "talkative",
    label: "Talkative",
    shortLabel: "Talkative",
    description: "Host on every track — full breaks alternating with station sweepers.",
    muted: false,
    minGap: 1,
    maxGap: 2,
    alternateStinger: true,
  },
  standard: {
    id: "standard",
    label: "Standard",
    shortLabel: "Standard",
    description: "A voiced break every 2–4 tracks, the way commercial radio paces itself.",
    muted: false,
    minGap: 2,
    maxGap: 4,
    alternateStinger: false,
  },
  music_focused: {
    id: "music_focused",
    label: "Music Focused",
    shortLabel: "Music First",
    description: "Long music runs — the host only surfaces every 5 or more tracks.",
    muted: false,
    minGap: 5,
    maxGap: 7,
    alternateStinger: false,
  },
  music_only: {
    id: "music_only",
    label: "Music Only",
    shortLabel: "No DJ",
    description: "Host muted completely. Back-to-back music with no voice breaks at all.",
    muted: true,
    minGap: Number.POSITIVE_INFINITY,
    maxGap: Number.POSITIVE_INFINITY,
    alternateStinger: false,
  },
};

export const CHATTER_PACING_OPTIONS: readonly ChatterPacingProfile[] = CHATTER_PACING_ORDER.map(
  (id) => CHATTER_PACING_PROFILES[id],
);

export function isChatterPacing(value: unknown): value is ChatterPacing {
  return typeof value === "string" && value in CHATTER_PACING_PROFILES;
}

/** Anything persisted or hand-edited in, always a supported pacing out. */
export function resolveChatterPacing(value: unknown): ChatterPacing {
  return isChatterPacing(value) ? value : DEFAULT_CHATTER_PACING;
}

export function getChatterPacingProfile(value: unknown): ChatterPacingProfile {
  return CHATTER_PACING_PROFILES[resolveChatterPacing(value)];
}

/** Whether the host is muted outright at this pacing. */
export function isDjMuted(value: unknown): boolean {
  return getChatterPacingProfile(value).muted;
}

/* ------------------------------------------------------------------ *
 * Era locking
 * ------------------------------------------------------------------ */

/** Decade filter applied to every candidate track a station pulls. */
export type EraLock =
  | "all"
  | "50s"
  | "60s"
  | "70s"
  | "80s"
  | "90s"
  | "2000s"
  | "2010s"
  | "2020s";

export const DEFAULT_ERA_LOCK: EraLock = "all";

export type EraDefinition = {
  id: EraLock;
  label: string;
  /** Compact label for badges and pills */
  shortLabel: string;
  /** Inclusive first release year, or null when unbounded */
  startYear: number | null;
  /** Inclusive last release year, or null when unbounded */
  endYear: number | null;
};

export const ERA_DEFINITIONS: Readonly<Record<EraLock, EraDefinition>> = {
  all: { id: "all", label: "All Eras", shortLabel: "All Eras", startYear: null, endYear: null },
  "50s": { id: "50s", label: "50s Only", shortLabel: "50s", startYear: 1950, endYear: 1959 },
  "60s": { id: "60s", label: "60s Only", shortLabel: "60s", startYear: 1960, endYear: 1969 },
  "70s": { id: "70s", label: "70s Only", shortLabel: "70s", startYear: 1970, endYear: 1979 },
  "80s": { id: "80s", label: "80s Only", shortLabel: "80s", startYear: 1980, endYear: 1989 },
  "90s": { id: "90s", label: "90s Only", shortLabel: "90s", startYear: 1990, endYear: 1999 },
  "2000s": { id: "2000s", label: "2000s Only", shortLabel: "2000s", startYear: 2000, endYear: 2009 },
  "2010s": { id: "2010s", label: "2010s Only", shortLabel: "2010s", startYear: 2010, endYear: 2019 },
  "2020s": { id: "2020s", label: "2020s Only", shortLabel: "2020s", startYear: 2020, endYear: 2029 },
};

export const ERA_LOCK_ORDER: readonly EraLock[] = [
  "all",
  "50s",
  "60s",
  "70s",
  "80s",
  "90s",
  "2000s",
  "2010s",
  "2020s",
] as const;

export const ERA_LOCK_OPTIONS: readonly EraDefinition[] = ERA_LOCK_ORDER.map(
  (id) => ERA_DEFINITIONS[id],
);

export function isEraLock(value: unknown): value is EraLock {
  return typeof value === "string" && value in ERA_DEFINITIONS;
}

export function resolveEraLock(value: unknown): EraLock {
  return isEraLock(value) ? value : DEFAULT_ERA_LOCK;
}

export function getEraDefinition(value: unknown): EraDefinition {
  return ERA_DEFINITIONS[resolveEraLock(value)];
}

/** True when a lock is set to something narrower than the whole catalog. */
export function isEraLocked(value: unknown): boolean {
  return resolveEraLock(value) !== "all";
}

/** Inclusive release-year window, or null when the era imposes no bound. */
export function eraYearBounds(value: unknown): { startYear: number; endYear: number } | null {
  const era = getEraDefinition(value);
  if (era.startYear === null || era.endYear === null) return null;
  return { startYear: era.startYear, endYear: era.endYear };
}

/** On-air phrasing for the era, e.g. `the 80s (1980–1989)`. */
export function formatEraWindow(value: unknown): string | null {
  const era = getEraDefinition(value);
  const bounds = eraYearBounds(era.id);
  if (!bounds) return null;
  return `the ${era.shortLabel} (${bounds.startYear}–${bounds.endYear})`;
}

/* ------------------------------------------------------------------ *
 * Dial memory presets (buttons 1–6)
 * ------------------------------------------------------------------ */

export const MEMORY_PRESET_COUNT = 6;

export const MEMORY_PRESET_SLOTS: readonly number[] = Array.from(
  { length: MEMORY_PRESET_COUNT },
  (_, i) => i + 1,
);

/** A station parked on one of the six dial buttons. */
export type MemoryPreset = {
  /** 1-based button number as printed on the toolbar */
  slot: number;
  stationId: string;
  stationName: string;
  frequency: number;
  accentColor: string;
  /** Host that was on air when the slot was set, for the button subtitle */
  personaId?: PersonaId;
  savedAt: string;
};

export type MemoryPresetList = (MemoryPreset | null)[];

export function isMemoryPresetSlot(slot: unknown): boolean {
  return typeof slot === "number" && Number.isInteger(slot) && slot >= 1 && slot <= MEMORY_PRESET_COUNT;
}

export function createEmptyMemoryPresets(): MemoryPresetList {
  return Array.from({ length: MEMORY_PRESET_COUNT }, () => null);
}

function isUsablePreset(value: unknown): value is MemoryPreset {
  if (typeof value !== "object" || value === null) return false;
  const preset = value as Partial<MemoryPreset>;
  return typeof preset.stationId === "string" && preset.stationId.trim().length > 0;
}

/**
 * Force a persisted value back into a fixed six-slot array.
 *
 * The toolbar indexes straight into this list, so a short, long, or sparse array
 * from an older build would leave buttons rendering `undefined` rather than empty.
 * Each entry's `slot` is rewritten from its position, which is the only source of
 * truth once the list is length-locked.
 */
export function normalizeMemoryPresets(value: unknown): MemoryPresetList {
  const source = Array.isArray(value) ? value : [];
  return createEmptyMemoryPresets().map((_, index) => {
    const candidate = source[index];
    if (!isUsablePreset(candidate)) return null;
    return {
      ...candidate,
      slot: index + 1,
      stationName: candidate.stationName ?? "Saved Station",
      frequency: Number.isFinite(candidate.frequency) ? candidate.frequency : 0,
      accentColor: candidate.accentColor || "#C4882A",
      savedAt: candidate.savedAt ?? new Date(0).toISOString(),
    };
  });
}

export function assignMemoryPreset(
  presets: MemoryPresetList,
  slot: number,
  preset: Omit<MemoryPreset, "slot" | "savedAt"> & { savedAt?: string },
): MemoryPresetList {
  if (!isMemoryPresetSlot(slot)) return normalizeMemoryPresets(presets);
  const next = normalizeMemoryPresets(presets);
  next[slot - 1] = {
    ...preset,
    slot,
    savedAt: preset.savedAt ?? new Date().toISOString(),
  };
  return next;
}

export function clearMemoryPreset(presets: MemoryPresetList, slot: number): MemoryPresetList {
  const next = normalizeMemoryPresets(presets);
  if (isMemoryPresetSlot(slot)) next[slot - 1] = null;
  return next;
}

export function findMemoryPresetSlot(
  presets: MemoryPresetList,
  stationId: string,
): number | null {
  if (!stationId) return null;
  const index = normalizeMemoryPresets(presets).findIndex(
    (preset) => preset?.stationId === stationId,
  );
  return index >= 0 ? index + 1 : null;
}

/* ------------------------------------------------------------------ *
 * Per-station listener overrides
 * ------------------------------------------------------------------ */

/**
 * Listener edits layered over a station definition. Stored by station id rather
 * than folded into the station itself so a preset station keeps shipping its
 * authored defaults and the override can be cleared back to them.
 */
export type StationConfig = {
  stationId: string;
  /** Renamed dial label, blank when the station keeps its own name */
  name?: string;
  frequency?: number;
  /** Manually assigned host — null/absent means the station's default */
  hostPersonaId?: PersonaId | null;
  /** Station-level pacing override — absent means the listener's global setting */
  chatterPacing?: ChatterPacing | null;
  eraLock?: EraLock;
  /** Free-text direction the listener wants the host and catalog to lean into */
  vibePrompt?: string;
};

export type StationConfigMap = Record<string, StationConfig>;

/** Keeps a runaway paste out of the DJ prompt and out of localStorage. */
export const MAX_VIBE_PROMPT_LENGTH = 240;

export function sanitizeVibePrompt(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_VIBE_PROMPT_LENGTH);
}

export function normalizeStationConfig(
  stationId: string,
  value: Partial<StationConfig> | undefined,
): StationConfig {
  const config: StationConfig = { stationId };
  if (!value) return config;

  const name = typeof value.name === "string" ? value.name.trim().slice(0, 40) : "";
  if (name) config.name = name;

  if (typeof value.frequency === "number" && Number.isFinite(value.frequency)) {
    config.frequency = Math.round(value.frequency * 10) / 10;
  }

  if (typeof value.hostPersonaId === "string") config.hostPersonaId = value.hostPersonaId;
  if (isChatterPacing(value.chatterPacing)) config.chatterPacing = value.chatterPacing;
  if (isEraLock(value.eraLock)) config.eraLock = value.eraLock;

  const vibe = sanitizeVibePrompt(value.vibePrompt);
  if (vibe) config.vibePrompt = vibe;

  return config;
}

export function normalizeStationConfigs(value: unknown): StationConfigMap {
  if (typeof value !== "object" || value === null) return {};
  const out: StationConfigMap = {};
  for (const [stationId, config] of Object.entries(value as Record<string, unknown>)) {
    if (!stationId.trim()) continue;
    out[stationId] = normalizeStationConfig(stationId, config as Partial<StationConfig>);
  }
  return out;
}

/** Everything the player and DJ engine need once overrides are folded in. */
export type ResolvedStationSettings = {
  name: string;
  frequency: number;
  personaId: PersonaId;
  chatterPacing: ChatterPacing;
  eraLock: EraLock;
  vibePrompt: string;
  /** True when the host was hand-picked rather than inherited from the station */
  hostIsOverridden: boolean;
};

/**
 * Fold a station's authored defaults, the listener's per-station overrides, and
 * their global chatter setting into one answer. Station-level pacing wins over
 * the global preference; everything else falls back to the station definition.
 */
export function resolveStationSettings(
  station: { id: string; name: string; frequency: number; defaultPersonaId: PersonaId },
  config: StationConfig | undefined,
  globalChatterPacing: ChatterPacing = DEFAULT_CHATTER_PACING,
): ResolvedStationSettings {
  const hostOverride = config?.hostPersonaId ?? null;
  return {
    name: config?.name?.trim() || station.name,
    frequency:
      typeof config?.frequency === "number" && Number.isFinite(config.frequency)
        ? config.frequency
        : station.frequency,
    personaId: (hostOverride ?? station.defaultPersonaId) as PersonaId,
    chatterPacing: config?.chatterPacing
      ? resolveChatterPacing(config.chatterPacing)
      : resolveChatterPacing(globalChatterPacing),
    eraLock: resolveEraLock(config?.eraLock),
    vibePrompt: sanitizeVibePrompt(config?.vibePrompt),
    hostIsOverridden: Boolean(hostOverride),
  };
}

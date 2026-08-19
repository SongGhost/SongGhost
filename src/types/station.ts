/**
 * Station configuration contracts — DJ chatter pacing, host overrides, era locking,
 * the 1–6 dial memory presets, album deep dive sleeve metadata, and custom voice
 * personality overrides for shared station permalinks.
 *
 * Deliberately dependency-light: `src/lib/dj/scheduler.ts` imports the pacing
 * profiles, so anything runtime-heavy here would drag station data and persona
 * tables into the DJ engine. The `Station` re-exports below are type-only and
 * erase at compile time.
 */

import type { PersonaId } from "@/data/personas";

export type { Station, StationCategory, StationTrack } from "@/data/stations";
/** `StationTrack` also carries optional `isrc` and `streamUrl` for statutory DirectStream / ROU. */

/**
 * Optional visual identity on a saved / custom station (`Station.coverUrl`).
 * When unset, shelf cards compose a mosaic from seed-track thumbnails.
 */
export type StationCoverUrl = string;

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
 * Musicology trivia density (paced by chatter level)
 * ------------------------------------------------------------------ */

/**
 * How densely the host packs verified music lore into a voiced break.
 *
 * Derived from `ChatterPacing` (`talkLevel` in the prompt engine). Album deep
 * dive sessions always escalate to `high` — the host is on liner-notes duty.
 */
export type TriviaDensity = "high" | "balanced" | "minimal" | "none";

export type TriviaDensityProfile = {
  id: TriviaDensity;
  label: string;
  /** Distinct musicology nuggets the host should land per voiced segment */
  nuggetCount: number;
  /** Prompt instruction describing density for this level */
  instruction: string;
};

export const TRIVIA_DENSITY_PROFILES: Readonly<Record<TriviaDensity, TriviaDensityProfile>> = {
  high: {
    id: "high",
    label: "High",
    nuggetCount: 2,
    instruction:
      "HIGH TRIVIA DENSITY — deliver exactly 2 distinct musicology nuggets in this segment" +
      " (e.g. recording gear/studio trivia PLUS chart stats or personnel dynamics)." +
      " Both must be concrete and different pillars — never two takes on the same fact.",
  },
  balanced: {
    id: "balanced",
    label: "Balanced",
    nuggetCount: 1,
    instruction:
      "BALANCED TRIVIA DENSITY — include 1 focused, high-value musicology fact" +
      " (e.g. release-year context PLUS peak chart position, or the song's inspiration)." +
      " Keep it sharp; do not stack a second unrelated digression.",
  },
  minimal: {
    id: "minimal",
    label: "Minimal",
    nuggetCount: 1,
    instruction:
      "MINIMAL TRIVIA DENSITY — deliver a single 1-sentence punchy musicology nugget" +
      " (e.g. release year or studio location) before spinning the track. Nothing more.",
  },
  none: {
    id: "none",
    label: "None",
    nuggetCount: 0,
    instruction: "NO MUSIC TRIVIA — keep the break free of musicology facts.",
  },
};

/** Chatter pacing → default trivia density (deep dive overrides to high). */
export const TRIVIA_DENSITY_BY_PACING: Readonly<Record<ChatterPacing, TriviaDensity>> = {
  talkative: "high",
  standard: "balanced",
  music_focused: "minimal",
  music_only: "none",
};

/**
 * Resolve trivia density from the active talk level.
 *
 * `isDeepDive` forces high density regardless of pacing — album sessions are
 * liner-notes radio, not thin music-first breaks.
 */
export function resolveTriviaDensity(
  talkLevel: unknown,
  options?: { isDeepDive?: boolean },
): TriviaDensity {
  if (options?.isDeepDive) return "high";
  return TRIVIA_DENSITY_BY_PACING[resolveChatterPacing(talkLevel)];
}

export function getTriviaDensityProfile(
  talkLevel: unknown,
  options?: { isDeepDive?: boolean },
): TriviaDensityProfile {
  return TRIVIA_DENSITY_PROFILES[resolveTriviaDensity(talkLevel, options)];
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
 * Listening mode
 * ------------------------------------------------------------------ */

/**
 * What shape of listening session the station runs.
 *
 * `standard` is the rotating catalog every preset and saved station uses.
 * `album_deep_dive` plays one record end to end in its printed running order,
 * with the host working through it track by track.
 */
export type StationMode = "standard" | "album_deep_dive";

export const STATION_MODE_ORDER: readonly StationMode[] = ["standard", "album_deep_dive"] as const;

export const DEFAULT_STATION_MODE: StationMode = "standard";

export type StationModeProfile = {
  id: StationMode;
  label: string;
  shortLabel: string;
  description: string;
  /**
   * Queue order comes from the source material rather than the shuffle — no
   * weighted ordering, no artist-adjacency repair, no catalog replenish.
   */
  sequential: boolean;
};

export const STATION_MODE_PROFILES: Readonly<Record<StationMode, StationModeProfile>> = {
  standard: {
    id: "standard",
    label: "Standard Rotation",
    shortLabel: "Rotation",
    description: "A rotating catalog shuffled into a broadcast order.",
    sequential: false,
  },
  album_deep_dive: {
    id: "album_deep_dive",
    label: "Album Deep Dive",
    shortLabel: "Deep Dive",
    description: "One record start to finish, in order, with the host on liner-notes duty.",
    sequential: true,
  },
};

export const STATION_MODE_OPTIONS: readonly StationModeProfile[] = STATION_MODE_ORDER.map(
  (id) => STATION_MODE_PROFILES[id],
);

export function isStationMode(value: unknown): value is StationMode {
  return typeof value === "string" && value in STATION_MODE_PROFILES;
}

export function resolveStationMode(value: unknown): StationMode {
  return isStationMode(value) ? value : DEFAULT_STATION_MODE;
}

export function getStationModeProfile(value: unknown): StationModeProfile {
  return STATION_MODE_PROFILES[resolveStationMode(value)];
}

export function isAlbumDeepDive(value: unknown): boolean {
  return resolveStationMode(value) === "album_deep_dive";
}

/* ------------------------------------------------------------------ *
 * Album deep dive sleeve metadata
 * ------------------------------------------------------------------ */

/** One line off the back of the sleeve — who played, and on what. */
export type AlbumCredit = {
  name: string;
  /** Instruments or job as printed, e.g. `bass, backing vocals` */
  role: string;
};

/** One position in the record's running order. */
export type AlbumTrackEntry = {
  /** 1-based running order, rewritten from list position on normalize */
  position: number;
  title: string;
  /** Vinyl side or disc label, e.g. `A`, `B`, `Disc 2` */
  side?: string;
  durationSeconds?: number;
  /** A single line of lore the host may draw on when this track comes up */
  note?: string;
};

/**
 * Everything the deep dive needs about the record itself: what the queue plays
 * in what order, what the liner-notes panel prints, and what the host is
 * allowed to claim on air.
 */
export type AlbumContext = {
  albumTitle: string;
  artist: string;
  releaseYear?: number;
  recordingStudio?: string;
  producer?: string;
  label?: string;
  personnel: AlbumCredit[];
  /** The record's running order — also the deep dive's play order */
  trackList: AlbumTrackEntry[];
  /** High-res cover art for the liner-notes panel */
  coverArtUrl?: string;
};

/** Caps so a hand-edited or scraped sleeve can't flood localStorage or a prompt. */
export const MAX_ALBUM_TRACKS = 40;
export const MAX_ALBUM_PERSONNEL = 30;
const MAX_ALBUM_TEXT_LENGTH = 120;
const MAX_ALBUM_NOTE_LENGTH = 200;

function albumText(value: unknown, maxLength = MAX_ALBUM_TEXT_LENGTH): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

/**
 * The key a sleeve position and a catalog result are matched on.
 *
 * Store fronts decorate the same recording a dozen ways — `(Remastered 2011)`,
 * `[2009 Stereo Mix]`, `- Single Version` — so a literal title comparison would
 * leave holes in the running order. Everything after the first bracket or dash
 * suffix is dropped, then punctuation and case with it.
 */
export function albumTrackTitleKey(title: unknown): string {
  if (typeof title !== "string") return "";
  return title
    .toLowerCase()
    .replace(/[([{].*$/g, "")
    .replace(/\s+[-–—]\s+.*$/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export function normalizeAlbumPersonnel(value: unknown): AlbumCredit[] {
  if (!Array.isArray(value)) return [];

  const credits: AlbumCredit[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const candidate = entry as Partial<AlbumCredit>;
    const name = albumText(candidate.name);
    if (!name) continue;
    credits.push({ name, role: albumText(candidate.role) });
    if (credits.length >= MAX_ALBUM_PERSONNEL) break;
  }
  return credits;
}

/**
 * Force a stored running order into a dense, 1-based, position-ordered list.
 *
 * Positions are rewritten from array index for the same reason memory preset
 * slots are: the deep dive queue and the liner-notes panel both index straight
 * into this list, so a gap or a duplicate position from an older build would
 * put the host on a different track than the one playing.
 */
export function normalizeAlbumTrackList(value: unknown): AlbumTrackEntry[] {
  if (!Array.isArray(value)) return [];

  const entries: AlbumTrackEntry[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const candidate = entry as Partial<AlbumTrackEntry>;
    const title = albumText(candidate.title);
    if (!title) continue;

    const track: AlbumTrackEntry = { position: entries.length + 1, title };

    const side = albumText(candidate.side, 12);
    if (side) track.side = side;

    if (
      typeof candidate.durationSeconds === "number" &&
      Number.isFinite(candidate.durationSeconds) &&
      candidate.durationSeconds > 0
    ) {
      track.durationSeconds = Math.round(candidate.durationSeconds);
    }

    const note = albumText(candidate.note, MAX_ALBUM_NOTE_LENGTH);
    if (note) track.note = note;

    entries.push(track);
    if (entries.length >= MAX_ALBUM_TRACKS) break;
  }
  return entries;
}

/**
 * Sleeve metadata in, a usable album out — or null.
 *
 * Null is the important half of the contract: a deep dive with no title, no
 * artist, or no running order has nothing to sequence and nothing for the host
 * to talk through, so callers can treat null as "this is not a deep dive"
 * rather than carrying a half-built album into the queue.
 */
export function normalizeAlbumContext(value: unknown): AlbumContext | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<AlbumContext>;

  const albumTitle = albumText(candidate.albumTitle);
  const artist = albumText(candidate.artist);
  const trackList = normalizeAlbumTrackList(candidate.trackList);
  if (!albumTitle || !artist || trackList.length === 0) return null;

  const album: AlbumContext = {
    albumTitle,
    artist,
    personnel: normalizeAlbumPersonnel(candidate.personnel),
    trackList,
  };

  if (typeof candidate.releaseYear === "number" && Number.isInteger(candidate.releaseYear)) {
    album.releaseYear = candidate.releaseYear;
  }

  const studio = albumText(candidate.recordingStudio);
  if (studio) album.recordingStudio = studio;

  const producer = albumText(candidate.producer);
  if (producer) album.producer = producer;

  const label = albumText(candidate.label);
  if (label) album.label = label;

  const coverArtUrl = typeof candidate.coverArtUrl === "string" ? candidate.coverArtUrl.trim() : "";
  if (coverArtUrl) album.coverArtUrl = coverArtUrl;

  return album;
}

export function isPlayableAlbumContext(value: unknown): value is AlbumContext {
  return normalizeAlbumContext(value) !== null;
}

/** Where a recording sits in the running order, or -1 when it is not on the record. */
export function findAlbumTrackIndex(album: AlbumContext, title: unknown): number {
  const key = albumTrackTitleKey(title);
  if (!key) return -1;
  return album.trackList.findIndex((entry) => albumTrackTitleKey(entry.title) === key);
}

/** `"Rumours" by Fleetwood Mac (1977)` — the record as the host would name it. */
export function describeAlbumRelease(album: AlbumContext): string {
  const year = album.releaseYear ? ` (${album.releaseYear})` : "";
  return `"${album.albumTitle}" by ${album.artist}${year}`;
}

/** `Lindsey Buckingham (guitar, vocals)`, or just the name when the role is blank. */
export function formatAlbumCredit(credit: AlbumCredit): string {
  return credit.role ? `${credit.name} (${credit.role})` : credit.name;
}

/* ------------------------------------------------------------------ *
 * Dial memory presets (buttons 1–6)
 * ------------------------------------------------------------------ */

export const MEMORY_PRESET_COUNT = 6;

export const MEMORY_PRESET_SLOTS: readonly number[] = Array.from(
  { length: MEMORY_PRESET_COUNT },
  (_, i) => i + 1,
);

/** Blueprint seeds parked with a Live Channel Dial Preset. */
export type MemoryPresetProfile = {
  seedArtists?: string[];
  seedGenres?: string[];
  eras?: string[];
  energyLevel?: number;
  catalogDepth?: number;
  vibePrompt?: string;
};

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
  /** Station Profile seeds — recalling this slot regenerates a statutory stream. */
  profile?: MemoryPresetProfile;
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
      ...(candidate.profile ? { profile: candidate.profile } : {}),
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
 * Custom voice personality overrides (Phase 4C)
 * ------------------------------------------------------------------ */

/** Delivery heat — how hard the host pushes the break. */
export type VoiceEnergy = "low" | "medium" | "high";

/** Spoken colour layered on top of the host's base persona. */
export type VoiceAccent =
  | "neutral"
  | "american"
  | "british"
  | "southern"
  | "nyc"
  | "australian";

/** How much bite the host is allowed to put into asides. */
export type VoiceSnark = "none" | "light" | "medium" | "heavy";

/** Spoken cadence — distinct from station chatter density (`ChatterPacing`). */
export type VoiceDeliveryPacing = "measured" | "natural" | "rapid";

/**
 * Listener-tuned delivery knobs for a station's host.
 *
 * These never replace the persona — they colour energy, accent, snark, and
 * spoken pacing on top of whoever is already assigned. Absent fields keep the
 * host's authored character.
 */
export type VoiceProfileOverride = {
  energy?: VoiceEnergy;
  accent?: VoiceAccent;
  snark?: VoiceSnark;
  pacing?: VoiceDeliveryPacing;
};

export const VOICE_ENERGY_ORDER: readonly VoiceEnergy[] = ["low", "medium", "high"] as const;
export const VOICE_ACCENT_ORDER: readonly VoiceAccent[] = [
  "neutral",
  "american",
  "british",
  "southern",
  "nyc",
  "australian",
] as const;
export const VOICE_SNARK_ORDER: readonly VoiceSnark[] = [
  "none",
  "light",
  "medium",
  "heavy",
] as const;
export const VOICE_DELIVERY_PACING_ORDER: readonly VoiceDeliveryPacing[] = [
  "measured",
  "natural",
  "rapid",
] as const;

const VOICE_ENERGY_SET = new Set<string>(VOICE_ENERGY_ORDER);
const VOICE_ACCENT_SET = new Set<string>(VOICE_ACCENT_ORDER);
const VOICE_SNARK_SET = new Set<string>(VOICE_SNARK_ORDER);
const VOICE_DELIVERY_PACING_SET = new Set<string>(VOICE_DELIVERY_PACING_ORDER);

export function isVoiceEnergy(value: unknown): value is VoiceEnergy {
  return typeof value === "string" && VOICE_ENERGY_SET.has(value);
}

export function isVoiceAccent(value: unknown): value is VoiceAccent {
  return typeof value === "string" && VOICE_ACCENT_SET.has(value);
}

export function isVoiceSnark(value: unknown): value is VoiceSnark {
  return typeof value === "string" && VOICE_SNARK_SET.has(value);
}

export function isVoiceDeliveryPacing(value: unknown): value is VoiceDeliveryPacing {
  return typeof value === "string" && VOICE_DELIVERY_PACING_SET.has(value);
}

/**
 * Strip unknown knobs and drop an all-empty object to undefined so persistence
 * and share payloads stay sparse.
 */
export function normalizeVoiceProfileOverride(
  value: unknown,
): VoiceProfileOverride | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Partial<VoiceProfileOverride>;
  const profile: VoiceProfileOverride = {};

  if (isVoiceEnergy(candidate.energy)) profile.energy = candidate.energy;
  if (isVoiceAccent(candidate.accent)) profile.accent = candidate.accent;
  if (isVoiceSnark(candidate.snark)) profile.snark = candidate.snark;
  if (isVoiceDeliveryPacing(candidate.pacing)) profile.pacing = candidate.pacing;

  return Object.keys(profile).length > 0 ? profile : undefined;
}

/** True when at least one delivery knob is set. */
export function hasVoiceProfileOverride(value: unknown): boolean {
  return normalizeVoiceProfileOverride(value) !== undefined;
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
  /** Listening format — absent/unknown hydrates to the standard rotating catalog */
  mode?: StationMode;
  /** The record an `album_deep_dive` station works through — null when none */
  albumContext?: AlbumContext | null;
  /** Delivery colour layered on the assigned host — absent when the host runs as authored */
  voiceProfile?: VoiceProfileOverride;
  /**
   * Lore / commentary depth override. Inline union mirrors `CommentaryFormat` in
   * `dj.ts` so this module stays free of a dj↔station import cycle.
   * Absent → listener's global `UserPreferences.commentaryFormat`.
   */
  commentaryFormat?:
    | "standard"
    | "roots_branches"
    | "time_capsule"
    | "directors_cut"
    | null;
  /**
   * Host Studio vocal energy override. Inline union mirrors `DjMood` in `dj.ts`.
   * Absent → listener's global `UserPreferences.mood`.
   */
  mood?: "chill" | "even_keel" | "hyped" | null;
  /**
   * Host Studio personality colour override. Inline union mirrors `DjPersonality`
   * in `dj.ts`. Absent → listener's global `UserPreferences.personality`.
   */
  personality?: "kind" | "dry" | "sarcastic" | "funny" | "normal" | null;
};

export type StationConfigMap = Record<string, StationConfig>;

/** Keeps a runaway paste out of the DJ prompt and out of localStorage. */
export const MAX_VIBE_PROMPT_LENGTH = 240;

export function sanitizeVibePrompt(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_VIBE_PROMPT_LENGTH);
}

function isStationMood(value: unknown): value is NonNullable<StationConfig["mood"]> {
  return value === "chill" || value === "even_keel" || value === "hyped";
}

function isStationPersonality(
  value: unknown,
): value is NonNullable<StationConfig["personality"]> {
  return (
    value === "kind"
    || value === "dry"
    || value === "sarcastic"
    || value === "funny"
    || value === "normal"
  );
}

/**
 * Hydrate a persisted (or partial) station override into a safe StationConfig.
 *
 * Older builds may omit `mode`, `albumContext`, or `voiceProfile`. Missing or
 * unrecognized values fall back rather than invalidating the whole override, so
 * a pre-deep-dive / pre-voice-tuning saved playlist keeps tuning in.
 */
export function normalizeStationConfig(
  stationId: string,
  value: Partial<StationConfig> | undefined,
): StationConfig {
  // Explicit schema defaults for fields introduced after the first prefs blob.
  const config: StationConfig = {
    stationId,
    mode: DEFAULT_STATION_MODE,
    albumContext: null,
    // voiceProfile stays undefined until the listener tunes delivery knobs.
  };
  if (!value) return config;

  const name = typeof value.name === "string" ? value.name.trim().slice(0, 40) : "";
  if (name) config.name = name;

  if (typeof value.frequency === "number" && Number.isFinite(value.frequency)) {
    config.frequency = Math.round(value.frequency * 10) / 10;
  }

  if (typeof value.hostPersonaId === "string") config.hostPersonaId = value.hostPersonaId;
  if (isChatterPacing(value.chatterPacing)) config.chatterPacing = value.chatterPacing;
  if (isEraLock(value.eraLock)) config.eraLock = value.eraLock;

  // Unknown legacy mode strings fall back to standard instead of dropping the config.
  config.mode = resolveStationMode(value.mode);
  config.albumContext = normalizeAlbumContext(value.albumContext);

  const vibe = sanitizeVibePrompt(value.vibePrompt);
  if (vibe) config.vibePrompt = vibe;

  const voiceProfile = normalizeVoiceProfileOverride(value.voiceProfile);
  if (voiceProfile) config.voiceProfile = voiceProfile;

  if (
    value.commentaryFormat === "standard"
    || value.commentaryFormat === "roots_branches"
    || value.commentaryFormat === "time_capsule"
    || value.commentaryFormat === "directors_cut"
  ) {
    config.commentaryFormat = value.commentaryFormat;
  }

  if (isStationMood(value.mood)) config.mood = value.mood;
  if (isStationPersonality(value.personality)) config.personality = value.personality;

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
  mode: StationMode;
  /** The record backing a deep dive, null on a standard station */
  albumContext: AlbumContext | null;
  /** Listener-tuned delivery knobs, null when the host runs as authored */
  voiceProfile: VoiceProfileOverride | null;
  /**
   * Active lore depth after station override / global preference fold.
   * Mirrors `CommentaryFormat` in `dj.ts`.
   */
  commentaryFormat: "standard" | "roots_branches" | "time_capsule" | "directors_cut";
  /** Host Studio vocal energy after station override / global preference fold. */
  mood: "chill" | "even_keel" | "hyped";
  /** Host Studio personality colour after station override / global preference fold. */
  personality: "kind" | "dry" | "sarcastic" | "funny" | "normal";
};

type CommentaryFormatValue =
  | "standard"
  | "roots_branches"
  | "time_capsule"
  | "directors_cut";

const DEFAULT_COMMENTARY_FORMAT_VALUE: CommentaryFormatValue = "standard";

type StationMoodValue = NonNullable<StationConfig["mood"]>;
type StationPersonalityValue = NonNullable<StationConfig["personality"]>;

const DEFAULT_STATION_MOOD: StationMoodValue = "even_keel";
const DEFAULT_STATION_PERSONALITY: StationPersonalityValue = "normal";

function resolveCommentaryFormatValue(value: unknown): CommentaryFormatValue {
  if (
    value === "standard"
    || value === "roots_branches"
    || value === "time_capsule"
    || value === "directors_cut"
  ) {
    return value;
  }
  return DEFAULT_COMMENTARY_FORMAT_VALUE;
}

function resolveStationMood(value: unknown): StationMoodValue {
  if (value === "balanced") return "even_keel";
  return isStationMood(value) ? value : DEFAULT_STATION_MOOD;
}

function resolveStationPersonality(value: unknown): StationPersonalityValue {
  return isStationPersonality(value) ? value : DEFAULT_STATION_PERSONALITY;
}

/**
 * Fold a station's authored defaults, the listener's per-station overrides, and
 * their global chatter setting into one answer. Station-level pacing / commentary
 * wins over the global preference; everything else falls back to the station definition.
 */
export function resolveStationSettings(
  station: { id: string; name: string; frequency: number; defaultPersonaId: PersonaId },
  config: StationConfig | undefined,
  globalChatterPacing: ChatterPacing = DEFAULT_CHATTER_PACING,
  globalCommentaryFormat: CommentaryFormatValue = DEFAULT_COMMENTARY_FORMAT_VALUE,
  globalMood: StationMoodValue = DEFAULT_STATION_MOOD,
  globalPersonality: StationPersonalityValue = DEFAULT_STATION_PERSONALITY,
): ResolvedStationSettings {
  const hostOverride = config?.hostPersonaId ?? null;
  const albumContext = normalizeAlbumContext(config?.albumContext);
  // A deep dive with no usable sleeve has no running order to follow and no
  // liner notes to read. It degrades to a standard station rather than silently
  // shuffling a record the listener asked to hear in sequence.
  const mode: StationMode =
    resolveStationMode(config?.mode) === "album_deep_dive" && albumContext
      ? "album_deep_dive"
      : DEFAULT_STATION_MODE;

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
    mode,
    albumContext,
    voiceProfile: normalizeVoiceProfileOverride(config?.voiceProfile) ?? null,
    commentaryFormat: config?.commentaryFormat
      ? resolveCommentaryFormatValue(config.commentaryFormat)
      : resolveCommentaryFormatValue(globalCommentaryFormat),
    mood: config?.mood
      ? resolveStationMood(config.mood)
      : resolveStationMood(globalMood),
    personality: config?.personality
      ? resolveStationPersonality(config.personality)
      : resolveStationPersonality(globalPersonality),
  };
}

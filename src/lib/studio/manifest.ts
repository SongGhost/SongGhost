import { DEFAULT_PERSONA, isPersonaId, type PersonaId } from "@/data/personas";
import type { Station, StationTrack } from "@/data/stations";
import type { DjMood, DjPersonality } from "@/types/dj";

/** Matches MusicSourceContext DEFAULT_DJ_VOLUME. */
export const STUDIO_DEFAULT_DJ_VOLUME = 0.85;

/** When a studio break fires relative to surrounding tracks. */
export type BreakTimingTrigger =
  | "INTRO_RAMP"
  | "OUTRO_CROSSFADE"
  | "BETWEEN_TRACKS"
  | "CLOSING_STATEMENT";

export const BREAK_TIMING_OPTIONS: {
  id: BreakTimingTrigger;
  label: string;
  description: string;
}[] = [
  {
    id: "INTRO_RAMP",
    label: "Intro Ramp",
    description: "Talk over song intro (music ducked)",
  },
  {
    id: "OUTRO_CROSSFADE",
    label: "Outro Crossfade",
    description: "Crossfade talk-over from track end to next track start",
  },
  {
    id: "BETWEEN_TRACKS",
    label: "Between Tracks",
    description: "Full interstitial break between songs",
  },
  {
    id: "CLOSING_STATEMENT",
    label: "Closing Statement",
    description: "Post-final track sign-off",
  },
];

/** Host settings embedded in a published SongHost Studio station manifest. */
export type StudioDjConfig = {
  personaId: PersonaId;
  /** Vocal energy — maps from HostSettingsModal mood. */
  energy: DjMood;
  /** Personality colour — maps from HostSettingsModal personality. */
  sarcasm: DjPersonality;
  /** Preview / on-air DJ voice gain (0–1). */
  djVolume: number;
  /** Free-form host directives persisted with the mix. */
  customDirectives: string;
};

export function defaultStudioDjConfig(personaId: PersonaId): StudioDjConfig {
  return {
    personaId,
    energy: "even_keel",
    sarcasm: "normal",
    djVolume: STUDIO_DEFAULT_DJ_VOLUME,
    customDirectives: "",
  };
}

/** One track entry in a SongHost Studio station manifest. */
export type StudioManifestTrack = {
  title: string;
  artist: string;
  youtubeId?: string;
  previewUrl?: string;
  durationSec?: number;
};

/** Custom DJ / caller break cue placed on the station timeline. */
export type StudioDjBreakCue = {
  /** Absolute cue time in seconds from station start (or track-relative if trackIndex set). */
  cuePointSec: number;
  trackIndex?: number;
  kind?: "song_intro" | "stinger" | "full_break" | "call_in" | "custom";
  timing?: BreakTimingTrigger;
  audioUrl?: string;
  label?: string;
};

/** JSON station manifest persisted by Ghost Studio. */
export type StudioStationManifest = {
  id: string;
  name: string;
  description?: string;
  tracks: StudioManifestTrack[];
  djBreaks: StudioDjBreakCue[];
  callerAudioUrls: string[];
  djConfig?: StudioDjConfig;
  createdAt: string;
  updatedAt: string;
};

const DJ_MOODS: readonly DjMood[] = ["chill", "even_keel", "hyped"];
const DJ_PERSONALITIES: readonly DjPersonality[] = [
  "kind",
  "dry",
  "sarcastic",
  "funny",
  "normal",
];
const BREAK_TIMINGS: readonly BreakTimingTrigger[] = [
  "INTRO_RAMP",
  "OUTRO_CROSSFADE",
  "BETWEEN_TRACKS",
  "CLOSING_STATEMENT",
];

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeStudioDjConfig(
  value: unknown,
  fallbackPersonaId: PersonaId = DEFAULT_PERSONA.id,
): StudioDjConfig {
  const raw =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};

  const personaRaw = asNonEmptyString(raw.personaId);
  const personaId =
    personaRaw && isPersonaId(personaRaw) ? personaRaw : fallbackPersonaId;

  const energy =
    typeof raw.energy === "string" && DJ_MOODS.includes(raw.energy as DjMood)
      ? (raw.energy as DjMood)
      : "even_keel";

  const sarcasm =
    typeof raw.sarcasm === "string" &&
    DJ_PERSONALITIES.includes(raw.sarcasm as DjPersonality)
      ? (raw.sarcasm as DjPersonality)
      : "normal";

  const djVolume =
    typeof raw.djVolume === "number" && Number.isFinite(raw.djVolume)
      ? Math.min(1, Math.max(0, raw.djVolume))
      : STUDIO_DEFAULT_DJ_VOLUME;

  const customDirectives =
    typeof raw.customDirectives === "string" ? raw.customDirectives : "";

  return { personaId, energy, sarcasm, djVolume, customDirectives };
}

export function normalizeBreakTiming(value: unknown): BreakTimingTrigger | undefined {
  if (
    typeof value === "string" &&
    BREAK_TIMINGS.includes(value as BreakTimingTrigger)
  ) {
    return value as BreakTimingTrigger;
  }
  return undefined;
}

/** Convert a published studio manifest into a playable `Station`. */
export function studioManifestToStation(manifest: StudioStationManifest): Station {
  const tracks: StationTrack[] = manifest.tracks.map((track) => ({
    title: track.title,
    artist: track.artist,
    youtubeId: track.youtubeId ?? "",
    previewUrl: track.previewUrl,
  }));

  const personaId = manifest.djConfig?.personaId ?? DEFAULT_PERSONA.id;

  return {
    id: `studio-${manifest.id}`,
    name: manifest.name,
    frequency: 99.9,
    category: "genres",
    defaultPersonaId: personaId,
    accentColor: "#C4882A",
    youtubeVideoId: tracks[0]?.youtubeId ?? "",
    tracks,
    description:
      manifest.description?.trim() ||
      `SongHost Studio Mix — ${tracks.length} track${tracks.length === 1 ? "" : "s"}`,
  };
}

/** Lightweight shelf card stored in localStorage for My Studio Mixes. */
export type StudioMixShelfItem = {
  id: string;
  name: string;
  description?: string;
  trackCount: number;
  personaId: PersonaId;
  accentColor: string;
  updatedAt: string;
  /** Full manifest when available (local publish / GET hydrate). */
  manifest?: StudioStationManifest;
};

export function shelfItemFromManifest(
  manifest: StudioStationManifest,
): StudioMixShelfItem {
  const djConfig = normalizeStudioDjConfig(manifest.djConfig);
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    trackCount: manifest.tracks.length,
    personaId: djConfig.personaId,
    accentColor: "#C4882A",
    updatedAt: manifest.updatedAt,
    manifest: { ...manifest, djConfig },
  };
}

import { DEFAULT_PERSONA, resolvePersonaId, type PersonaId } from "@/data/personas";
import type { Station, StationSessionBreak, StationTrack } from "@/data/stations";
import {
  applyBlueprintSeeds,
  hasBlueprintSeeds,
  normalizeCatalogDepth,
  normalizeEnergyLevel,
  normalizeSeedList,
  readBlueprintSeeds,
} from "@/lib/station/blueprint";
import { sanitizeVibePrompt } from "@/types/station";

/** Legacy studio-manifest vocal energy — no longer a live Tuning Console knob. */
export type StudioDjEnergy = "chill" | "even_keel" | "hyped";
/** Legacy studio-manifest personality colour — personas carry tone now. */
export type StudioDjSarcasm = "kind" | "dry" | "sarcastic" | "funny" | "normal";

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
  /** Legacy vocal energy on older manifests — ignored by the live dial. */
  energy: StudioDjEnergy;
  /** Legacy personality colour on older manifests — ignored by the live dial. */
  sarcasm: StudioDjSarcasm;
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

/** When an authored liner / voicemail fires during a live statutory session. */
export type StudioBreakSessionTrigger =
  | "opener"
  | "station_launch"
  | "every_n_tracks"
  | "between_tracks";

export const SESSION_TRIGGER_OPTIONS: {
  id: StudioBreakSessionTrigger;
  label: string;
  description: string;
}[] = [
  {
    id: "opener",
    label: "Opener break",
    description: "First track of a session (song intro)",
  },
  {
    id: "station_launch",
    label: "Station launch",
    description: "Once when the listener tunes in",
  },
  {
    id: "every_n_tracks",
    label: "Every N tracks",
    description: "Repeat on a track cadence during the session",
  },
  {
    id: "between_tracks",
    label: "Between tracks",
    description: "Interstitial when the host scheduler voices a break",
  },
];

/** Custom DJ / caller break cue placed on the station timeline. */
export type StudioDjBreakCue = {
  /** Absolute cue time in seconds from station start (legacy; unused on statutory streams). */
  cuePointSec: number;
  /** @deprecated Prefer {@link sessionTrigger} — static playlist offsets are not statutory. */
  trackIndex?: number;
  /** Live-session event this liner / voicemail attaches to. */
  sessionTrigger?: StudioBreakSessionTrigger;
  /** Cadence when {@link sessionTrigger} is `every_n_tracks` (defaults to 4). */
  everyNTracks?: number;
  kind?: "song_intro" | "stinger" | "full_break" | "call_in" | "custom";
  timing?: BreakTimingTrigger;
  /** Pre-rendered break audio (e.g. Cloudflare R2 MP3) — play as-is, no TTS fetch. */
  audioUrl?: string;
  /**
   * Authored host copy. When set with {@link voiceId}, recipient playback TTS
   * uses this text directly (no persona LLM script generation).
   */
  customText?: string;
  /** Explicit ElevenLabs / TTS voice for {@link customText} — never a default host. */
  voiceId?: string;
  label?: string;
  /** When true, playback should apply telephone bandpass (≈300–3400 Hz). */
  isCallIn?: boolean;
};

/** JSON station manifest persisted by Ghost Studio. */
export type StudioStationManifest = {
  id: string;
  name: string;
  description?: string;
  /** Custom uploaded cover art (R2 `mix-covers/`); vinyl fallback when absent. */
  coverImageUrl?: string;
  /** Clerk account that authored / published this mix. */
  authorUserId?: string;
  /** Optional authored seed tracks — never treated as an on-demand playlist. */
  tracks?: StudioManifestTrack[];
  djBreaks: StudioDjBreakCue[];
  callerAudioUrls: string[];
  djConfig?: StudioDjConfig;
  seedArtists?: string[];
  seedGenres?: string[];
  eras?: string[];
  energyLevel?: number;
  catalogDepth?: number;
  vibePrompt?: string;
  createdAt: string;
  updatedAt: string;
};

const DJ_MOODS: readonly StudioDjEnergy[] = ["chill", "even_keel", "hyped"];
const DJ_PERSONALITIES: readonly StudioDjSarcasm[] = [
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
const SESSION_TRIGGERS: readonly StudioBreakSessionTrigger[] = [
  "opener",
  "station_launch",
  "every_n_tracks",
  "between_tracks",
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
  const personaId = personaRaw
    ? resolvePersonaId(personaRaw)
    : fallbackPersonaId;

  const energy =
    typeof raw.energy === "string" && DJ_MOODS.includes(raw.energy as StudioDjEnergy)
      ? (raw.energy as StudioDjEnergy)
      : "even_keel";

  const sarcasm =
    typeof raw.sarcasm === "string" &&
    DJ_PERSONALITIES.includes(raw.sarcasm as StudioDjSarcasm)
      ? (raw.sarcasm as StudioDjSarcasm)
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

export function normalizeSessionTrigger(
  value: unknown,
): StudioBreakSessionTrigger | undefined {
  if (
    typeof value === "string" &&
    SESSION_TRIGGERS.includes(value as StudioBreakSessionTrigger)
  ) {
    return value as StudioBreakSessionTrigger;
  }
  return undefined;
}

/**
 * Map a legacy `trackIndex` cue onto a live-session event so static playlist
 * offsets cannot reintroduce interactive sequencing.
 */
export function resolveStudioBreakSessionTrigger(
  cue: Pick<StudioDjBreakCue, "sessionTrigger" | "trackIndex" | "cuePointSec" | "kind">,
): StudioBreakSessionTrigger {
  const explicit = normalizeSessionTrigger(cue.sessionTrigger);
  if (explicit) return explicit;
  if (cue.kind === "song_intro" || cue.trackIndex === 0 || cue.cuePointSec === 0) {
    return "opener";
  }
  if (typeof cue.trackIndex === "number" && cue.trackIndex > 0) {
    return "every_n_tracks";
  }
  return "between_tracks";
}

export function pickStudioBreakForSessionEvent(
  cues: readonly StudioDjBreakCue[] | undefined,
  event: { isSessionOpening: boolean; tracksPlayed: number },
): StudioDjBreakCue | null {
  if (!cues?.length) return null;
  const opening = event.isSessionOpening;
  const played = Math.max(0, event.tracksPlayed);

  for (const cue of cues) {
    const trigger = resolveStudioBreakSessionTrigger(cue);
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

function cueToSessionBreak(cue: StudioDjBreakCue): StationSessionBreak {
  const breakCue: StationSessionBreak = {
    sessionTrigger: resolveStudioBreakSessionTrigger(cue),
  };
  if (cue.kind) breakCue.kind = cue.kind;
  if (typeof cue.everyNTracks === "number" && cue.everyNTracks > 0) {
    breakCue.everyNTracks = Math.round(cue.everyNTracks);
  }
  if (cue.audioUrl?.trim()) breakCue.audioUrl = cue.audioUrl.trim();
  if (cue.customText?.trim()) breakCue.customText = cue.customText.trim();
  if (cue.voiceId?.trim()) breakCue.voiceId = cue.voiceId.trim();
  if (cue.label?.trim()) breakCue.label = cue.label.trim();
  if (cue.isCallIn === true || cue.kind === "call_in") breakCue.isCallIn = true;
  return breakCue;
}

function blueprintDescription(manifest: StudioStationManifest, trackCount: number): string {
  const authored = manifest.description?.trim();
  if (authored) return authored;
  const seeds = [
    ...(manifest.seedGenres ?? []),
    ...(manifest.seedArtists ?? []).slice(0, 3),
  ];
  if (seeds.length) {
    return `SongHost Studio Blueprint — ${seeds.join(" · ")}`;
  }
  if (trackCount > 0) {
    return `SongHost Studio Mix — ${trackCount} track${trackCount === 1 ? "" : "s"}`;
  }
  return "SongHost Studio Blueprint";
}

/** Convert a published studio blueprint into a playable `Station` profile. */
export function studioManifestToStation(manifest: StudioStationManifest): Station {
  const tracks: StationTrack[] = (manifest.tracks ?? []).map((track) => ({
    title: track.title,
    artist: track.artist,
    youtubeId: track.youtubeId ?? "",
    previewUrl: track.previewUrl,
  }));

  const personaId = manifest.djConfig?.personaId ?? DEFAULT_PERSONA.id;
  const vibePrompt =
    sanitizeVibePrompt(manifest.vibePrompt) ||
    sanitizeVibePrompt(manifest.djConfig?.customDirectives);
  const seeds = applyBlueprintSeeds(
    {},
    {
      seedArtists: normalizeSeedList(manifest.seedArtists),
      seedGenres: normalizeSeedList(manifest.seedGenres),
      eras: normalizeSeedList(manifest.eras, 8),
      energyLevel: normalizeEnergyLevel(manifest.energyLevel),
      catalogDepth: normalizeCatalogDepth(manifest.catalogDepth),
      vibePrompt: vibePrompt || undefined,
    },
  );

  const studioBreaks = (manifest.djBreaks ?? []).map(cueToSessionBreak);
  const fromTracks = tracks
    .map((track) => track.artist.trim())
    .filter(Boolean);
  if (!seeds.seedArtists?.length && fromTracks.length) {
    seeds.seedArtists = normalizeSeedList(fromTracks);
  }

  const station: Station = {
    id: `studio-${manifest.id}`,
    name: manifest.name,
    frequency: 99.9,
    category: "genres",
    defaultPersonaId: personaId,
    accentColor: "#C4882A",
    youtubeVideoId: tracks[0]?.youtubeId ?? "",
    tracks,
    description: blueprintDescription(manifest, tracks.length),
    ...seeds,
  };

  if (manifest.coverImageUrl?.trim()) {
    station.coverUrl = manifest.coverImageUrl.trim();
  }
  if (studioBreaks.length) station.studioBreaks = studioBreaks;

  return station;
}

export function manifestHasPlayableBlueprint(manifest: StudioStationManifest): boolean {
  const tracks = manifest.tracks ?? [];
  return (
    tracks.length > 0 ||
    hasBlueprintSeeds(readBlueprintSeeds(manifest)) ||
    (manifest.callerAudioUrls?.length ?? 0) > 0 ||
    (manifest.djBreaks?.some((cue) => cue.kind === "call_in" || cue.audioUrl) ?? false)
  );
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
  /** Custom cover when uploaded; shelf falls back to vinyl graphic when absent. */
  coverImageUrl?: string;
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
    trackCount: manifest.tracks?.length ?? 0,
    personaId: djConfig.personaId,
    accentColor: "#C4882A",
    updatedAt: manifest.updatedAt,
    coverImageUrl: manifest.coverImageUrl,
    manifest: { ...manifest, djConfig },
  };
}

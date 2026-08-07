import type { PersonaId } from "@/data/personas";
import {
  BREAK_TIMING_OPTIONS,
  defaultStudioDjConfig,
  STUDIO_DEFAULT_DJ_VOLUME,
  type BreakTimingTrigger,
  type StudioDjConfig,
} from "@/lib/studio/manifest";

export type { SearchTrackResult } from "@/types/studio-search";
export {
  BREAK_TIMING_OPTIONS,
  defaultStudioDjConfig,
  STUDIO_DEFAULT_DJ_VOLUME,
  type BreakTimingTrigger,
  type StudioDjConfig,
};

/** Track row in the Studio timeline (search hit + sequence identity). */
export type StudioTimelineTrack = {
  clientId: string;
  title: string;
  artist: string;
  youtubeId?: string;
  previewUrl?: string;
  durationSec?: number;
  artworkUrl?: string;
  album?: string;
  spotifyId?: string;
};

export type BreakAuthorMode = "ai_host" | "mic" | "call_in";

export type CallInPersona =
  | "sarcastic_critic"
  | "hype_fan"
  | "obscure_music_snob";

export const CALL_IN_PERSONAS: {
  id: CallInPersona;
  label: string;
  description: string;
}[] = [
  {
    id: "sarcastic_critic",
    label: "Sarcastic Critic",
    description: "Dry, skeptical, never impressed",
  },
  {
    id: "hype_fan",
    label: "Hype Fan",
    description: "Over-the-top energy, pure excitement",
  },
  {
    id: "obscure_music_snob",
    label: "Obscure Music Snob",
    description: "Gatekeeping deep cuts and vinyl lore",
  },
];

export type StudioBreakKind =
  | "song_intro"
  | "stinger"
  | "full_break"
  | "call_in"
  | "custom";

/** @deprecated Prefer {@link defaultStudioDjConfig}. */
export const DEFAULT_STUDIO_DJ_CONFIG = defaultStudioDjConfig;

/** Saved break attached after a track index (−1 = before first track). */
export type StudioTimelineBreak = {
  clientId: string;
  /** Insert after this track index; use -1 for a cold open before track 0. */
  afterTrackIndex: number;
  mode: BreakAuthorMode;
  kind: StudioBreakKind;
  /** When this break should fire in the mix. */
  timing: BreakTimingTrigger;
  label?: string;
  scriptText?: string;
  callInPersona?: CallInPersona;
  audioUrl?: string;
  /** Local object URL for in-editor preview before publish upload. */
  localPreviewUrl?: string;
  applyTelephoneEq: boolean;
};

export type StudioEditorState = {
  title: string;
  personaId: PersonaId;
  djConfig: StudioDjConfig;
  tracks: StudioTimelineTrack[];
  breaks: StudioTimelineBreak[];
};

export function formatDuration(totalSeconds: number | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "—:—";
  }
  const clamped = Math.floor(totalSeconds);
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function newClientId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

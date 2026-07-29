/**
 * DJ script generation and persona context contracts.
 * Consumed by `/api/generate-script`, prompt engines, and future hyper-local
 * context injection (Phase 3).
 */

import type { PersonaId } from "@/data/personas";
import type { AudioTrack } from "@/types/audio";

/** Hook angles used by the prompt variety engine (Phase 1) */
export type DjHookAngle =
  | "station_banter"
  | "historical_context"
  | "weather_vibe"
  | "listener_shoutout"
  | "album_trivia"
  /** @deprecated Legacy alias — maps to historical_context in promptBuilder */
  | "storyteller"
  | "opinion_hype"
  | "production_musician"
  | "casual_tease";

/** Phase 3 hyper-local broadcast context — optional until that milestone */
export type HyperLocalContext = {
  timeOfDay?: "morning" | "afternoon" | "evening" | "late_night";
  weatherSummary?: string;
  newsHeadline?: string;
  timezone?: string;
  /** IANA or display label for on-air locality callouts */
  localeLabel?: string;
};

/** Track fields passed into LLM prompts */
export type DjTrackContext = Pick<AudioTrack, "title" | "artist" | "album">;

/**
 * Full input contract for DJ script generation.
 * Maps to current generate-script API fields and extends for roadmap features
 * without requiring Phase 2+ implementation today.
 */
export type DJPromptContext = {
  track: DjTrackContext;
  personaId?: PersonaId;
  /** Override persona system prompt (creator studio, Phase 4) */
  customPersonaPrompt?: string;
  hookAngle?: DjHookAngle;
  maxDurationSeconds: number;
  stationId?: string;
  stationName?: string;
  /** Prior on-air track for continuity banter */
  previousTrack?: DjTrackContext;
  /** Tropes to ban (e.g. "Fun fact:", "Did you know:") — Phase 1 variety engine */
  bannedOpeners?: readonly string[];
  /** Songs between DJ breaks; 1 = every track */
  djPacingFrequency?: number;
  /** Injected when Phase 3 local context is available */
  hyperLocal?: HyperLocalContext;
  /** Phoneme hints for band/album names (Phase 3 dictionary) */
  pronunciationHints?: Readonly<Record<string, string>>;
};

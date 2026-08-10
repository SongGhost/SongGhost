/**
 * DJ script generation and persona context contracts.
 * Consumed by `/api/generate-script`, prompt engines, and future hyper-local
 * context injection (Phase 3).
 */

import type { PersonaId } from "@/data/personas";
import type { AudioTrack } from "@/types/audio";
import type { AlbumContext, EraLock, VoiceProfileOverride } from "@/types/station";

/** Hook angles used by the prompt variety engine (Phase 1) */
export type DjHookAngle =
  | "station_banter"
  | "historical_context"
  | "weather_vibe"
  | "listener_shoutout"
  | "album_trivia"
  | "artist_trivia"
  | "local_events"
  | "recap"
  | "up_next"
  /** @deprecated Legacy alias — maps to historical_context in promptBuilder */
  | "storyteller"
  | "opinion_hype"
  | "production_musician"
  | "casual_tease";

/** Broadcast segue between tracks */
export type DjTransitionType = "full_break" | "stinger" | "silent";

/**
 * Companion DJ content / pacing mode (UI selector + generate-script).
 * - `no_dj`: music only
 * - `active`: quick liners & teases
 * - `balanced`: standard radio DJ (default)
 * - `in_depth`: deep lore & stories
 */
export type DjMode = "no_dj" | "active" | "balanced" | "in_depth";

/**
 * Tuning Console pace — UI-facing labels that map onto {@link DjMode}:
 * silent→no_dj, every_song→active, short_breaks→balanced, long_breaks→in_depth.
 */
export type DjPace =
  | "silent"
  | "every_song"
  | "short_breaks"
  | "long_breaks";

/** Vocal energy for ElevenLabs voice_settings (Tuning Console). */
export type DjMood = "chill" | "even_keel" | "hyped";

/** Narrative persona colour layered on the host (Tuning Console). */
export type DjPersonality =
  | "kind"
  | "dry"
  | "sarcastic"
  | "funny"
  | "normal";

/** Trivia depth guardrail for generate-script (Tuning Console). */
export type DjKnowledge = "basic_facts" | "smart" | "genius";

/**
 * Extended commentary / lore depth (Host Settings + generate-script).
 * - `standard`: quick broadcast breaks and track intros (default)
 * - `roots_branches`: sample origins, production lineages, drum breaks (Pro)
 * - `time_capsule`: vivid ~15s historical worldbuilding (Pro)
 * - `directors_cut`: liner notes, chords, studio session lore (Pro)
 */
export type CommentaryFormat =
  | "standard"
  | "roots_branches"
  | "time_capsule"
  | "directors_cut";

export const DEFAULT_COMMENTARY_FORMAT: CommentaryFormat = "standard";

export const COMMENTARY_FORMAT_OPTIONS: readonly CommentaryFormat[] = [
  "standard",
  "roots_branches",
  "time_capsule",
  "directors_cut",
] as const;

/** Extended formats gated behind Pro in Host Settings. */
export const PRO_COMMENTARY_FORMATS: ReadonlySet<CommentaryFormat> = new Set([
  "roots_branches",
  "time_capsule",
  "directors_cut",
]);

export const COMMENTARY_FORMAT_LABELS: Record<CommentaryFormat, string> = {
  standard: "Standard",
  roots_branches: "Roots & Branches",
  time_capsule: "Sonic Time Capsule",
  directors_cut: "Director's Cut",
};

export const COMMENTARY_FORMAT_DESCRIPTIONS: Record<CommentaryFormat, string> = {
  standard: "Quick broadcast breaks and track introductions.",
  roots_branches: "Focus on sample origins, production lineages, and drum breaks.",
  time_capsule:
    "Vivid 15-second historical worldbuilding (city, scene, cultural context).",
  directors_cut:
    "Full album/track liner notes, chord structures, and studio session lore.",
};

export function isCommentaryFormat(value: unknown): value is CommentaryFormat {
  return (
    value === "standard"
    || value === "roots_branches"
    || value === "time_capsule"
    || value === "directors_cut"
  );
}

export function resolveCommentaryFormat(value: unknown): CommentaryFormat {
  return isCommentaryFormat(value) ? value : DEFAULT_COMMENTARY_FORMAT;
}

/** Full DJ Tuning Console snapshot held in session station state. */
export type DjTuningSettings = {
  pace: DjPace;
  mood: DjMood;
  personality: DjPersonality;
  knowledge: DjKnowledge;
};

export const DEFAULT_DJ_TUNING: DjTuningSettings = {
  pace: "short_breaks",
  mood: "even_keel",
  personality: "normal",
  knowledge: "smart",
};

export const DJ_PACE_OPTIONS: readonly DjPace[] = [
  "silent",
  "every_song",
  "short_breaks",
  "long_breaks",
] as const;

/** Free-tier default / enforced pace (SHORT BREAKS). */
export const FREE_TIER_DJ_PACE: DjPace = "short_breaks";

/** Pace options gated behind Pro in Host Settings. */
export const PRO_DJ_PACES: ReadonlySet<DjPace> = new Set([
  "silent",
  "every_song",
  "long_breaks",
]);

export const DJ_MOOD_OPTIONS: readonly DjMood[] = [
  "chill",
  "even_keel",
  "hyped",
] as const;

export const DJ_PERSONALITY_OPTIONS: readonly DjPersonality[] = [
  "kind",
  "dry",
  "sarcastic",
  "funny",
  "normal",
] as const;

export const DJ_KNOWLEDGE_OPTIONS: readonly DjKnowledge[] = [
  "basic_facts",
  "smart",
  "genius",
] as const;

/** On-air / Tuning Console display labels (exact casing for badges). */
export const DJ_PACE_LABELS: Record<DjPace, string> = {
  silent: "SILENT",
  every_song: "EVERY SONG",
  short_breaks: "SHORT BREAKS",
  long_breaks: "LONG BREAKS",
};

export const DJ_MOOD_LABELS: Record<DjMood, string> = {
  chill: "CHILL",
  even_keel: "EVEN KEEL",
  hyped: "HYPED",
};

export const DJ_PERSONALITY_LABELS: Record<DjPersonality, string> = {
  kind: "KIND",
  dry: "DRY",
  sarcastic: "SARCASTIC",
  funny: "FUNNY",
  normal: "NORMAL",
};

export const DJ_KNOWLEDGE_LABELS: Record<DjKnowledge, string> = {
  basic_facts: "BASIC FACTS",
  smart: "SMART",
  genius: "GENIUS",
};

/** Map Tuning Console pace → companion {@link DjMode}. */
export function djPaceToMode(pace: DjPace): DjMode {
  switch (pace) {
    case "silent":
      return "no_dj";
    case "every_song":
      return "active";
    case "long_breaks":
      return "in_depth";
    default:
      return "balanced";
  }
}

/** Map companion {@link DjMode} → Tuning Console pace. */
export function djModeToPace(mode: DjMode): DjPace {
  switch (mode) {
    case "no_dj":
      return "silent";
    case "active":
      return "every_song";
    case "in_depth":
      return "long_breaks";
    default:
      return "short_breaks";
  }
}

/** Free tier may only run SHORT BREAKS (`balanced` / `standard` chatter). */
export function resolveDjPaceForTier(
  pace: unknown,
  tier: "free" | "pro",
): DjPace {
  if (tier === "free") return FREE_TIER_DJ_PACE;
  return pace === "silent"
    || pace === "every_song"
    || pace === "short_breaks"
    || pace === "long_breaks"
    ? pace
    : FREE_TIER_DJ_PACE;
}

/** Planned DJ break format — rotates like real radio pacing */
export type DjSegmentKind =
  | "song_intro"
  | "recap"
  | "up_next"
  | "artist_trivia"
  | "local_events"
  | "stinger";

export type LocalConcertEvent = {
  artist: string;
  venue: string;
  city: string;
  /** Human-readable date for on-air mention, e.g. "Friday, March 15" */
  dateLabel: string;
};

export type DjSegmentPlan = {
  kind: DjSegmentKind;
  /** How the audio engine should treat this segment */
  transition: DjTransitionType;
  /** Tracks the DJ must name in this break */
  announceTracks: DjTrackContext[];
  /** Tracks to reference as recently heard (recap segments) */
  recapTracks?: DjTrackContext[];
  /** Upcoming queue preview tracks */
  upNextTracks?: DjTrackContext[];
  maxDurationSeconds: number;
  /**
   * Session-scoped counter used to rotate commentary styles. Travels with the plan so
   * rotation is per-listener rather than shared server module state.
   */
  styleRotationIndex?: number;
  localEvent?: LocalConcertEvent;
  listenerCity?: string;
  /** First break of a session — the DJ is signing on, not mid-set */
  isSessionOpening?: boolean;
};

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
  /** Dial position the DJ is allowed to announce, e.g. 107.7 */
  stationFrequency?: number;
  /** Station the listener saved and named themselves, not a house channel */
  isUserSavedStation?: boolean;
  /** Prior on-air track for continuity banter */
  previousTrack?: DjTrackContext;
  /** Last 1–2 played tracks for multi-song recap banter */
  recentHistory?: DjTrackContext[];
  /** Next 1–2 queued tracks for upcoming teasers */
  upcomingQueue?: DjTrackContext[];
  /** Tropes to ban (e.g. "Fun fact:", "Did you know:") — Phase 1 variety engine */
  bannedOpeners?: readonly string[];
  /** Songs between DJ breaks; 1 = every track */
  djPacingFrequency?: number;
  /**
   * Companion-stream DJ mode.
   * - `no_dj`: music only — no prefetch / ducking
   * - `active`: quick liners when songsSinceLastBreak >= 1
   * - `balanced`: standard radio when songsSinceLastBreak >= 2
   * - `in_depth`: deep lore when songsSinceLastBreak >= 4
   */
  djMode?: DjMode;
  /** Injected when Phase 3 local context is available */
  hyperLocal?: HyperLocalContext;
  /** Full segment plan from the DJ scheduler (preferred over bare track fields) */
  segmentPlan?: DjSegmentPlan;
  /** Listener city label for local concert callouts */
  listenerCity?: string;
  /** Nearby show to mention when available */
  localEvent?: LocalConcertEvent;
  /**
   * Decade the station is locked to. Constrains what the host may treat as
   * current — chart talk, scene references, and "coming up" asides all have to
   * sit inside the window.
   */
  eraLock?: EraLock;
  /** Listener-authored direction for this station's tone and references */
  vibePrompt?: string;
  /**
   * The record being worked through, supplied only when the station is running
   * an `album_deep_dive`. Its presence is what puts the host in lore mode.
   */
  albumContext?: AlbumContext;
  /**
   * Listener-tuned delivery knobs (energy, accent, snark, spoken pacing) layered
   * on the assigned host without replacing the persona itself.
   */
  voiceProfile?: VoiceProfileOverride;
  /**
   * Clean Mode gate. When `false`, system prompts enforce FCC-safe commentary.
   * When `true`, late-night radio language is allowed. Omitted → treat as clean.
   */
  allowExplicit?: boolean;
  /**
   * Lore / commentary depth. Extended formats (`roots_branches`, `time_capsule`,
   * `directors_cut`) append SSML pacing directives in the prompt builder.
   * Omitted → `standard`.
   */
  commentaryFormat?: CommentaryFormat;
  /** Phoneme hints for band/album names (Phase 3 dictionary) */
  pronunciationHints?: Readonly<Record<string, string>>;
};

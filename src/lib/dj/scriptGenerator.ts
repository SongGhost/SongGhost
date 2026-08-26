/**
 * Fast, non-LLM station-launch liners + host-tuning clamp / prompt guidance.
 *
 * Track #0 openings skip the slow generate-script LLM path and feed one
 * rotated opener template straight to TTS (`/api/generate-voice`) in the
 * active persona voice. Mid-session `song_intro` uses a plain announcement
 * line. Rotation advances once per station launch, not per track.
 *
 * Tuning Console pace / lore / knowledge / explicit /
 * custom directives are clamped for Free tier before system-prompt assembly.
 */

import type {
  CommentaryFormat,
  DjKnowledge,
  DjPace,
} from "@/types/dj";
import { FREE_TIER_DJ_PACE } from "@/types/dj";

/** Swell music from the launch duck floor back to full after the liner ends. */
export const STATION_LAUNCH_RESTORE_MS = 600;

type OpenerTemplate = {
  /** Short station-ID for a cold-vocal hard_pause opener (no song/artist). */
  stationId: (stationName: string) => string;
  /** Single-clip intro_ramp opener: station-ID prefix + track announce. */
  opener: (stationName: string, artist: string, title: string) => string;
};

const STATION_OPENER_TEMPLATES: readonly OpenerTemplate[] = [
  {
    stationId: (s) => `${s} is live.`,
    opener: (s, artist, title) => `${s} is live, up now is ${title} by ${artist}.`,
  },
  {
    stationId: (s) => `You're locked into ${s}.`,
    opener: (s, artist, title) =>
      `You're locked into ${s} — up now is ${title} by ${artist}.`,
  },
  {
    stationId: (s) => `${s} is on the air.`,
    opener: (s, artist, title) => `${s} is on the air. Up now is ${title} by ${artist}.`,
  },
  {
    stationId: (s) => `Thanks for tuning in to ${s}.`,
    opener: (s, artist, title) =>
      `Thanks for tuning in to ${s}. Up now is ${title} by ${artist}.`,
  },
  {
    stationId: (s) => `This is ${s}.`,
    opener: (s, artist, title) => `This is ${s}. Up now is ${title} by ${artist}.`,
  },
  {
    stationId: (s) => `Welcome to ${s}.`,
    opener: (s, artist, title) => `Welcome to ${s}. Up now is ${title} by ${artist}.`,
  },
  {
    stationId: (s) => `${s} coming in live.`,
    opener: (s, artist, title) =>
      `${s} coming in live — up now is ${title} by ${artist}.`,
  },
  {
    stationId: (s) => `${s} is rolling.`,
    opener: (s, artist, title) => `${s} is rolling. Up now is ${title} by ${artist}.`,
  },
  {
    stationId: (s) => `You found ${s}.`,
    opener: (s, artist, title) => `You found ${s}. Up now is ${title} by ${artist}.`,
  },
  {
    stationId: (s) => `${s} is live.`,
    opener: (s, artist, title) => `${s} is live. Here's ${title} by ${artist}.`,
  },
  {
    stationId: (s) => `${s} is live.`,
    opener: (s, artist, title) => `${s} is live. Starting with ${title} by ${artist}.`,
  },
  {
    stationId: (s) => `This is ${s}.`,
    opener: (s, artist, title) => `On ${s} now: ${title} by ${artist}.`,
  },
  {
    stationId: (s) => `${s} is on.`,
    opener: (s, artist, title) => `${s} is on. Up now is ${title} by ${artist}.`,
  },
];

/** Advances once per {@link getStationLaunchClips} call (one step per station launch). */
let stationOpenerRotation = 0;

const SONG_RADIO_SPOKEN_LABEL = /^song radio\s*:/i;

/**
 * Spoken on-air brand. Dynamic Song Radio labels ("Song Radio: [Track Title]")
 * must never be read as the station name — those stay "SongHost".
 */
export function resolveSpokenStationBrand(stationName: string): string {
  const trimmed = stationName.trim();
  if (!trimmed || SONG_RADIO_SPOKEN_LABEL.test(trimmed)) return "SongHost";
  return trimmed;
}

/**
 * Mid-session `song_intro` announcement — single ducked clip, no station-ID,
 * no earcon, no lore.
 */
export function getSongIntroLine(artist: string, title: string): string {
  const trackArtist = artist.trim() || "the artist";
  const trackTitle = title.trim() || "this one";
  return `Up now is ${trackTitle} by ${trackArtist}.`;
}

/**
 * Pick the next rotated station-launch opener. Advances the pool index once
 * per call so reopenings cycle the templates instead of repeating at random.
 */
export function getStationLaunchLiner(
  stationName: string,
  artist: string,
  title: string,
): string {
  return getStationLaunchClips(stationName, artist, title).line;
}

export type StationLaunchClips = {
  /** Combined intro_ramp opener (station-ID + track announce). */
  line: string;
  /** Short station-ID for a hard_pause opener (no song/artist). */
  stationId: string;
  /**
   * Quarantined companion still reads a lore/announcement pair.
   * `lore` is the short station-ID; `announcement` is the mid-session line.
   */
  lore: string;
  announcement: string;
};

/**
 * Session-opening single-clip liner. Rotation advances per station launch.
 * `line` is the intro_ramp clip; `stationId` is the hard_pause clip.
 */
export function getStationLaunchClips(
  stationName: string,
  artist: string,
  title: string,
): StationLaunchClips {
  const name = resolveSpokenStationBrand(stationName);
  const trackArtist = artist.trim() || "the artist";
  const trackTitle = title.trim() || "this one";
  const templates = STATION_OPENER_TEMPLATES;
  const index = stationOpenerRotation % templates.length;
  stationOpenerRotation += 1;
  const template = templates[index] ?? templates[0];
  const stationId = template.stationId(name);
  const line = template.opener(name, trackArtist, trackTitle);
  return {
    line,
    stationId,
    lore: stationId,
    announcement: getSongIntroLine(trackArtist, trackTitle),
  };
}

/**
 * Vocal-protection gate for Track #0 launch breaks.
 *
 * - Playhead still at 0:00 → assume lead vocals may start immediately; pause.
 * - Playhead already into the bed → treat as an instrumental intro and duck.
 *
 * When `launchHoldActive` is set, the playhead is treated as a true 0:00 even
 * if autoplay leaked a few hundred milliseconds — a moved needle must not
 * flip a confirmed cold start from `hard_pause` into `intro_ramp`.
 *
 * Prefer {@link resolveStationLaunchHoldMode} at arm time. Unprobed intros
 * default to `intro_ramp` (pre-duck at 18% from 0:00); `hard_pause` is only
 * for confirmed cold vocal intros (`introDurationSec < 3`).
 */
export function shouldPauseForStationLaunchVocals(
  positionMs: number,
  launchHoldActive = false,
): boolean {
  const ms = launchHoldActive ? 0 : positionMs;
  return !Number.isFinite(ms) || ms <= 0;
}

/** How the licensed bus is held until the station-launch liner speaks. */
export type StationLaunchHoldMode = "hard_pause" | "intro_ramp";

/** Intros shorter than this are cold vocal starts — pause, never pre-duck. */
const LAUNCH_COLD_VOCAL_INTRO_SEC = 3;

/**
 * Unprobed / missing `introDurationSec` is treated as this many seconds of
 * instrumental bed — enough to air the opener as `intro_ramp`.
 */
const UNPROBED_INTRO_DURATION_SEC = 6;

/**
 * Choose `hard_pause` vs `intro_ramp` at hold-arm time (playhead is 0:00).
 *
 * Missing, `undefined`, `null`, or non-finite `introDurationSec` is an
 * unprobed intro and resolves to `intro_ramp` (pre-duck at 18% from 0:00).
 * `hard_pause` is reserved for confirmed cold vocal intros
 * (`introDurationSec < 3`).
 */
export function resolveStationLaunchHoldMode(input?: {
  introDurationSec?: number | null;
}): StationLaunchHoldMode {
  const intro = input?.introDurationSec;
  const resolvedIntro =
    typeof intro === "number" && Number.isFinite(intro)
      ? intro
      : UNPROBED_INTRO_DURATION_SEC;
  if (resolvedIntro < LAUNCH_COLD_VOCAL_INTRO_SEC) {
    return "hard_pause";
  }
  return "intro_ramp";
}

/** Host Tuning Console knobs that must be tier-clamped before LLM prompts. */
export type HostTuningPromptSettings = {
  pace: DjPace;
  lore: CommentaryFormat;
  knowledge: DjKnowledge;
  allowExplicit: boolean;
  customDirectives: string;
};

/** Optional WS-5 Free vibe-chip preview — does not persist `vibePrompt`. */
export type ClampHostTuningOptions = {
  /**
   * When true, Free `customDirectives` pass through for the live session
   * preview window. Pro ignores this flag. Default / omitted → still force "".
   */
  vibePreviewActive?: boolean;
};

/** True only for an explicit Free preview request — never inferred from vibe text. */
export function parseVibePreviewActive(value: unknown): boolean {
  return value === true;
}

/**
 * Free-tier clamp for host colour / depth / explicit / directives.
 * Pro passes settings through unchanged.
 *
 * Free `customDirectives` stay `""` unless a session-scoped vibe-chip preview
 * is active (`options.vibePreviewActive`). That preview is request-only and
 * must never be written to `stationConfigs.vibePrompt`.
 */
export function clampHostTuningForTier(
  settings: HostTuningPromptSettings,
  isPro: boolean,
  options?: ClampHostTuningOptions,
): HostTuningPromptSettings {
  const pace = isPro ? settings.pace : FREE_TIER_DJ_PACE;
  const lore = isPro ? settings.lore : "standard";
  const knowledge = isPro ? settings.knowledge : "basic_facts";
  const allowExplicit = isPro ? settings.allowExplicit : false;
  const customDirectives =
    isPro || options?.vibePreviewActive === true ? settings.customDirectives : "";
  return {
    pace,
    lore,
    knowledge,
    allowExplicit,
    customDirectives,
  };
}

/** Break frequency → system-prompt pacing instruction. */
export function paceGuidance(pace: DjPace): string {
  switch (pace) {
    case "silent":
      return " Pace: no DJ breaks. Music playback only.";
    case "every_song":
      return (
        " Pace: host speaks between every single track transition."
      );
    case "long_breaks":
      return (
        " Pace: extended storytelling breaks spaced further apart."
      );
    case "short_breaks":
    default:
      return (
        " Pace: balanced radio cadence with breaks every 2–3 songs."
      );
  }
}

/** Lore / commentary depth → system-prompt trivia focus. */
export function loreGuidance(lore: CommentaryFormat): string {
  switch (lore) {
    case "roots_branches":
      return (
        " Lore: Target 25–32 words (~12–14s). One musicology beat from the assigned pillar — chart, production, personnel, lyrics, or era. Never a generic origin story."
      );
    case "time_capsule":
      return (
        " Lore: Target 55–75 words (~20–28s). Include era context and release-year cultural highlights."
      );
    case "directors_cut":
      return (
        " Lore: Target 80–110 words (~30–45+s). 3-part structure — (1) The Hook,"
        + " (2) The Deep Lore (studio anecdotes, mic setups, session musician facts),"
        + " (3) The Segue into the next track."
      );
    case "standard":
    default:
      return (
        " Lore: Target 15–25 words (~5–8s). Concise track title, artist name, and station ID."
      );
  }
}

/** Knowledge depth → system-prompt trivia guardrail (legacy Tuning Console). */
export function knowledgeGuidance(knowledge: DjKnowledge): string {
  switch (knowledge) {
    case "basic_facts":
      return (
        " Knowledge: stick strictly to song/artist names without deep commentary."
      );
    case "genius":
      return (
        " Knowledge: share obscure deep-cut trivia, producer notes, and music history."
      );
    case "smart":
    default:
      return (
        " Knowledge: include verified chart positions, album years, and key facts."
      );
  }
}

/**
 * Explicit-content gate for system prompts.
 * When `false`, appends a hard FCC / family-friendly requirement.
 */
export function allowExplicitGuidance(allowExplicit: boolean): string {
  if (allowExplicit) return "";
  return (
    " STRICT REQUIREMENT: Keep all language 100% FCC clean and family friendly."
  );
}

/**
 * Concatenate pace / lore / knowledge / clean-language
 * directives for injection into generate-script system prompts.
 */
export function buildHostTuningPromptDirective(
  settings: Pick<
    HostTuningPromptSettings,
    | "pace"
    | "lore"
    | "knowledge"
    | "allowExplicit"
  >,
): string {
  return (
    paceGuidance(settings.pace)
    + loreGuidance(settings.lore)
    + knowledgeGuidance(settings.knowledge)
    + allowExplicitGuidance(settings.allowExplicit)
  );
}

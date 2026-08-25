/**
 * Fast, non-LLM station-launch liners + host-tuning clamp / prompt guidance.
 *
 * Track #0 openings skip the slow generate-script LLM path and feed one of
 * these templates straight to TTS via `/api/generate-script` `customText`.
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

type LaunchLinerTemplate = (
  stationName: string,
  artist: string,
  title: string,
) => string;

const STATION_LAUNCH_LINERS: readonly LaunchLinerTemplate[] = [
  (stationName, artist, title) =>
    `Welcome to ${stationName}. Up first, here's ${title} by ${artist}.`,
  (stationName, artist, title) =>
    `You're locked into ${stationName}. Kicking things off with ${title} by ${artist}.`,
  (stationName, artist, title) =>
    `${stationName} is on the air. First up — ${title} by ${artist}.`,
  (stationName, artist, title) =>
    `Thanks for tuning in to ${stationName}. Here's ${artist} with ${title}.`,
];

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
 * Pick a short station-launch liner. Rotates randomly across the template set
 * so reopenings don't feel canned.
 */
export function getStationLaunchLiner(
  stationName: string,
  artist: string,
  title: string,
): string {
  const name = resolveSpokenStationBrand(stationName);
  const trackArtist = artist.trim() || "the artist";
  const trackTitle = title.trim() || "this one";
  const index = Math.floor(Math.random() * STATION_LAUNCH_LINERS.length);
  const template = STATION_LAUNCH_LINERS[index] ?? STATION_LAUNCH_LINERS[0];
  return template(name, trackArtist, trackTitle);
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

/**
 * Free-tier clamp for host colour / depth / explicit / directives.
 * Pro passes settings through unchanged.
 */
export function clampHostTuningForTier(
  settings: HostTuningPromptSettings,
  isPro: boolean,
): HostTuningPromptSettings {
  const pace = isPro ? settings.pace : FREE_TIER_DJ_PACE;
  const lore = isPro ? settings.lore : "standard";
  const knowledge = isPro ? settings.knowledge : "basic_facts";
  const allowExplicit = isPro ? settings.allowExplicit : false;
  const customDirectives = isPro ? settings.customDirectives : "";
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

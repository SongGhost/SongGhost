/**
 * Fast, non-LLM station-launch liners + host-tuning clamp / prompt guidance.
 *
 * Track #0 openings skip the slow generate-script LLM path and feed one of
 * these templates straight to TTS via `/api/generate-script` `customText`.
 *
 * Tuning Console mood / personality / knowledge / explicit / custom directives
 * are clamped for Free tier before system-prompt assembly.
 */

import type { DjKnowledge, DjMood, DjPersonality } from "@/types/dj";

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

/**
 * Pick a short station-launch liner. Rotates randomly across the template set
 * so reopenings don't feel canned.
 */
export function getStationLaunchLiner(
  stationName: string,
  artist: string,
  title: string,
): string {
  const name = stationName.trim() || "SongHost Radio";
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
 */
export function shouldPauseForStationLaunchVocals(positionMs: number): boolean {
  return !Number.isFinite(positionMs) || positionMs <= 0;
}

/** Host Tuning Console knobs that must be tier-clamped before LLM prompts. */
export type HostTuningPromptSettings = {
  mood: DjMood;
  personality: DjPersonality;
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
  const mood = isPro ? settings.mood : "even_keel";
  const personality = isPro ? settings.personality : "normal";
  const knowledge = isPro ? settings.knowledge : "basic_facts";
  const allowExplicit = isPro ? settings.allowExplicit : false;
  const customDirectives = isPro ? settings.customDirectives : "";
  return { mood, personality, knowledge, allowExplicit, customDirectives };
}

/** Mood → system-prompt delivery instruction. */
export function moodGuidance(mood: DjMood): string {
  switch (mood) {
    case "chill":
      return " Mood: laid-back, relaxed, late-night FM tone.";
    case "hyped":
      return " Mood: high-energy, enthusiastic morning-show tone.";
    case "even_keel":
    default:
      return " Mood: balanced, professional radio tone.";
  }
}

/** Personality → system-prompt character colour. */
export function personalityGuidance(personality: DjPersonality): string {
  switch (personality) {
    case "kind":
      return " Personality: warm, empathetic, encouraging.";
    case "dry":
      return " Personality: deadpan, understated humor.";
    case "sarcastic":
      return " Personality: witty, sarcastic music critic.";
    case "funny":
      return " Personality: playful, cracking jokes.";
    case "normal":
    default:
      return " Personality: standard broadcast host.";
  }
}

/** Knowledge depth → system-prompt trivia guardrail. */
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
 * Concatenate mood / personality / knowledge / clean-language directives
 * for injection into generate-script system prompts.
 */
export function buildHostTuningPromptDirective(
  settings: Pick<
    HostTuningPromptSettings,
    "mood" | "personality" | "knowledge" | "allowExplicit"
  >,
): string {
  return (
    moodGuidance(settings.mood)
    + personalityGuidance(settings.personality)
    + knowledgeGuidance(settings.knowledge)
    + allowExplicitGuidance(settings.allowExplicit)
  );
}

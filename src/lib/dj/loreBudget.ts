/**
 * Lore word ceilings and local-TTS warmup budgets.
 *
 * OpenAI Director's Cut stays long-form (80–110 words). Local Chatterbox on an
 * 8 GB GPU (RTX 3070 Ti class) uses a tighter but still extended cap so a warm
 * synth can finish in ~5–15s instead of multi-minute jobs.
 */

import type { CommentaryFormat } from "@/types/dj";

/** OpenAI / cloud ceilings — do not flatten Director's Cut. */
export const OPENAI_LORE_WORD_MAX: Record<CommentaryFormat, number> = {
  standard: 25,
  roots_branches: 32,
  time_capsule: 75,
  directors_cut: 110,
};

/**
 * Local lore stays clearly longer than Standard (22), not a one-trivia-line.
 * Chosen so a warm 3070 Ti can finish typical lore in ~5–15s.
 */
export const LOCAL_LORE_WORD_MAX: Record<CommentaryFormat, number> = {
  standard: 22,
  roots_branches: 32,
  time_capsule: 48,
  directors_cut: 62,
};

export const LOCAL_LORE_WORD_MIN: Record<CommentaryFormat, number> = {
  standard: 15,
  roots_branches: 25,
  time_capsule: 38,
  directors_cut: 48,
};

/**
 * If the host is not on-air by this deadline, skip the break and start the
 * song at 100%. Live YouTube must never wait out a multi-minute GPU job.
 * Same 20s value as `VOICE_PACKAGE_DEADLINE_MS` in `src/lib/audio/break-flight.ts`,
 * which is the live-dial gate for every TTS provider at transition time.
 */
export const LOCAL_TTS_GAP_BUDGET_MS = 20_000;

/** Local warmup starts earlier than OpenAI so the GPU can finish in-song. */
export const PREFETCH_LEAD_SECONDS_LOCAL_DEFAULT = 75;
export const PREFETCH_LEAD_SECONDS_LOCAL_TIME_CAPSULE = 100;
export const PREFETCH_LEAD_SECONDS_LOCAL_DIRECTORS_CUT = 120;

export function isLocalTtsProvider(provider?: string | null): boolean {
  return provider === "local";
}

export function loreWordMaxForProvider(
  format: CommentaryFormat,
  provider?: string | null,
): number {
  return isLocalTtsProvider(provider)
    ? LOCAL_LORE_WORD_MAX[format]
    : OPENAI_LORE_WORD_MAX[format];
}

export function localLoreLengthGuidance(format: CommentaryFormat): string {
  if (format === "directors_cut") {
    return (
      "Target 48–62 words (~18–24s). Two teaching beats (hook + one teach), then handoff."
      + " Still longer than Standard — do not collapse to one trivia line."
    );
  }
  if (format === "time_capsule") {
    return "Target 38–48 words (~14–18s). Era context, then handoff.";
  }
  if (format === "roots_branches") {
    return "Target 25–32 words (~12–14s). One musicology beat, then stop.";
  }
  return "Target 15–22 words (~5–8s). Concise track title, artist name, and station ID.";
}

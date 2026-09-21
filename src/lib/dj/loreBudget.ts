/**
 * Lore word ceilings and local-TTS warmup budgets.
 *
 * Director's Cut is never GPU-soft-capped. Local and OpenAI share the same
 * 80–110 word teaching contract. Prefetch lead, gap deadline, and never-talk-over
 * still apply — they skip a late clip; they do not shorten the script.
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
 * Local lore for Standard / Roots / Time Capsule can stay slightly tighter
 * for GPU time. Director's Cut matches OpenAI — no shorter soft-cap.
 */
export const LOCAL_LORE_WORD_MAX: Record<CommentaryFormat, number> = {
  standard: 22,
  roots_branches: 32,
  time_capsule: 48,
  directors_cut: 110,
};

export const LOCAL_LORE_WORD_MIN: Record<CommentaryFormat, number> = {
  standard: 15,
  roots_branches: 25,
  time_capsule: 38,
  directors_cut: 80,
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

/** Shared Director's Cut teaching + length contract (local and OpenAI). */
export function directorsCutLengthGuidance(): string {
  return (
    "Target 80–110 words (~35–45s). Required: one concrete craft/history beat"
    + " (studio, producer, technique, or scene) AND one why-it-matters beat,"
    + " then a clean handoff. If a named collaborator is uncertain, teach a"
    + " verifiable general craft point instead of inventing names."
    + " Do not collapse to one trivia sentence plus now-playing."
    + " Local TTS uses this same length — there is no shorter GPU soft-cap."
  );
}

export function loreWordMaxForProvider(
  format: CommentaryFormat,
  provider?: string | null,
): number {
  if (format === "directors_cut") {
    return OPENAI_LORE_WORD_MAX.directors_cut;
  }
  return isLocalTtsProvider(provider)
    ? LOCAL_LORE_WORD_MAX[format]
    : OPENAI_LORE_WORD_MAX[format];
}

export function localLoreLengthGuidance(format: CommentaryFormat): string {
  if (format === "directors_cut") {
    return directorsCutLengthGuidance();
  }
  if (format === "time_capsule") {
    return "Target 38–48 words (~14–18s). Era context, then handoff.";
  }
  if (format === "roots_branches") {
    return "Target 25–32 words (~12–14s). One musicology beat, then stop.";
  }
  return "Target 15–22 words (~5–8s). Concise spoken teaching. Do not also demand a station ID.";
}

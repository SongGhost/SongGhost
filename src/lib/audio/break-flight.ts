/**
 * Single-flight DJ-break generation token.
 *
 * One live break attempt at a time. Skip, station change, Host Studio voice
 * or script settings, queue advance, and the voice-package deadline bump the
 * generation so a late TTS result cannot speak over music that already started.
 */

/** Soft deadline from transition start. If the clip is not on-air by then, skip the break and start the song at 100%. Never queue late play. */
export const VOICE_PACKAGE_DEADLINE_MS = 20_000;

export type BreakAbortReason =
  | "skip"
  | "station_change"
  | "queue_advance"
  | "track_change"
  | "settings_change"
  | "timeout"
  | "music_released"
  | "companion"
  | "teardown"
  | "superseded";

export type SkipBreakReason =
  | "timeout"
  | "aborted"
  | "tts_unavailable"
  | "music_already_playing"
  | "stale_generation"
  | "not_ready";

export type BreakAttempt = {
  generation: number;
  controller: AbortController;
  signal: AbortSignal;
};

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String((error as { name?: unknown }).name) : "";
  return name === "AbortError" || name === "TimeoutError";
}

export function logBreakAbort(
  reason: BreakAbortReason,
  details?: Record<string, unknown>,
): void {
  console.warn("[SongHost] TTS abort", { reason, ...details });
}

export function logSkipBreak(
  reason: SkipBreakReason,
  details?: Record<string, unknown>,
): void {
  console.warn("[SongHost] skip-break", { reason, ...details });
}

export function logSynthDuration(
  durationMs: number,
  details?: Record<string, unknown>,
): void {
  console.log("[SongHost] TTS synth duration_ms", durationMs, details ?? {});
}

/**
 * Per-player coordinator. `canPlay` is the last gate before a clip may air:
 * stale generations and music-already-started attempts must return false.
 */
export class BreakFlightCoordinator {
  private generation = 0;
  private controller: AbortController | null = null;
  private musicReleasedGeneration = 0;

  currentGeneration(): number {
    return this.generation;
  }

  currentController(): AbortController | null {
    return this.controller;
  }

  begin(reason: BreakAbortReason): BreakAttempt {
    this.abort("superseded");
    this.generation += 1;
    this.controller = new AbortController();
    console.log("[SongHost] break-flight begin", {
      generation: this.generation,
      reason,
    });
    return {
      generation: this.generation,
      controller: this.controller,
      signal: this.controller.signal,
    };
  }

  abort(reason: BreakAbortReason): void {
    const controller = this.controller;
    if (!controller || controller.signal.aborted) return;
    logBreakAbort(reason, { generation: this.generation });
    controller.abort(reason);
  }

  /**
   * The song for this transition is on at 100%. Any later clip for this
   * generation must be ignored — never queue a late play.
   */
  markMusicReleased(generation: number, reason: BreakAbortReason | string): void {
    if (generation !== this.generation) return;
    if (this.musicReleasedGeneration === generation) return;
    this.musicReleasedGeneration = generation;
    logBreakAbort("music_released", { generation, trigger: reason });
    const controller = this.controller;
    if (controller && !controller.signal.aborted) {
      controller.abort("music_released");
    }
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  isMusicReleased(generation: number): boolean {
    return this.musicReleasedGeneration === generation;
  }

  canPlay(generation: number): boolean {
    if (generation !== this.generation) return false;
    if (this.musicReleasedGeneration === generation) return false;
    if (this.controller?.signal.aborted) return false;
    return true;
  }
}

export function rampVolume(
  setVolume: (volume: number) => void,
  from: number,
  to: number,
  durationMs: number,
): () => void {
  const start = performance.now();
  let rafId = 0;

  const tick = (now: number) => {
    const progress = Math.min(1, (now - start) / durationMs);
    setVolume(from + (to - from) * progress);
    if (progress < 1) {
      rafId = requestAnimationFrame(tick);
    }
  };

  rafId = requestAnimationFrame(tick);

  return () => cancelAnimationFrame(rafId);
}

/** `HTMLMediaElement.HAVE_ENOUGH_DATA` — the clip can play through uninterrupted. */
const HAVE_ENOUGH_DATA = 4;

/**
 * Resolves once a clip is buffered enough to play through, or after
 * `timeoutMs`. The timeout resolves rather than rejects: a browser that never
 * reports readiness must not strand a warmed break, since starting a
 * partly-buffered clip still beats synthesizing one at the transition.
 */
export function waitForAudioReady(audio: HTMLAudioElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (audio.readyState >= HAVE_ENOUGH_DATA) {
      resolve();
      return;
    }

    const cleanup = () => {
      clearTimeout(timer);
      audio.removeEventListener("canplaythrough", onReady);
      audio.removeEventListener("error", onError);
    };

    const onReady = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error("DJ voice clip failed to decode"));
    };

    const timer = setTimeout(onReady, timeoutMs);
    audio.addEventListener("canplaythrough", onReady);
    audio.addEventListener("error", onError);
  });
}

/**
 * Hold music ducked after speech `ended` so natural voice decay is not cut by
 * the unduck ramp. Shared by VoiceNode (YouTube) and companion orchestrator.
 */
export const SPEECH_END_TAIL_MS = 300;

/**
 * Resolves when the clip finishes or `signal` aborts. Aborting must settle this
 * promise: a skip pauses the element, which fires neither `ended` nor `error`,
 * so without the signal the caller's cleanup (duck release, blob revoke) would
 * never run and the music bus would stay ducked.
 *
 * On a natural `ended`, waits `tailMs` (default {@link SPEECH_END_TAIL_MS})
 * before resolving so callers begin unduck only after the voice tail decays.
 */
export function waitForAudioEnd(
  audio: HTMLAudioElement,
  signal?: AbortSignal,
  tailMs: number = SPEECH_END_TAIL_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    let settled = false;
    let tailTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (tailTimer != null) clearTimeout(tailTimer);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const onEnded = () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      const cushion =
        typeof tailMs === "number" && Number.isFinite(tailMs) && tailMs > 0
          ? tailMs
          : 0;
      if (cushion <= 0) {
        settle(() => resolve());
        return;
      }
      tailTimer = setTimeout(() => settle(() => resolve()), cushion);
    };

    const onAbort = () => {
      settle(() => resolve());
    };

    const onError = () => {
      settle(() => reject(new Error("DJ voice playback failed")));
    };

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

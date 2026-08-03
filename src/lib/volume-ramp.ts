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
 * Resolves when the clip finishes or `signal` aborts. Aborting must settle this
 * promise: a skip pauses the element, which fires neither `ended` nor `error`,
 * so without the signal the caller's cleanup (duck release, blob revoke) would
 * never run and the music bus would stay ducked.
 */
export function waitForAudioEnd(audio: HTMLAudioElement, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    const cleanup = () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };

    const onEnded = () => {
      cleanup();
      resolve();
    };

    const onAbort = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error("DJ voice playback failed"));
    };

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

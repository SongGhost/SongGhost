import { logVolumeChange } from "./audio/mix-bus";

export function rampVolume(
  setVolume: (volume: number) => void,
  from: number,
  to: number,
  durationMs: number,
): () => void {
  logVolumeChange("volume-ramp.start", to, durationMs);
  const start = performance.now();
  let rafId = 0;
  let finished = false;

  const tick = (now: number) => {
    const progress = Math.min(1, (now - start) / durationMs);
    setVolume(from + (to - from) * progress);
    if (progress < 1) {
      rafId = requestAnimationFrame(tick);
    } else if (!finished) {
      finished = true;
      logVolumeChange("volume-ramp.complete", to, durationMs);
    }
  };

  rafId = requestAnimationFrame(tick);

  return () => {
    if (!finished) {
      finished = true;
      logVolumeChange("volume-ramp.cancel", to, durationMs);
    }
    cancelAnimationFrame(rafId);
  };
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
 * Slack added to remaining clip duration so a dropped HTML5 `ended` cannot
 * hang {@link waitForAudioEnd} forever.
 */
export const AUDIO_END_TIMEOUT_SLACK_MS = 2000;

/**
 * Bound used when `HTMLMediaElement.duration` is missing, NaN, or non-positive.
 * Long enough for a full break; short enough that a silent hang cannot last a
 * whole track.
 */
export const UNKNOWN_CLIP_DURATION_MS = 30_000;

/**
 * Extra slack on VoiceNode's restore race: `speechDuration + RESTORE_RAMP_MS +
 * this`. Independent of the 2000 ms `waitForAudioEnd` fallback.
 */
export const RESTORE_WATCHDOG_SLACK_MS = 1500;

/** True when the element has already finished, including a missed `ended`. */
export function hasMediaEnded(audio: HTMLAudioElement): boolean {
  if (audio.ended) return true;
  const duration = audio.duration;
  const currentTime = audio.currentTime;
  return (
    typeof duration === "number"
    && Number.isFinite(duration)
    && duration > 0
    && typeof currentTime === "number"
    && Number.isFinite(currentTime)
    && currentTime >= duration
  );
}

/**
 * Remaining media time in ms. Falls back to {@link UNKNOWN_CLIP_DURATION_MS}
 * when duration is unknown so callers can still arm a watchdog.
 */
export function clipDurationMs(audio: HTMLAudioElement): number {
  const duration = audio.duration;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
    return UNKNOWN_CLIP_DURATION_MS;
  }
  const currentTime = audio.currentTime;
  const elapsed =
    typeof currentTime === "number" && Number.isFinite(currentTime) ? currentTime : 0;
  return Math.max(0, duration - elapsed) * 1000;
}

/**
 * Resolves when the clip finishes or `signal` aborts. Aborting must settle this
 * promise: a skip pauses the element, which fires neither `ended` nor `error`,
 * so without the signal the caller's cleanup (duck release, blob revoke) would
 * never run and the music bus would stay ducked.
 *
 * If the element has already ended — `ended` is true, or `duration` is finite
 * and `currentTime >= duration` — this resolves immediately so a late
 * subscribe cannot miss the only `ended` that will ever fire.
 *
 * On a natural `ended`, waits `tailMs` (default {@link SPEECH_END_TAIL_MS})
 * before resolving so callers begin unduck only after the voice tail decays.
 *
 * A dropped `ended` cannot hang: a fallback timer fires at remaining duration
 * + {@link AUDIO_END_TIMEOUT_SLACK_MS} (or {@link UNKNOWN_CLIP_DURATION_MS} +
 * slack when duration is unknown) and resolves as a completed clip.
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

    if (hasMediaEnded(audio)) {
      resolve();
      return;
    }

    let settled = false;
    let tailTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (tailTimer != null) clearTimeout(tailTimer);
      if (fallbackTimer != null) clearTimeout(fallbackTimer);
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

    fallbackTimer = setTimeout(() => {
      settle(() => resolve());
    }, clipDurationMs(audio) + AUDIO_END_TIMEOUT_SLACK_MS);

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Pavlovian earcon selection and fail-closed playback for lore-type DJ breaks
 * and the Free Roots & Branches teaser (WS-4).
 *
 * Missing or unloadable files skip the cue and never block the spoken clip.
 */

import {
  isLoreSegmentKind,
  isRootsTeaserKind,
  type DjSegmentPlan,
  type LocalEventSubkind,
} from "@/types/dj";

/** Beat between the earcon and the lore clip so the cue lands cleanly. */
export const COMMENTARY_GAP_MS = 500;

const EARCON_LORE = "/audio/earcons/lore/open.mp3";
const EARCON_WEATHER = "/audio/earcons/weather/open.mp3";
const EARCON_CONCERT = "/audio/earcons/concert/open.mp3";
const EARCON_TEASER = "/audio/earcons/teaser/open.mp3";

export function resolveLocalEventSubkind(
  plan: Pick<DjSegmentPlan, "localEventSubkind" | "localEvent">,
): LocalEventSubkind {
  if (plan.localEventSubkind === "weather" || plan.localEventSubkind === "concert") {
    return plan.localEventSubkind;
  }
  return plan.localEvent ? "concert" : "weather";
}

/** Public URL for the break's earcon, or null when this kind has no cue. */
export function resolveEarconSrc(
  plan: Pick<DjSegmentPlan, "kind" | "localEventSubkind" | "localEvent">,
): string | null {
  if (isRootsTeaserKind(plan.kind)) return EARCON_TEASER;
  if (!isLoreSegmentKind(plan.kind)) return null;
  if (plan.kind === "local_events") {
    return resolveLocalEventSubkind(plan) === "weather"
      ? EARCON_WEATHER
      : EARCON_CONCERT;
  }
  return EARCON_LORE;
}

export function waitCommentaryGap(
  ms: number = COMMENTARY_GAP_MS,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Aborted stale DJ break", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted stale DJ break", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Play a short earcon through the speech graph (or an HTMLAudioElement fallback).
 * Fail closed: missing files, decode errors, and abort all resolve without throwing.
 */
export async function playEarconFailClosed(
  src: string | null | undefined,
  options?: {
    signal?: AbortSignal;
    audioContext?: AudioContext | null;
    /** Linear gain for the cue. Defaults to 1. */
    gain?: number;
  },
): Promise<void> {
  const url = src?.trim();
  if (!url) return;
  const signal = options?.signal;
  const gain = options?.gain ?? 1;
  if (signal?.aborted) return;

  try {
    const response = await fetch(url, { signal });
    if (!response.ok) return;
    const arrayBuffer = await response.arrayBuffer();
    if (!arrayBuffer.byteLength) return;
    if (signal?.aborted) return;

    const audioContext = options?.audioContext ?? null;
    if (audioContext) {
      if (audioContext.state === "suspended") {
        await audioContext.resume().catch(() => undefined);
      }
      const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      if (signal?.aborted) return;
      await playDecodedEarcon(audioContext, decoded, gain, signal);
      return;
    }

    await playHtmlEarcon(arrayBuffer, gain, signal);
  } catch {
    // Fail closed — proceed to the lore clip.
  }
}

function playDecodedEarcon(
  audioContext: AudioContext,
  buffer: AudioBuffer,
  gainValue: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    const gain = audioContext.createGain();
    gain.gain.value = Number.isFinite(gainValue) ? Math.max(0, gainValue) : 1;
    source.connect(gain);
    gain.connect(audioContext.destination);

    const finish = () => {
      source.onended = null;
      try {
        source.disconnect();
        gain.disconnect();
      } catch {
        // Already torn down.
      }
      resolve();
    };

    source.onended = finish;
    signal?.addEventListener(
      "abort",
      () => {
        try {
          source.stop();
        } catch {
          // Already stopped.
        }
        finish();
      },
      { once: true },
    );

    try {
      source.start(0);
    } catch {
      finish();
    }
  });
}

function playHtmlEarcon(
  arrayBuffer: ArrayBuffer,
  gainValue: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
    const objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(objectUrl);
    audio.volume = Number.isFinite(gainValue) ? Math.min(1, Math.max(0, gainValue)) : 1;

    const finish = () => {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      URL.revokeObjectURL(objectUrl);
      resolve();
    };

    audio.onended = finish;
    audio.onerror = finish;
    signal?.addEventListener("abort", finish, { once: true });

    void audio.play().catch(() => {
      finish();
    });
  });
}

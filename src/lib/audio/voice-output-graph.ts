/**
 * Live DJ voice output: MediaElementSource → GainNode → limiter → destination.
 *
 * HTMLMediaElement.volume is capped at 1.0, which silently throws away
 * VOICE_HEADROOM_BOOST when the deck is loud. A GainNode may exceed 1.0, so
 * master × dj% × 1.35 is actually heard. The compressor is a gentle brick-wall
 * so a boost that pushes a hot TTS peak above 0 dBFS does not hard-clip.
 */

import {
  clampGain,
  clampWebAudioGain,
  getMasterAnalyser,
  logVolumeChange,
  setGainSmooth,
  VOICE_HEADROOM_BOOST,
} from "./mix-bus";

/** Catch just below 0 dBFS. Normal-level speech sits well under this. */
export const VOICE_LIMITER_THRESHOLD_DB = -1;
/** Soft knee so the limiter eases in instead of grabbing. */
export const VOICE_LIMITER_KNEE_DB = 8;
/** Limiter ratio — high enough to brick-wall, not a mix compressor. */
export const VOICE_LIMITER_RATIO = 20;
export const VOICE_LIMITER_ATTACK_SEC = 0.003;
export const VOICE_LIMITER_RELEASE_SEC = 0.15;

export type VoiceOutputGraph = {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  limiter: DynamicsCompressorNode;
  setGain(value: number): void;
  disconnect(): void;
};

/**
 * On-air voice gain for a Web Audio GainNode. Same math as mix-bus `voiceGain`
 * but not clamped to the HTML element ceiling of 1.0.
 *
 *   master × djVolumeNormalized × VOICE_HEADROOM_BOOST  (up to 1.35)
 */
export function liveVoiceGain(
  masterVolume: number,
  djVolumeNormalized: number = 1,
): number {
  const master = clampGain(masterVolume);
  if (master === 0) return 0;
  const dj = clampGain(djVolumeNormalized);
  if (dj === 0) return 0;
  return clampWebAudioGain(master * dj * VOICE_HEADROOM_BOOST);
}

/**
 * Route `element` through a GainNode that may exceed 1.0.
 *
 * Returns `null` when Web Audio is unavailable or the context is not running —
 * callers must fall back to `element.volume` (clamped at 1.0) so the clip is
 * not captured into a silent graph. Once attached, leave `element.volume` at
 * 1.0; the GainNode is the only gain stage.
 */
export function attachVoiceOutputGraph(
  element: HTMLMediaElement,
  initialGain: number,
  audioContext?: AudioContext | null,
): VoiceOutputGraph | null {
  try {
    const ctx = audioContext ?? getMasterAnalyser().getAudioContext();
    if (!ctx || ctx.state !== "running") return null;

    const source = ctx.createMediaElementSource(element);
    const gain = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();

    limiter.threshold.value = VOICE_LIMITER_THRESHOLD_DB;
    limiter.knee.value = VOICE_LIMITER_KNEE_DB;
    limiter.ratio.value = VOICE_LIMITER_RATIO;
    limiter.attack.value = VOICE_LIMITER_ATTACK_SEC;
    limiter.release.value = VOICE_LIMITER_RELEASE_SEC;

    const value = clampWebAudioGain(initialGain);
    logVolumeChange("voice-output-graph.gain.init", value, 0, ctx.currentTime);
    gain.gain.value = value;

    source.connect(gain);
    gain.connect(limiter);

    const masterOut = getMasterAnalyser().getMasterOutput();
    const sink =
      masterOut && masterOut.context === ctx ? masterOut : ctx.destination;
    limiter.connect(sink);

    // Native output is now the graph. Do not also scale .volume — that would
    // double-apply and re-introduce the 1.0 cap on the source.
    element.volume = 1;
    element.muted = false;

    let disconnected = false;
    return {
      context: ctx,
      source,
      gain,
      limiter,
      setGain(next: number) {
        if (disconnected) return;
        setGainSmooth(gain.gain, next, ctx);
      },
      disconnect() {
        if (disconnected) return;
        disconnected = true;
        try {
          source.disconnect();
        } catch {
          // Best-effort — clip teardown must not throw.
        }
        try {
          gain.disconnect();
        } catch {
          // ignore
        }
        try {
          limiter.disconnect();
        } catch {
          // ignore
        }
      },
    };
  } catch {
    return null;
  }
}

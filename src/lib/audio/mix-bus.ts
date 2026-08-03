/**
 * Gain staging for the two broadcast channels: music and DJ voice.
 *
 * Both channels derive their level from the same master fader (0–1), but only
 * the music channel is routed through the sidechain duck gain. Keeping the two
 * derivations in one module is what makes "never duck the voice" a structural
 * guarantee rather than a convention each call site has to remember.
 */

/** Music level while the DJ is speaking, as a fraction of master. */
export const DUCK_RATIO = 0.25;
export const DUCK_RAMP_MS = 300;
export const RESTORE_RAMP_MS = 1500;

/** Duck gain when no break is on air — music sits at full master. */
export const UNDUCKED_GAIN = 1;

/**
 * TTS clips arrive with far more headroom than loudness-maximized music
 * masters, so a voice riding raw master drops under the room noise floor long
 * before the music does. This floor keeps a break intelligible at low master
 * without letting the DJ outrun a deliberately quiet fader.
 */
export const MIN_VOICE_GAIN = 0.1;

export function clampGain(gain: number): number {
  if (!Number.isFinite(gain)) return 0;
  if (gain <= 0) return 0;
  return Math.min(1, gain);
}

/**
 * Music channel level. `duckGain` is relative to master, so the ducked music
 * keeps tracking the fader while a break is on air instead of being pinned to
 * whatever master happened to be when the duck started.
 */
export function musicGain(masterVolume: number, duckGain: number = UNDUCKED_GAIN): number {
  return clampGain(clampGain(masterVolume) * clampGain(duckGain));
}

/** Music channel level as 0–100, the scale the YouTube IFrame API expects. */
export function musicVolumePercent(
  masterVolume: number,
  duckGain: number = UNDUCKED_GAIN,
): number {
  return Math.round(musicGain(masterVolume, duckGain) * 100);
}

/**
 * Voice channel level. Deliberately takes no duck gain: ducking exists to
 * clear room for this channel, so attenuating it here would cancel the effect
 * out. A muted master still mutes the voice.
 */
export function voiceGain(masterVolume: number): number {
  const master = clampGain(masterVolume);
  if (master === 0) return 0;
  return clampGain(Math.max(master, MIN_VOICE_GAIN));
}

/**
 * Gain staging for the three broadcast channels: music, DJ voice, and SFX.
 *
 * All three derive their level from the same master fader (0–1), but only the
 * music channel is routed through the sidechain duck gain. Keeping the
 * derivations in one module is what makes "never duck the voice" a structural
 * guarantee rather than a convention each call site has to remember.
 */

/**
 * Music level while the DJ is speaking, as a fraction of master.
 * Calibrated below the prior 25% so loudness-maximized music clearly yields
 * to the host without disappearing entirely.
 */
export const DUCK_RATIO = 0.18;
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

/**
 * Extra gain applied to DJ speech so ElevenLabs / OpenAI TTS matches commercial
 * music loudness. Clamped by `clampGain` / HTMLAudioElement (max 1.0).
 */
export const VOICE_HEADROOM_BOOST = 1.35;

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
 * out. A muted master still mutes the voice. Headroom boost lifts quiet TTS
 * toward commercial-music loudness before the element clamp.
 */
export function voiceGain(masterVolume: number): number {
  const master = clampGain(masterVolume);
  if (master === 0) return 0;
  return clampGain(Math.max(master, MIN_VOICE_GAIN) * VOICE_HEADROOM_BOOST);
}

/**
 * Station stingers and scratches are punctuation, not program material, so the
 * SFX bus sits under unity: an effect should mark a transition without jumping
 * out of the mix the way a full-scale synthesized burst would.
 */
export const SFX_TRIM = 0.7;

/**
 * SFX channel level. Like the voice channel it takes no duck gain — the effect
 * that matters most fires as a break *ends*, and routing it through the duck
 * would bury it under the break it is there to close.
 */
export function sfxGain(masterVolume: number): number {
  return clampGain(clampGain(masterVolume) * SFX_TRIM);
}

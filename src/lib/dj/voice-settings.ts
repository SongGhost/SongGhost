import type { ElevenLabsVoiceSettings } from "@/data/personas";
import { STANDARD_VOICE_SETTINGS } from "@/data/personas";

/** Floor for Turbo models — lower values cause pitch jumps and rushed cadence. */
export const ELEVENLABS_STABILITY_FLOOR = 0.55;

/** Cap for Turbo models — higher style exaggerates delivery into distortion. */
export const ELEVENLABS_STYLE_CAP = 0.15;

/**
 * Clamp ElevenLabs Turbo `voice_settings` so stability never drops below the
 * floor, style never exceeds the cap, and speaker boost stays off.
 */
export function clampTurboVoiceSettings(
  settings: ElevenLabsVoiceSettings,
): ElevenLabsVoiceSettings {
  return {
    ...settings,
    stability: Math.max(ELEVENLABS_STABILITY_FLOOR, settings.stability),
    style: Math.min(ELEVENLABS_STYLE_CAP, settings.style),
    use_speaker_boost: false,
  };
}

/**
 * Mothballed ElevenLabs calibration (WS-7 Director's Cut).
 * Personality-driven Turbo mapping is gone — personas now carry TTS
 * `instructions` on OpenAI `gpt-4o-mini-tts` instead.
 */
export function voiceSettingsForPersonality(): ElevenLabsVoiceSettings {
  return clampTurboVoiceSettings({ ...STANDARD_VOICE_SETTINGS });
}

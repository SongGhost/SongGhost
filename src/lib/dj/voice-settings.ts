import type { ElevenLabsVoiceSettings } from "@/data/personas";
import type { DjPersonality } from "@/types/dj";

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
 * ElevenLabs delivery knobs driven by Tuning Console personality.
 * Kind / normal stay warmer and more anchored; comedic / dry hosts stay at
 * the Turbo floor/cap rather than dropping stability or raising style.
 */
export function voiceSettingsForPersonality(
  personality: DjPersonality,
): ElevenLabsVoiceSettings {
  let stability = ELEVENLABS_STABILITY_FLOOR;
  let similarity_boost = 0.8;
  let style = ELEVENLABS_STYLE_CAP;

  if (
    personality === "sarcastic"
    || personality === "funny"
    || personality === "dry"
  ) {
    stability = ELEVENLABS_STABILITY_FLOOR;
    similarity_boost = 0.85;
    style = ELEVENLABS_STYLE_CAP;
  } else if (personality === "kind" || personality === "normal") {
    stability = 0.65;
    style = 0.05;
  }

  return clampTurboVoiceSettings({
    stability,
    similarity_boost,
    style,
    use_speaker_boost: false,
  });
}

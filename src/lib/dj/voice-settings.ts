import type { ElevenLabsVoiceSettings } from "@/data/personas";
import type { DjPersonality } from "@/types/dj";

/**
 * ElevenLabs delivery knobs driven by Tuning Console personality.
 * Comedic / dry hosts get lower stability + higher style for expressive cadence;
 * kind / normal stay warmer and more anchored.
 */
export function voiceSettingsForPersonality(
  personality: DjPersonality,
): ElevenLabsVoiceSettings {
  let stability = 0.55;
  let similarity_boost = 0.8;
  let style = 0.15;

  if (
    personality === "sarcastic"
    || personality === "funny"
    || personality === "dry"
  ) {
    // Lower stability allows pitch drops and expressive cadence.
    stability = 0.42;
    similarity_boost = 0.85;
    // Adds comedic rhythm.
    style = 0.28;
  } else if (personality === "kind" || personality === "normal") {
    stability = 0.65;
    style = 0.05;
  }

  return {
    stability,
    similarity_boost,
    style,
    use_speaker_boost: true,
  };
}

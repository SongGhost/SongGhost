import { describe, expect, it } from "vitest";
import {
  clampTurboVoiceSettings,
  ELEVENLABS_STABILITY_FLOOR,
  ELEVENLABS_STYLE_CAP,
  voiceSettingsForPersonality,
} from "../voice-settings";
import { STANDARD_VOICE_SETTINGS } from "@/data/personas";
import type { DjPersonality } from "@/types/dj";

describe("ElevenLabs Turbo voice bounds", () => {
  it("matches the roster standard settings", () => {
    expect(STANDARD_VOICE_SETTINGS.stability).toBeGreaterThanOrEqual(
      ELEVENLABS_STABILITY_FLOOR,
    );
    expect(STANDARD_VOICE_SETTINGS.style).toBeLessThanOrEqual(ELEVENLABS_STYLE_CAP);
    expect(STANDARD_VOICE_SETTINGS.use_speaker_boost).toBe(false);
  });

  it("clamps stability up and style down, and disables speaker boost", () => {
    const clamped = clampTurboVoiceSettings({
      stability: 0.42,
      similarity_boost: 0.85,
      style: 0.28,
      use_speaker_boost: true,
    });
    expect(clamped.stability).toBe(ELEVENLABS_STABILITY_FLOOR);
    expect(clamped.style).toBe(ELEVENLABS_STYLE_CAP);
    expect(clamped.use_speaker_boost).toBe(false);
  });

  it("keeps every personality inside the Turbo floor and cap", () => {
    const personalities: DjPersonality[] = [
      "kind",
      "dry",
      "sarcastic",
      "funny",
      "normal",
    ];
    for (const personality of personalities) {
      const settings = voiceSettingsForPersonality(personality);
      expect(settings.stability).toBeGreaterThanOrEqual(ELEVENLABS_STABILITY_FLOOR);
      expect(settings.style).toBeLessThanOrEqual(ELEVENLABS_STYLE_CAP);
      expect(settings.use_speaker_boost).toBe(false);
    }
  });
});

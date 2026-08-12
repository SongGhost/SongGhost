import { describe, expect, it } from "vitest";
import {
  clampGain,
  DUCK_RAMP_MS,
  DUCK_RATIO,
  GAIN_SMOOTH_TIME_CONSTANT,
  musicGain,
  musicVolumePercent,
  RESTORE_RAMP_MS,
  SPEECH_BASELINE_GAIN,
  SPEECH_GAIN_ATTACK_SEC,
  UNDUCKED_GAIN,
  VOICE_HEADROOM_BOOST,
  voiceGain,
} from "../mix-bus";

describe("ducking invariants", () => {
  it("ducks music to 18% over 300ms and restores over 1500ms", () => {
    expect(DUCK_RATIO).toBe(0.18);
    expect(DUCK_RAMP_MS).toBe(300);
    expect(RESTORE_RAMP_MS).toBe(1500);
    expect(UNDUCKED_GAIN).toBe(1);
  });
});

describe("clampGain", () => {
  it("keeps gains inside 0–1", () => {
    expect(clampGain(0.4)).toBe(0.4);
    expect(clampGain(1.8)).toBe(1);
    expect(clampGain(-0.5)).toBe(0);
  });

  it("treats a non-finite gain as silence", () => {
    expect(clampGain(Number.NaN)).toBe(0);
    expect(clampGain(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampGain(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe("musicGain", () => {
  it("sits at master when no break is on air", () => {
    expect(musicGain(0.8)).toBe(0.8);
    expect(musicGain(0.8, UNDUCKED_GAIN)).toBe(0.8);
  });

  it("scales master by the duck gain", () => {
    expect(musicGain(0.8, DUCK_RATIO)).toBeCloseTo(0.8 * DUCK_RATIO);
    expect(musicGain(0.2, DUCK_RATIO)).toBeCloseTo(0.2 * DUCK_RATIO);
  });

  it("stays relative to master so a fader move mid-break still tracks", () => {
    const before = musicGain(0.8, DUCK_RATIO);
    const after = musicGain(0.4, DUCK_RATIO);
    expect(after).toBeCloseTo(before / 2);
  });

  it("mutes when master is muted, ducked or not", () => {
    expect(musicGain(0, DUCK_RATIO)).toBe(0);
    expect(musicGain(0)).toBe(0);
  });
});

describe("musicVolumePercent", () => {
  it("converts to the 0–100 scale the YouTube embed expects", () => {
    expect(musicVolumePercent(1)).toBe(100);
    expect(musicVolumePercent(0.5)).toBe(50);
    expect(musicVolumePercent(0.5, DUCK_RATIO)).toBe(Math.round(50 * DUCK_RATIO));
    expect(musicVolumePercent(0)).toBe(0);
  });

  it("never reports above 100 for an out-of-range master", () => {
    expect(musicVolumePercent(4)).toBe(100);
  });
});

describe("voiceGain", () => {
  it("applies master × djVolume × TTS headroom boost", () => {
    expect(VOICE_HEADROOM_BOOST).toBe(1.35);
    expect(SPEECH_BASELINE_GAIN).toBe(0.85);
    expect(GAIN_SMOOTH_TIME_CONSTANT).toBe(0.02);
    expect(SPEECH_GAIN_ATTACK_SEC).toBe(0.02);
    // djVolumeNormalized defaults to 1 (100%): master * 1 * BOOST
    expect(voiceGain(0.5)).toBeCloseTo(0.5 * VOICE_HEADROOM_BOOST);
    // Full master saturates at the element ceiling.
    expect(voiceGain(1)).toBe(1);
    expect(voiceGain(0.8)).toBe(1);
  });

  it("scales with the Host Settings DJ Voice Volume (0–1 = percent / 100)", () => {
    // master * (dj% / 100) * BOOST
    expect(voiceGain(1, 0.5)).toBeCloseTo(0.5 * VOICE_HEADROOM_BOOST);
    expect(voiceGain(0.8, 0.5)).toBeCloseTo(0.8 * 0.5 * VOICE_HEADROOM_BOOST);
    expect(voiceGain(1, 0)).toBe(0);
  });

  it("still mutes with the master fader", () => {
    expect(voiceGain(0)).toBe(0);
    expect(voiceGain(-1)).toBe(0);
    expect(voiceGain(0, 1)).toBe(0);
  });

  it("stays above the ducked music at every master level (full DJ fader)", () => {
    for (const master of [0.05, 0.1, 0.25, 0.5, 0.75, 1]) {
      expect(voiceGain(master)).toBeGreaterThan(musicGain(master, DUCK_RATIO));
    }
  });

  it("takes no duck gain — the voice is why the music ducks", () => {
    // Defaulted second arg does not count toward .length; callers cannot pass
    // DUCK_RATIO into the speech channel through a duck parameter.
    expect(voiceGain.length).toBe(1);
  });
});

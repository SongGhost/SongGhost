import { describe, expect, it, vi } from "vitest";
import {
  clampGain,
  clampWebAudioGain,
  companionVoiceGain,
  DUCK_RAMP_MS,
  DUCK_RATIO,
  GAIN_SMOOTH_TIME_CONSTANT,
  logVolumeChange,
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

describe("clampWebAudioGain", () => {
  it("allows headroom up to VOICE_HEADROOM_BOOST", () => {
    expect(clampWebAudioGain(1.2)).toBeCloseTo(1.2);
    expect(clampWebAudioGain(VOICE_HEADROOM_BOOST)).toBe(VOICE_HEADROOM_BOOST);
    expect(clampWebAudioGain(2)).toBe(VOICE_HEADROOM_BOOST);
  });

  it("treats a non-finite or non-positive gain as silence", () => {
    expect(clampWebAudioGain(0)).toBe(0);
    expect(clampWebAudioGain(-0.5)).toBe(0);
    expect(clampWebAudioGain(Number.NaN)).toBe(0);
    expect(clampWebAudioGain(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("companionVoiceGain", () => {
  it("ignores linear master attenuation when the deck is audible", () => {
    expect(companionVoiceGain(0.85, 0.5)).toBeCloseTo(0.85 * VOICE_HEADROOM_BOOST);
    expect(companionVoiceGain(0.85, 1)).toBeCloseTo(0.85 * VOICE_HEADROOM_BOOST);
    expect(companionVoiceGain(0.85, 0.5)).toBe(companionVoiceGain(0.85, 1));
  });

  it("allows Web Audio headroom up to VOICE_HEADROOM_BOOST", () => {
    expect(companionVoiceGain(1, 1)).toBeCloseTo(VOICE_HEADROOM_BOOST);
    expect(companionVoiceGain(1, 0.2)).toBeCloseTo(VOICE_HEADROOM_BOOST);
    expect(companionVoiceGain(1, 1)).toBeGreaterThan(1);
  });

  it("mutes when master is at zero", () => {
    expect(companionVoiceGain(1, 0)).toBe(0);
    expect(companionVoiceGain(0.85, 0)).toBe(0);
    expect(companionVoiceGain(1, -1)).toBe(0);
  });

  it("mutes when DJ volume is zero", () => {
    expect(companionVoiceGain(0, 1)).toBe(0);
  });
});

describe("logVolumeChange", () => {
  it("is silent unless NEXT_PUBLIC_ENABLE_AUDIO_TELEMETRY is true", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const previous = process.env.NEXT_PUBLIC_ENABLE_AUDIO_TELEMETRY;
    delete process.env.NEXT_PUBLIC_ENABLE_AUDIO_TELEMETRY;

    logVolumeChange("test.silent", 0.5, 0);
    expect(spy).not.toHaveBeenCalled();

    process.env.NEXT_PUBLIC_ENABLE_AUDIO_TELEMETRY = "true";
    logVolumeChange("test.enabled", 0.5, 0);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[SongHost VOL] test.enabled"));

    if (previous === undefined) delete process.env.NEXT_PUBLIC_ENABLE_AUDIO_TELEMETRY;
    else process.env.NEXT_PUBLIC_ENABLE_AUDIO_TELEMETRY = previous;
    spy.mockRestore();
  });
});

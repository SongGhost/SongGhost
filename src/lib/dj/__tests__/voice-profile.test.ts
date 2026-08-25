import { describe, expect, it } from "vitest";
import type { DJPromptContext } from "@/types/dj";
import {
  buildSystemPrompt,
  buildVoiceProfileDirective,
} from "../promptBuilder";

function context(overrides: Partial<DJPromptContext> = {}): DJPromptContext {
  return {
    track: { title: "Take On Me", artist: "a-ha" },
    personaId: "warm-companion",
    maxDurationSeconds: 8,
    stationName: "Neon Drive",
    stationFrequency: 103.7,
    ...overrides,
  };
}

describe("buildVoiceProfileDirective", () => {
  it("injects energy, accent, snark, and spoken pacing", () => {
    const directive = buildVoiceProfileDirective({
      energy: "high",
      accent: "nyc",
      snark: "heavy",
      pacing: "rapid",
    });
    expect(directive).toContain("VOICE TUNING");
    expect(directive).toContain("energy:");
    expect(directive).toContain("accent:");
    expect(directive).toContain("snark:");
    expect(directive).toContain("spoken pacing:");
    expect(directive).toContain("Never announce that your voice was tuned");
  });

  it("emits nothing when no knobs are set", () => {
    expect(buildVoiceProfileDirective(undefined)).toBe("");
    expect(buildVoiceProfileDirective({})).toBe("");
    expect(buildVoiceProfileDirective({ energy: "blazing" as never })).toBe("");
  });

  it("drops unknown knobs and keeps the valid ones", () => {
    const directive = buildVoiceProfileDirective({
      energy: "low",
      accent: "martian" as never,
    });
    expect(directive).toContain("energy:");
    expect(directive).not.toContain("accent:");
  });
});

describe("voice profile in buildSystemPrompt", () => {
  it("carries voice tuning into the host system prompt", () => {
    const prompt = buildSystemPrompt(
      context({
        voiceProfile: { energy: "high", snark: "light", pacing: "measured" },
      }),
    );
    expect(prompt).toContain("VOICE TUNING");
    expect(prompt).toContain("STATION IDENTITY");
  });

  it("layers voice tuning beside vibe and era rules", () => {
    const prompt = buildSystemPrompt(
      context({
        eraLock: "80s",
        vibePrompt: "neon highway",
        voiceProfile: { accent: "british" },
      }),
    );
    expect(prompt).toContain("ERA LOCK");
    expect(prompt).toContain("STATION VIBE");
    expect(prompt).toContain("VOICE TUNING");
  });
});

import { describe, expect, it, vi } from "vitest";
import { PERSONAS, getPersonaById, resolvePersonaId } from "@/data/personas";
import { buildPersonaDirective, buildSystemPrompt } from "../promptBuilder";
import {
  pickBestPersonaAttempt,
  runPersonaScriptQualityGate,
  shouldValidatePersonaScript,
  validatePersonaScript,
} from "../personaJobs";
import type { DJPromptContext } from "@/types/dj";

const track = { title: "Hotel California", artist: "Eagles" };

function context(overrides: Partial<DJPromptContext> = {}): DJPromptContext {
  return {
    track,
    maxDurationSeconds: 12,
    stationName: "70s Classic Rock",
    ...overrides,
  };
}

describe("persona rename mapping", () => {
  it("keeps stable ids and maps old labels plus new job names", () => {
    expect(resolvePersonaId("warm-companion")).toBe("warm-companion");
    expect(resolvePersonaId("Warm Companion")).toBe("warm-companion");
    expect(resolvePersonaId("The Guide")).toBe("warm-companion");
    expect(resolvePersonaId("Sarcastic Critic")).toBe("sarcastic-critic");
    expect(resolvePersonaId("the-critic")).toBe("sarcastic-critic");
    expect(resolvePersonaId("The Musicologist")).toBe("the-musicologist");
    expect(resolvePersonaId("the-archivist")).toBe("the-musicologist");
    expect(getPersonaById("warm-companion")?.name).toBe("The Guide");
    expect(getPersonaById("sarcastic-critic")?.name).toBe("The Critic");
    expect(getPersonaById("the-musicologist")?.name).toBe("The Archivist");
  });
});

describe("required teaching moves", () => {
  it("passes golden examples for each Pro job", () => {
    const guide = getPersonaById("warm-companion")!;
    const critic = getPersonaById("sarcastic-critic")!;
    const archivist = getPersonaById("the-musicologist")!;
    for (const line of guide.goldenExamples) {
      expect(validatePersonaScript(line, "warm-companion").ok).toBe(true);
    }
    for (const line of critic.goldenExamples) {
      expect(validatePersonaScript(line, "sarcastic-critic").ok).toBe(true);
    }
    for (const line of archivist.goldenExamples) {
      expect(validatePersonaScript(line, "the-musicologist").ok).toBe(true);
    }
  });

  it("flags a Guide script with no ear cue", () => {
    const check = validatePersonaScript(
      "This next one is a favorite and the band really shines tonight.",
      "warm-companion",
    );
    expect(check.ok).toBe(false);
    expect(check.reasons).toContain("Guide missing ear-cue move");
  });

  it("flags a Critic script with no judgment", () => {
    const check = validatePersonaScript(
      "Here comes a track from the same era with a big chorus.",
      "sarcastic-critic",
    );
    expect(check.ok).toBe(false);
    expect(check.reasons).toContain("Critic missing judgment");
  });

  it("flags an Archivist script with no lineage link", () => {
    const check = validatePersonaScript(
      "The playing is tight and the singer sounds confident on the chorus.",
      "the-musicologist",
    );
    expect(check.ok).toBe(false);
    expect(check.hasRequiredMove).toBe(false);
    expect(check.reasons).toContain("Archivist missing lineage link");
  });

  it("flags an Archivist script that only says from the", () => {
    const check = validatePersonaScript(
      "Here comes a track from the same era with a big chorus.",
      "the-musicologist",
    );
    expect(check.ok).toBe(false);
    expect(check.hasRequiredMove).toBe(false);
    expect(check.reasons).toContain("Archivist missing lineage link");
  });

  it("flags banned filler used as empty hype", () => {
    const check = validatePersonaScript(
      "Listen for the guitar. Weekend adventurers energy all night.",
      "warm-companion",
    );
    expect(check.ok).toBe(false);
    expect(check.reasons).toContain("banned filler used as empty hype");
  });

  it("skips names-only announcements and session openers", () => {
    expect(shouldValidatePersonaScript({ scriptPhase: "announcement" })).toBe(false);
    expect(shouldValidatePersonaScript({ isSessionOpening: true, scriptPhase: "lore" })).toBe(
      false,
    );
    expect(shouldValidatePersonaScript({ kind: "stinger" })).toBe(false);
    expect(shouldValidatePersonaScript({ scriptPhase: "lore", kind: "artist_trivia" })).toBe(
      true,
    );
  });
});

describe("quality-gate retry", () => {
  it("retries once then airs the better attempt", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce("This next one is fine I guess.")
      .mockResolvedValueOnce(
        "The chorus works because the guitar drops out — bold, and it earns the return.",
      );

    const result = await runPersonaScriptQualityGate({
      generate,
      personaId: "sarcastic-critic",
      scriptPhase: "lore",
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]?.[0]).toMatch(/PERSONA RETRY/);
    expect(result.retried).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.script).toContain("chorus works");
  });

  it("airs the first draft when retry still fails", async () => {
    const first = "Listen for the snare. The rest is just weekend adventurers energy.";
    const retry = "Weekend adventurers on a timeless journey of vibes.";
    const generate = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(retry);

    const result = await runPersonaScriptQualityGate({
      generate,
      personaId: "warm-companion",
      scriptPhase: "lore",
    });

    expect(result.retried).toBe(true);
    expect(result.attempts).toBe(2);
    const firstScore = validatePersonaScript(first, "warm-companion").score;
    const retryScore = validatePersonaScript(retry, "warm-companion").score;
    expect(result.script).toBe(firstScore >= retryScore ? first : retry);
  });

  it("airs the first draft when retry throws", async function () {
    const first = "Up next is a nice song from a nice band.";
    const generate = vi.fn()
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error("model down"));

    const result = await runPersonaScriptQualityGate({
      generate,
      personaId: "the-musicologist",
      scriptPhase: "lore",
    });

    expect(result.script).toBe(first);
    expect(result.retried).toBe(true);
    expect(result.passed).toBe(false);
  });

  it("does not retry a passing script", async () => {
    const generate = vi.fn().mockResolvedValue(
      "Listen for the two-note guitar figure that opens this — that's the whole hook.",
    );
    const result = await runPersonaScriptQualityGate({
      generate,
      personaId: "warm-companion",
      scriptPhase: "lore",
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.retried).toBe(false);
    expect(result.passed).toBe(true);
  });

  it("prefers a retry that lands the required move over a cleaner miss", () => {
    const miss = "The playing is tight and the singer sounds confident on the chorus.";
    const hit =
      "This sound left Memphis on a small label and spread. Weekend adventurers energy.";
    const missCheck = validatePersonaScript(miss, "the-musicologist");
    const hitCheck = validatePersonaScript(hit, "the-musicologist");
    expect(missCheck.hasRequiredMove).toBe(false);
    expect(hitCheck.hasRequiredMove).toBe(true);
    expect(pickBestPersonaAttempt(miss, missCheck, hit, hitCheck)).toBe(hit);
  });
});

describe("prompts encode the job contracts", () => {
  it("embeds required moves, bans, and golden examples", () => {
    for (const persona of PERSONAS.filter((p) => p.tier === "pro")) {
      const directive = buildPersonaDirective(persona);
      expect(directive).toContain("REQUIRED MOVE");
      expect(directive).toContain("BLIND TEST");
      expect(directive).toContain("SongHost");
      expect(directive).toContain("SonGhost");
      expect(directive).toContain(persona.goldenExamples[0]);
      const prompt = buildSystemPrompt(context({ personaId: persona.id }));
      expect(prompt).toContain(persona.name);
      expect(prompt).toContain("HOST JOB");
    }
  });
});

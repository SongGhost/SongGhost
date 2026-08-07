import { describe, expect, it } from "vitest";
import { DEFAULT_PERSONA, PERSONAS, getPersonaById } from "@/data/personas";
import { buildSegmentUserPrompt, buildSystemPrompt, buildUserPrompt } from "../promptBuilder";
import type { DJPromptContext, DjSegmentPlan } from "@/types/dj";

const track = { title: "Hotel California", artist: "Eagles" };

function context(overrides: Partial<DJPromptContext> = {}): DJPromptContext {
  return {
    track,
    maxDurationSeconds: 6,
    stationName: "70s Classic Rock",
    stationFrequency: 104.5,
    ...overrides,
  };
}

function plan(overrides: Partial<DjSegmentPlan> = {}): DjSegmentPlan {
  return {
    kind: "song_intro",
    transition: "full_break",
    announceTracks: [track],
    maxDurationSeconds: 6,
    styleRotationIndex: 0,
    ...overrides,
  };
}

describe("station identity guardrails", () => {
  it("forbids real broadcasters by name", () => {
    const prompt = buildSystemPrompt(context({ personaId: "sloane-vance" }));

    expect(prompt).toContain("NEVER mention real-world radio stations");
    for (const banned of ["Alt Nation", "KROQ", "SiriusXM", "BBC", "iHeart"]) {
      expect(prompt).toContain(banned);
    }
  });

  it("forbids FM frequencies, dial numbers, and call letters", () => {
    const prompt = buildSystemPrompt(context());

    expect(prompt).toContain("NEVER mention FM frequencies, dial numbers, or radio call letters");
    expect(prompt).toContain("SongHost");
  });

  it("hands the DJ the live curated station name without a dial", () => {
    const prompt = buildSegmentUserPrompt(plan(), context());

    expect(prompt).toContain('"70s Classic Rock"');
    expect(prompt).toContain("ONLY station or genre title you may say");
    expect(prompt).toContain("NEVER mention FM frequencies, dial numbers, or radio call letters");
    expect(prompt).not.toContain("104.5");
    expect(prompt).not.toMatch(/\d+\.\d+\s*FM/i);
  });

  it("omits any dial position even when a legacy frequency is supplied", () => {
    const prompt = buildSegmentUserPrompt(plan(), context({ stationFrequency: 104.5 }));

    expect(prompt).toContain('"70s Classic Rock"');
    expect(prompt).not.toContain("104.5");
    expect(prompt).not.toMatch(/\d+\.\d+\s*FM/i);
  });

  it("names the station in bare track intros too", () => {
    const prompt = buildUserPrompt(context());
    expect(prompt).toContain('"70s Classic Rock"');
    expect(prompt).not.toMatch(/\d+\.\d+\s*FM/i);
  });

  it("pins stingers to the curated station name only", () => {
    const prompt = buildSegmentUserPrompt(plan({ kind: "stinger" }), context());

    expect(prompt).toContain("STATION STINGER");
    expect(prompt).toContain('"70s Classic Rock"');
    expect(prompt).toContain("NEVER mention FM frequencies, dial numbers, or radio call letters");
    expect(prompt).not.toContain("104.5");
  });

  it("falls back to the house name rather than leaving the station blank", () => {
    const prompt = buildSegmentUserPrompt(
      plan({ kind: "stinger" }),
      context({ stationName: undefined, stationFrequency: undefined }),
    );

    expect(prompt).toContain("SongHost");
    expect(prompt).toContain("NEVER mention FM frequencies, dial numbers, or radio call letters");
  });
});

describe("persona voice in the system prompt", () => {
  it("states gender, tone, and vibe for every host", () => {
    for (const persona of PERSONAS) {
      const prompt = buildSystemPrompt(context({ personaId: persona.id }));

      expect(prompt).toContain(persona.name);
      expect(prompt).toContain(`gender ${persona.gender}`);
      expect(prompt).toContain(`tone ${persona.tone}`);
      expect(prompt).toContain(`vibe ${persona.vibe}`);
    }
  });

  it("uses the assigned host's own character brief", () => {
    const sloane = getPersonaById("sloane-vance")!;
    const prompt = buildSystemPrompt(context({ personaId: "sloane-vance" }));

    expect(prompt).toContain(sloane.systemPrompt);
    expect(prompt).not.toContain(getPersonaById("kira-nova")!.systemPrompt);
  });

  it("resolves a legacy host id instead of dropping the persona", () => {
    const prompt = buildSystemPrompt(context({ personaId: "wolfman" as never }));

    expect(prompt).toContain("Johnny Ray");
  });

  it("falls back to the default host when none is supplied", () => {
    expect(buildSystemPrompt(context())).toContain(DEFAULT_PERSONA.name);
  });

  it("lets a creator-studio override replace the character brief", () => {
    const prompt = buildSystemPrompt(
      context({ personaId: "sloane-vance", customPersonaPrompt: "You are a pirate radio ghost." }),
    );

    expect(prompt).toContain("You are a pirate radio ghost.");
    expect(prompt).not.toContain(getPersonaById("sloane-vance")!.systemPrompt);
    expect(prompt).toContain("NEVER mention real-world radio stations");
  });
});

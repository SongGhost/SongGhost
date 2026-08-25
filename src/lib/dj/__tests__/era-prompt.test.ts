import { describe, expect, it } from "vitest";
import type { DJPromptContext, DjSegmentPlan } from "@/types/dj";
import {
  buildEraDirective,
  buildLoreSystemPrompt,
  buildSegmentUserPrompt,
  buildSystemPrompt,
  buildVibeDirective,
  stationIdentityLine,
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

const plan: DjSegmentPlan = {
  kind: "song_intro",
  transition: "full_break",
  announceTracks: [{ title: "Take On Me", artist: "a-ha" }],
  maxDurationSeconds: 8,
  styleRotationIndex: 0,
};

describe("buildEraDirective", () => {
  it("states the window and forbids anything after it", () => {
    const directive = buildEraDirective("80s");
    expect(directive).toContain("1980");
    expect(directive).toContain("1989");
    expect(directive).toContain("ERA LOCK");
  });

  it("bans the throwback framing that breaks the fiction", () => {
    expect(buildEraDirective("70s")).toContain("nostalgia");
  });

  it("emits nothing when no era is locked", () => {
    expect(buildEraDirective("all")).toBe("");
    expect(buildEraDirective(undefined)).toBe("");
  });
});

describe("buildVibeDirective", () => {
  it("quotes the listener's direction without letting the host read it out", () => {
    const directive = buildVibeDirective("moody late-night highway");
    expect(directive).toContain('"moody late-night highway"');
    expect(directive).toContain("Never read it aloud");
  });

  it("collapses whitespace and caps runaway input", () => {
    expect(buildVibeDirective("  neon    rain  ")).toContain('"neon rain"');
    expect(buildVibeDirective("x".repeat(1000)).includes("x".repeat(241))).toBe(false);
  });

  it("emits nothing for a blank or missing vibe", () => {
    expect(buildVibeDirective("")).toBe("");
    expect(buildVibeDirective("   ")).toBe("");
    expect(buildVibeDirective(undefined)).toBe("");
  });
});

describe("buildLoreSystemPrompt", () => {
  it("injects vibe directives into Spotify Companion lore prompts", () => {
    const prompt = buildLoreSystemPrompt("neon highway");
    expect(prompt).toContain('"neon highway"');
    expect(prompt).toContain("STATION VIBE");
    expect(prompt).toContain("JUST finished");
    expect(prompt).toContain("previousTrack");
  });

  it("still labels the just-finished predecessor when custom notes are blank", () => {
    expect(buildLoreSystemPrompt("")).toContain("JUST finished");
    expect(buildLoreSystemPrompt(undefined)).toContain("previousTrack");
    expect(buildLoreSystemPrompt("")).not.toContain("STATION VIBE");
  });
});

describe("buildSystemPrompt", () => {
  it("carries the era rule into the host's system prompt", () => {
    const prompt = buildSystemPrompt(context({ eraLock: "90s" }));
    expect(prompt).toContain("ERA LOCK");
    expect(prompt).toContain("1990");
  });

  it("carries the vibe direction alongside it", () => {
    const prompt = buildSystemPrompt(context({ vibePrompt: "rainy city night" }));
    expect(prompt).toContain('"rainy city night"');
  });

  it("keeps the station identity and TTS rules regardless of era", () => {
    const prompt = buildSystemPrompt(context({ eraLock: "80s" }));
    expect(prompt).toContain("STATION IDENTITY");
    expect(prompt).toContain("PUNCTUATION FOR TTS");
  });

  it("adds nothing when the station is unlocked and has no vibe", () => {
    const locked = buildSystemPrompt(context({ eraLock: "80s", vibePrompt: "neon" }));
    const plain = buildSystemPrompt(context());
    expect(plain).not.toContain("ERA LOCK");
    expect(plain).not.toContain("STATION VIBE");
    expect(locked.length).toBeGreaterThan(plain.length);
  });
});

describe("era in the segment brief", () => {
  it("reminds the host of the era on the station identity line", () => {
    expect(stationIdentityLine(context({ eraLock: "80s" }))).toContain(
      "80s curated station",
    );
  });

  it("leaves the identity line alone when unlocked", () => {
    const line = stationIdentityLine(context());
    expect(line).toContain("SongHost");
    expect(line).not.toContain("Neon Drive");
    expect(line).not.toContain("station — stay inside that era");
  });

  it("speaks a custom name only for listener-saved stations", () => {
    const line = stationIdentityLine(
      context({ isUserSavedStation: true, stationName: "Neon Drive" }),
    );
    expect(line).toContain("Neon Drive");
  });

  it("reaches every segment brief through the identity line", () => {
    const prompt = buildSegmentUserPrompt(plan, context({ eraLock: "2000s" }));
    expect(prompt).toContain("2000s curated station");
  });

  it("still names the track it was told to announce", () => {
    const prompt = buildSegmentUserPrompt(plan, context({ eraLock: "80s" }));
    expect(prompt).toContain("Take On Me");
  });
});

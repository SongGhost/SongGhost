import { describe, expect, it } from "vitest";
import {
  assembleLegacySystemPrompt,
  isTeachingLoreClip,
} from "@/lib/dj/legacyTeachingPrompt";
import {
  buildAssignedPillarDirective,
  buildDjScriptPrompt,
  ENTITY_NAMING_RULE,
} from "@/lib/dj/promptBuilder";
import { liveHostStudioScriptFields } from "@/lib/dj/scriptGenerator";
import { hostStudioScriptFields } from "@/lib/dj-intro";
import type { DjSegmentPlan } from "@/types/dj";

const track = { title: "Hotel California", artist: "Eagles" };
const heard = { title: "Dreams", artist: "Fleetwood Mac" };

function plan(overrides: Partial<DjSegmentPlan> = {}): DjSegmentPlan {
  return {
    kind: "song_intro",
    transition: "full_break",
    announceTracks: [track],
    maxDurationSeconds: 40,
    styleRotationIndex: 0,
    ...overrides,
  };
}

function assembledTeaching(input: {
  personaId: "warm-companion" | "sarcastic-critic" | "the-musicologist";
  lore?: "standard" | "roots_branches" | "time_capsule" | "directors_cut";
  pace?: "every_song" | "short_breaks";
  talkLevel?: "talkative" | "standard";
}) {
  const lore = input.lore ?? "directors_cut";
  const pace = input.pace ?? "every_song";
  const talkLevel = input.talkLevel ?? "talkative";
  const segmentPlan = plan();
  const { system, user } = buildDjScriptPrompt({
    track,
    maxDurationSeconds: 40,
    stationName: "70s Classic Rock",
    personaId: input.personaId,
    commentaryFormat: lore,
    pace,
    talkLevel,
    scriptPhase: "lore",
    segmentPlan,
    previousTrack: heard,
    recentHistory: [heard],
  });
  const systemPrompt = assembleLegacySystemPrompt({
    baseSystem: system,
    pace,
    lore,
    knowledge: "smart",
    allowExplicit: false,
    pillarDirective: buildAssignedPillarDirective(0, lore),
    ttsFormattingRules: " Write all numbers as words.",
    entityNamingRule: ENTITY_NAMING_RULE,
    scriptPhase: "lore",
    kind: "song_intro",
    isSessionOpening: false,
    isTeaser: false,
    namesOnlyAnnouncement: false,
  });
  return { system: systemPrompt, user, full: `${systemPrompt} ${user}` };
}

describe("live legacy teaching assembler", () => {
  it("marks mid-session lore as a teaching clip", () => {
    expect(isTeachingLoreClip({ scriptPhase: "lore", kind: "song_intro" })).toBe(true);
    expect(isTeachingLoreClip({ scriptPhase: "announcement", kind: "song_intro" })).toBe(
      false,
    );
    expect(isTeachingLoreClip({ scriptPhase: "lore", isSessionOpening: true })).toBe(false);
  });

  it("gives Guide + Every Song + Director's Cut one contract without Standard caps", () => {
    const { full, system } = assembledTeaching({ personaId: "warm-companion" });
    expect(system).toContain("REQUIRED MOVE");
    expect(system).toContain("listen for this");
    expect(system).toContain("80–110 words");
    expect(system).toContain("PERSONA JOB OWNS THE MOVE");
    expect(system).toContain("TEACHING TRUTH");
    expect(system).not.toContain("Concise track title, artist name, and station ID");
    expect(system).not.toContain("Keep EVERY sentence under 12 words");
    expect(system).not.toContain("Deliver 1 fascinating fact");
    expect(system).not.toContain("Maximum 16 to 20 words");
    expect(system).not.toContain("SPECIFIC PROPER NOUNS");
    expect(system).not.toContain("describe the vibe");
    expect(full).not.toContain("JUST finished");
    expect(full).not.toContain('Recap cues like "That was [Song]..."');
  });

  it("keeps Critic judgment+craft on Time Capsule teaching lore", () => {
    const { system } = assembledTeaching({
      personaId: "sarcastic-critic",
      lore: "time_capsule",
    });
    expect(system).toContain("REQUIRED MOVE");
    expect(system).toContain("judgment");
    expect(system).toContain("55–75 words");
    expect(system).not.toContain("Keep EVERY sentence under 12 words");
    expect(system).not.toContain("Concise track title, artist name, and station ID");
    expect(system).toContain("PERSONA JOB OWNS THE MOVE");
  });

  it("keeps Archivist lineage on Roots teaching lore without Standard station ID", () => {
    const { system } = assembledTeaching({
      personaId: "the-musicologist",
      lore: "roots_branches",
    });
    expect(system).toContain("REQUIRED MOVE");
    expect(system).toContain("lineage");
    expect(system).toContain("25–32 words");
    expect(system).not.toContain("Concise track title, artist name, and station ID");
    expect(system).not.toContain("Maximum 16 to 20 words");
  });

  it("forwards explicit Host Studio fields instead of inferring chatter", () => {
    const live = liveHostStudioScriptFields({
      chatterPacing: "talkative",
      knowledge: "genius",
      commentaryFormat: "directors_cut",
    });
    const payload = hostStudioScriptFields(live);
    expect(payload.talkLevel).toBe("talkative");
    expect(payload.pace).toBe("every_song");
    expect(payload.knowledge).toBe("genius");
    expect(payload.commentaryFormat).toBe("directors_cut");
  });
});

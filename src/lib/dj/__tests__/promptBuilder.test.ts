import { describe, expect, it } from "vitest";
import {
  buildAntiRepetitionDirective,
  buildAssignedPillarDirective,
  buildBreakLengthDirective,
  buildBroadcastContextDirective,
  buildCommentaryFormatDirective,
  buildLoreHistoryPromptLines,
  buildSegmentUserPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  buildVernacularDirective,
  buildRootsTeaserFormatDirective,
  ENTITY_NAMING_RULE,
  pickMusicologyPillar,
  resolveBroadcastContext,
  resolveBroadcastDaypart,
  resolveBroadcastSeason,
} from "../promptBuilder";
import type { DJPromptContext, DjSegmentPlan } from "@/types/dj";

const currentTrack = { title: "Hotel California", artist: "Eagles" };

function plan(overrides: Partial<DjSegmentPlan> = {}): DjSegmentPlan {
  return {
    kind: "song_intro",
    transition: "full_break",
    announceTracks: [currentTrack],
    maxDurationSeconds: 6,
    styleRotationIndex: 0,
    ...overrides,
  };
}

function context(overrides: Partial<DJPromptContext> = {}): DJPromptContext {
  return {
    track: currentTrack,
    maxDurationSeconds: 6,
    stationName: "Late Night Drive",
    ...overrides,
  };
}

describe("saved station openings", () => {
  it("acknowledges the listener's own mix on the opening break", () => {
    const prompt = buildSegmentUserPrompt(
      plan({ isSessionOpening: true }),
      context({ isUserSavedStation: true, stationId: "saved-station-late-night-drive" }),
    );

    expect(prompt).toContain("PERSONAL STATION SIGN-ON");
    expect(prompt).toContain('"Late Night Drive"');
    expect(prompt).toContain("listener's own saved mix");
    expect(prompt).toContain("Never call it a preset");
  });

  it("still names the track it is introducing", () => {
    const prompt = buildSegmentUserPrompt(
      plan({ isSessionOpening: true }),
      context({ isUserSavedStation: true }),
    );

    expect(prompt).toContain("SONG INTRO");
    expect(prompt).toContain('"Hotel California" by Eagles');
  });

  it("falls back to a generic label when the station has no name", () => {
    const prompt = buildSegmentUserPrompt(
      plan({ isSessionOpening: true }),
      context({ isUserSavedStation: true, stationName: undefined }),
    );

    expect(prompt).toContain("this mix is the listener's own saved mix");
  });

  it("stays out of mid-set breaks on the same station", () => {
    const prompt = buildSegmentUserPrompt(
      plan({ kind: "artist_trivia" }),
      context({ isUserSavedStation: true }),
    );

    expect(prompt).not.toContain("PERSONAL STATION SIGN-ON");
  });

  it("stays out of preset station openings", () => {
    const prompt = buildSegmentUserPrompt(
      plan({ isSessionOpening: true }),
      context({ stationName: "70s Classic Rock" }),
    );

    expect(prompt).not.toContain("PERSONAL STATION SIGN-ON");
  });
});

describe("broadcast clock context", () => {
  it("maps hours onto dayparts", () => {
    expect(resolveBroadcastDaypart(7)).toBe("morning_drive");
    expect(resolveBroadcastDaypart(11)).toBe("midday");
    expect(resolveBroadcastDaypart(15)).toBe("late_afternoon_focus");
    expect(resolveBroadcastDaypart(20)).toBe("evening");
    expect(resolveBroadcastDaypart(1)).toBe("late_night_wind_down");
  });

  it("maps months onto seasons", () => {
    expect(resolveBroadcastSeason(4)).toBe("spring");
    expect(resolveBroadcastSeason(7)).toBe("summer");
    expect(resolveBroadcastSeason(10)).toBe("fall");
    expect(resolveBroadcastSeason(1)).toBe("winter");
  });

  it("flags weekend vs weekday phrasing", () => {
    // 2026-08-01 is a Saturday; 2026-08-04 is a Tuesday (UTC).
    expect(
      resolveBroadcastContext(new Date("2026-08-01T15:00:00Z"), { timeZone: "UTC" }).isWeekend,
    ).toBe(true);
    expect(
      resolveBroadcastContext(new Date("2026-08-04T15:00:00Z"), { timeZone: "UTC" }).isWeekend,
    ).toBe(false);
  });

  it("injects daypart and seasonal energy into segment prompts", () => {
    const prompt = buildSegmentUserPrompt(
      plan(),
      context({ hyperLocal: { timeOfDay: "morning", timezone: "America/Denver" } }),
    );
    expect(prompt).toContain("BROADCAST CLOCK");
    expect(prompt).toContain("Morning drive energy");
    expect(prompt).toContain("Seasonal colour");
  });

  it("honors an explicit late-night hyper-local override", () => {
    const directive = buildBroadcastContextDirective(
      context({ hyperLocal: { timeOfDay: "late_night" } }),
      new Date("2026-08-04T15:00:00"),
    );
    expect(directive).toContain("Late-night wind-down");
  });
});

describe("lore predecessor history", () => {
  const older = { title: "Dreams", artist: "Fleetwood Mac" };
  const mid = { title: "Go Your Own Way", artist: "Fleetwood Mac" };
  const justFinished = { title: "The Chain", artist: "Fleetwood Mac" };

  it("pins recap cues to the last recentHistory entry as N-1", () => {
    const lines = buildLoreHistoryPromptLines({
      recentHistory: [older, mid, justFinished],
    });
    const prompt = lines.join(" ");

    expect(prompt).toContain('previousTrack (JUST finished');
    expect(prompt).toContain('"The Chain" by Fleetwood Mac');
    expect(prompt).toContain("MUST name only this track");
    expect(prompt).toContain("older background context only");
    expect(prompt).toContain('"Dreams" by Fleetwood Mac');
    expect(prompt).not.toMatch(/That was Song A into Song B/);
  });

  it("uses an explicit previousTrack even when recentHistory is older-first", () => {
    const lines = buildLoreHistoryPromptLines({
      previousTrack: justFinished,
      recentHistory: [older, mid, justFinished],
    });
    const prompt = lines.join(" ");

    expect(prompt).toContain('"The Chain" by Fleetwood Mac');
    expect(prompt.indexOf("JUST finished")).toBeLessThan(
      prompt.indexOf("older background context"),
    );
  });

  it("weaves the N-1 predecessor into song-intro user prompts", () => {
    const prompt = buildUserPrompt(
      context({
        previousTrack: justFinished,
        recentHistory: [older, mid, justFinished],
      }),
    );

    expect(prompt).toContain("JUST finished");
    expect(prompt).toContain('"The Chain" by Fleetwood Mac');
    expect(prompt).toContain("older background context only");
  });
});

describe("entity naming and cross-break memory", () => {
  it("requires specific proper nouns instead of hedged generics", () => {
    expect(ENTITY_NAMING_RULE).toContain("SPECIFIC PROPER NOUNS");
    expect(ENTITY_NAMING_RULE).toContain("a top 3 album");
    expect(buildSystemPrompt(context())).toContain("ENTITY NAMING");
  });

  it("folds recent break scripts into the anti-repetition directive", () => {
    const directive = buildAntiRepetitionDirective(
      ["Rumours chart peak"],
      ["That was Dreams, cut in Sausalito off Rumours."],
    );
    expect(directive).toContain("ANTI-REPETITION DIRECTIVE");
    expect(directive).toContain("Rumours chart peak");
    expect(directive).toContain("CROSS-BREAK MEMORY");
    expect(directive).toContain("Sausalito");
    expect(directive).toContain("origin cities");
    expect(directive).toContain("genre slang");
    expect(directive).toContain("vernacular catchphrases");
    expect(directive).toContain("fresh vernacular");
  });

  it("rotates musicology pillars so consecutive breaks are not origin stories", () => {
    expect(pickMusicologyPillar(0).id).toBe("chart_commercial");
    expect(pickMusicologyPillar(1).id).toBe("studio_production");
    expect(pickMusicologyPillar(2).id).toBe("personnel_credits");
    expect(pickMusicologyPillar(5).id).toBe("chart_commercial");
    expect(buildAssignedPillarDirective(1)).toContain("Studio & Production Lore");
    expect(buildAssignedPillarDirective(1)).toContain("Do not default to band origin stories");
    expect(buildAssignedPillarDirective(1, "directors_cut")).toContain("second supporting");
    expect(buildAssignedPillarDirective(1, "directors_cut")).not.toContain(
      "Deliver this pillar only",
    );
  });

  it("does not cap Director's Cut lore at one fact or 16–20 words", () => {
    const lore = buildBreakLengthDirective({
      scriptPhase: "lore",
      commentaryFormat: "directors_cut",
    });
    expect(lore).toContain("80–110 words");
    expect(lore).toContain("second music-teaching beat");
    expect(lore).not.toContain("16 to 20 words");
    expect(lore).not.toContain("Deliver 1 fascinating fact, then stop");

    const localLore = buildBreakLengthDirective({
      scriptPhase: "lore",
      commentaryFormat: "directors_cut",
      ttsProvider: "local",
    });
    expect(localLore).toContain("48–62 words");
    expect(localLore).not.toContain("16 to 20 words");
    expect(localLore).not.toContain("80–110 words");

    const standard = buildBreakLengthDirective({
      scriptPhase: "lore",
      commentaryFormat: "standard",
    });
    expect(standard).toContain("16 to 20 words");
  });

  it("keeps announcement clips short even on Director's Cut", () => {
    const prompt = buildBreakLengthDirective({
      scriptPhase: "announcement",
      commentaryFormat: "directors_cut",
    });
    expect(prompt).toContain("8 to 13 words");
    expect(prompt).not.toContain("80–110 words");
  });

  it("does not emit Standard short caps in a Director's Cut system prompt", () => {
    const system = buildSystemPrompt({
      ...context({
        commentaryFormat: "directors_cut",
        segmentPlan: plan({ kind: "artist_trivia" }),
      }),
      scriptPhase: "lore",
    });
    expect(system).toContain("80–110 words");
    expect(system).not.toContain("Maximum 16 to 20 words");
    expect(system).not.toContain("Maximum 20 to 30 words");
    expect(system).not.toContain("Deliver 1 fascinating fact in 15 seconds");
  });

  it("budgets Roots & Branches at 25–32 words for Mode A", () => {
    const directive = buildCommentaryFormatDirective("roots_branches");
    expect(directive).toContain("25–32 words");
    expect(directive).toContain("~12–14s");
    expect(directive).not.toContain("<break time");
  });
});

describe("Roots & Branches teaser (WS-4)", () => {
  it("writes a short taste, in-character Pro sign-off, and contextual outro", () => {
    const prompt = buildSegmentUserPrompt(
      plan({ kind: "roots_teaser", styleRotationIndex: 1 }),
      context({ personaId: "sarcastic-critic", genreScene: "classic country" }),
    );

    expect(prompt).toContain("ROOTS & BRANCHES TEASER");
    expect(prompt).toContain("14–18 words");
    expect(prompt).toContain("Studio & Production Lore");
    expect(prompt).toContain("Sarcastic Critic");
    expect(prompt).toContain("full dive lives on Pro");
    expect(prompt).toContain("CONTEXTUAL OUTRO");
    expect(prompt).toContain("Do NOT say upgrade now, subscribe, or click to unlock");
    expect(prompt).not.toContain("SONG INTRO");
  });

  it("uses the teaser format directive instead of the full 25–32 word dive", () => {
    const directive = buildRootsTeaserFormatDirective();
    expect(directive).toContain("14–18 words");
    expect(directive).toContain("full dive lives on Pro");
    expect(directive).toContain('Do NOT say "upgrade now"');

    const system = buildSystemPrompt(
      context({
        segmentPlan: plan({ kind: "roots_teaser" }),
        commentaryFormat: "standard",
        genreScene: "Britpop",
      }),
    );
    expect(system).toContain("ROOTS & BRANCHES TEASER");
    expect(system).not.toContain("Target 25–32 words");
    expect(system).toContain("GENRE VERNACULAR");
  });
});

describe("first-playlist that-was / up-next prompts", () => {
  const heard = { title: "Dreams", artist: "Fleetwood Mac" };
  const upcoming = { title: "Go Your Own Way", artist: "Fleetwood Mac" };

  function firstPack(overrides: Partial<DjSegmentPlan> = {}): DjSegmentPlan {
    return plan({
      kind: "up_next",
      isFirstPlaylistPack: true,
      announceTracks: [upcoming],
      recapTracks: [heard],
      upNextTracks: [upcoming],
      maxDurationSeconds: 40,
      ...overrides,
    });
  }

  it("writes a that-was lore clip about Song 1 only", () => {
    const prompt = buildSegmentUserPrompt(
      firstPack(),
      { ...context({ track: upcoming }), scriptPhase: "lore" },
    );

    expect(prompt).toContain("FIRST-PLAYLIST THAT-WAS CLIP");
    expect(prompt).toContain("That was Dreams by Fleetwood Mac");
    expect(prompt).toContain("Do NOT name or tease the upcoming track");
    expect(prompt).not.toContain("FIRST-PLAYLIST UP-NEXT CLIP");
    expect(prompt).not.toContain("ANNOUNCEMENT CLIP");
  });

  it("writes an up-next tease for Song 2 instead of a names-only announcement", () => {
    const prompt = buildSegmentUserPrompt(
      firstPack(),
      { ...context({ track: upcoming }), scriptPhase: "announcement" },
    );

    expect(prompt).toContain("FIRST-PLAYLIST UP-NEXT CLIP");
    expect(prompt).toContain("Up next Go Your Own Way by Fleetwood Mac");
    expect(prompt).not.toContain("ANNOUNCEMENT CLIP — this is NOT a lore");
    expect(prompt).not.toContain("That was Dreams");
  });

  it("does not cap the first-playlist up-next clip at 8 to 13 words", () => {
    const length = buildBreakLengthDirective({
      scriptPhase: "announcement",
      isFirstPlaylistPack: true,
      commentaryFormat: "directors_cut",
    });
    expect(length).toContain("80–110 words");
    expect(length).not.toContain("8 to 13 words");
  });
});

describe("Pavlovian lore / announcement script phases", () => {
  it("keeps the lore clip from announcing the track", () => {
    const prompt = buildSegmentUserPrompt(
      plan({ kind: "song_intro" }),
      { ...context(), scriptPhase: "lore" },
    );

    expect(prompt).toContain("Do NOT name the upcoming track title or artist");
    expect(prompt).not.toContain('Work in "Hotel California" by Eagles');
  });

  it("makes the announcement clip name the track only", () => {
    const prompt = buildSegmentUserPrompt(
      plan({ kind: "song_intro" }),
      { ...context(), scriptPhase: "announcement" },
    );

    expect(prompt).toContain("ANNOUNCEMENT CLIP");
    expect(prompt).toContain('"Hotel California" by Eagles');
    expect(prompt).not.toContain("SONG INTRO");
  });

  it("sanitizes YouTube title junk before the announcement names the track", () => {
    const prompt = buildSegmentUserPrompt(
      plan({
        kind: "song_intro",
        announceTracks: [
          {
            title: "The Notorious B.I.G. - Notorious B.I.G. [HD Remaster]",
            artist: "The Notorious B.I.G.",
          },
        ],
      }),
      { ...context(), scriptPhase: "announcement" },
    );

    expect(prompt).toContain('"Notorious B.I.G." by The Notorious B.I.G.');
    expect(prompt).not.toMatch(/HD Remaster/i);
    expect(prompt).not.toContain("The Notorious B.I.G. - Notorious B.I.G.");
  });
});

describe("genre vernacular directive", () => {
  it("steers word choice without injecting canned phrases", () => {
    const directive = buildVernacularDirective("Britpop");
    expect(directive).toContain("GENRE VERNACULAR");
    expect(directive).toContain("Britpop");
    expect(directive).toContain("host profile");
    expect(directive).toContain("not a tourist");
    expect(directive).not.toContain("mad for it");
    expect(directive).not.toContain("Wonderwall");
  });

  it("omits the directive when the station has no scene (fail open)", () => {
    expect(buildVernacularDirective(undefined)).toBe("");
    expect(buildVernacularDirective("   ")).toBe("");
    expect(buildSystemPrompt(context())).not.toContain("GENRE VERNACULAR");
  });

  it("layers on the persona in the YouTube system prompt", () => {
    const prompt = buildSystemPrompt(
      context({ personaId: "sarcastic-critic", genreScene: "classic country" }),
    );
    expect(prompt).toContain("GENRE VERNACULAR");
    expect(prompt).toContain("classic country");
    expect(prompt).toContain("Sarcastic Critic");
  });

  it("colours announcement clips without turning them into lore", () => {
    const directive = buildVernacularDirective("Britpop", {
      scriptPhase: "announcement",
    });
    expect(directive).toContain("announcement clip");
    expect(directive).toContain("title and artist");
  });

  it("does not replace era lock or station identity", () => {
    const prompt = buildSystemPrompt(
      context({ eraLock: "90s", genreScene: "Britpop" }),
    );
    expect(prompt).toContain("ERA LOCK");
    expect(prompt).toContain("STATION IDENTITY");
    expect(prompt.indexOf("ERA LOCK")).toBeLessThan(prompt.indexOf("GENRE VERNACULAR"));
  });
});

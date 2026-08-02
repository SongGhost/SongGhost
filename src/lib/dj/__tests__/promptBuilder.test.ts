import { describe, expect, it } from "vitest";
import { buildSegmentUserPrompt } from "../promptBuilder";
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

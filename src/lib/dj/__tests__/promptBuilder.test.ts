import { describe, expect, it } from "vitest";
import {
  buildBroadcastContextDirective,
  buildSegmentUserPrompt,
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

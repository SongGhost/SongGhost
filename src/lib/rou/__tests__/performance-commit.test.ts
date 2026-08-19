import { describe, expect, it } from "vitest";
import {
  buildPlaySessionId,
  PERFORMANCE_COMMIT_SECONDS,
  shouldCommitPerformance,
} from "../performance-commit";

const licensed = "https://licensed.example/track.mp3";

describe("shouldCommitPerformance", () => {
  const base = {
    position: PERFORMANCE_COMMIT_SECONDS + 0.1,
    playbackState: "playing" as const,
    playSessionId: "station:track:0:1",
    committedSessionId: null,
    licensedStreamUrl: licensed,
  };

  it("commits once the playhead has passed 30s on a licensed stream", () => {
    expect(shouldCommitPerformance(base)).toBe(true);
  });

  it("refuses a playhead at or below the 30s gate", () => {
    expect(shouldCommitPerformance({ ...base, position: 30 })).toBe(false);
    expect(shouldCommitPerformance({ ...base, position: 12 })).toBe(false);
  });

  it("refuses a second commit for the same play session (pause/resume)", () => {
    expect(
      shouldCommitPerformance({
        ...base,
        position: 35,
        committedSessionId: base.playSessionId,
      }),
    ).toBe(false);
  });

  it("refuses preview-only / missing licensed URLs", () => {
    expect(shouldCommitPerformance({ ...base, licensedStreamUrl: undefined })).toBe(
      false,
    );
    expect(
      shouldCommitPerformance({ ...base, licensedStreamUrl: "dQw4w9wgWcQ" }),
    ).toBe(false);
  });

  it("refuses while paused even if the needle sits past 30s", () => {
    expect(shouldCommitPerformance({ ...base, playbackState: "paused" })).toBe(
      false,
    );
  });
});

describe("buildPlaySessionId", () => {
  it("joins station, track, index, and generation", () => {
    expect(
      buildPlaySessionId({
        stationId: "classic-rock",
        trackId: "isrc:USRC17607839",
        queueIndex: 3,
        queueGeneration: 2,
      }),
    ).toBe("classic-rock:isrc:USRC17607839:3:2");
  });
});

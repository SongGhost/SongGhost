import { describe, expect, it } from "vitest";
import { openingWelcomeStillOwed, readAbortReason, welcomeSpeechStillOnAir, musicReleaseWouldCutSpeech } from "../openingWelcome";

describe("song 1 station welcome", () => {
  it("still owes the welcome after stall skips and a station change, once, on New with the host on", () => {
    let aired = false;
    for (const abortReason of ["stall_skip", "stall_skip", "station_change"] as const) {
      expect(openingWelcomeStillOwed({
        engine: "new",
        hostOn: true,
        welcomeAired: aired,
        abortReason,
      })).toBe(true);
    }
    aired = true;
    expect(openingWelcomeStillOwed({
      engine: "new",
      hostOn: true,
      welcomeAired: aired,
      abortReason: "stall_skip",
    })).toBe(false);
  });

  it("does not owe a welcome when the host is off", () => {
    expect(openingWelcomeStillOwed({
      engine: "new",
      hostOn: false,
      welcomeAired: false,
      abortReason: "stall_skip",
    })).toBe(false);
  });

  it("does not keep a Classic welcome through the New rule", () => {
    expect(openingWelcomeStillOwed({
      engine: "classic",
      hostOn: true,
      welcomeAired: false,
      abortReason: "stall_skip",
    })).toBe(false);
  });

  it("keeps a speaking welcome from being cut when music is released early", () => {
    expect(welcomeSpeechStillOnAir({
      sessionOpening: true,
      welcomeAired: false,
      speaking: true,
    })).toBe(true);
    expect(welcomeSpeechStillOnAir({
      sessionOpening: true,
      welcomeAired: true,
      speaking: true,
    })).toBe(false);
    expect(welcomeSpeechStillOnAir({
      sessionOpening: true,
      welcomeAired: false,
      speaking: false,
    })).toBe(false);
  });

  it("reads a station_change abort off the signal", () => {
    const controller = new AbortController();
    expect(readAbortReason(controller.signal)).toBeNull();
    controller.abort("station_change");
    expect(readAbortReason(controller.signal)).toBe("station_change");
  });

  it("does not start music over a line that is still going", () => {
    expect(musicReleaseWouldCutSpeech({
      speaking: true,
      introRunning: true,
      releaseBreak: true,
    })).toBe(true);
    expect(musicReleaseWouldCutSpeech({
      speaking: false,
      introRunning: true,
      releaseBreak: false,
    })).toBe(true);
    expect(musicReleaseWouldCutSpeech({
      speaking: false,
      introRunning: true,
      releaseBreak: true,
    })).toBe(false);
    expect(musicReleaseWouldCutSpeech({
      speaking: false,
      introRunning: false,
      releaseBreak: false,
    })).toBe(false);
  });
});

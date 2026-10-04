import { describe, expect, it } from "vitest";
import { openingWelcomeStillOwed, readAbortReason } from "../openingWelcome";

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

  it("reads a station_change abort off the signal", () => {
    const controller = new AbortController();
    expect(readAbortReason(controller.signal)).toBeNull();
    controller.abort("station_change");
    expect(readAbortReason(controller.signal)).toBe("station_change");
  });
});

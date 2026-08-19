import { describe, expect, it } from "vitest";
import { resolveStationLaunchHoldMode } from "../scriptGenerator";

describe("resolveStationLaunchHoldMode", () => {
  it("defaults missing, undefined, null, and non-finite intros to intro_ramp", () => {
    expect(resolveStationLaunchHoldMode()).toBe("intro_ramp");
    expect(resolveStationLaunchHoldMode({})).toBe("intro_ramp");
    expect(resolveStationLaunchHoldMode({ introDurationSec: undefined })).toBe(
      "intro_ramp",
    );
    expect(resolveStationLaunchHoldMode({ introDurationSec: null })).toBe(
      "intro_ramp",
    );
    expect(resolveStationLaunchHoldMode({ introDurationSec: Number.NaN })).toBe(
      "intro_ramp",
    );
    expect(
      resolveStationLaunchHoldMode({ introDurationSec: Number.POSITIVE_INFINITY }),
    ).toBe("intro_ramp");
  });

  it("returns hard_pause only for confirmed cold vocal intros under 3s", () => {
    expect(resolveStationLaunchHoldMode({ introDurationSec: 0 })).toBe(
      "hard_pause",
    );
    expect(resolveStationLaunchHoldMode({ introDurationSec: 2.9 })).toBe(
      "hard_pause",
    );
  });

  it("returns intro_ramp for confirmed instrumental beds of 3s or more", () => {
    expect(resolveStationLaunchHoldMode({ introDurationSec: 3 })).toBe(
      "intro_ramp",
    );
    expect(resolveStationLaunchHoldMode({ introDurationSec: 6 })).toBe(
      "intro_ramp",
    );
    expect(resolveStationLaunchHoldMode({ introDurationSec: 12 })).toBe(
      "intro_ramp",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  clampHostTuningForTier,
  paceGuidance,
  resolveStationLaunchHoldMode,
} from "../scriptGenerator";

describe("clampHostTuningForTier", () => {
  it("still forces Free listeners onto standard lore (full roots_branches stays Pro)", () => {
    const clamped = clampHostTuningForTier(
      {
        pace: "long_breaks",
        lore: "roots_branches",
        knowledge: "genius",
        allowExplicit: true,
        customDirectives: "sound like a pirate",
      },
      false,
    );
    expect(clamped.lore).toBe("standard");
    expect(clamped.pace).toBe("short_breaks");
    expect(clamped.knowledge).toBe("basic_facts");
    expect(clamped.allowExplicit).toBe(false);
    expect(clamped.customDirectives).toBe("");
  });

  it("passes Pro host tuning through unchanged", () => {
    const settings = {
      pace: "long_breaks" as const,
      lore: "roots_branches" as const,
      knowledge: "genius" as const,
      allowExplicit: true,
      customDirectives: "keep it dusty",
    };
    expect(clampHostTuningForTier(settings, true)).toEqual(settings);
  });
});

describe("paceGuidance copy cadence", () => {
  it("tells Every Song mid-session to lead with what's next", () => {
    const guidance = paceGuidance("every_song");
    expect(guidance).toContain("Lead with up next / now playing");
    expect(guidance).toContain("Do NOT default to \"You just heard\"");
    expect(guidance).toContain("First-playlist Song 1 → Song 2 pack");
  });

  it("allows You just heard / That was on Natural Pace and Long Breaks", () => {
    expect(paceGuidance("short_breaks")).toContain("You just heard");
    expect(paceGuidance("short_breaks")).toContain("That was");
    expect(paceGuidance("long_breaks")).toContain("You just heard");
    expect(paceGuidance("long_breaks")).toContain("That was");
  });
});

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

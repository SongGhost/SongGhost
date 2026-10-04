import { describe, expect, it } from "vitest";
import {
  MAX_CONSECUTIVE_UNAVAILABLE_SKIPS,
  NO_PLAYABLE_VIDEO_NOTICE,
  SKIPPING_UNAVAILABLE_NOTICE,
  UNAVAILABLE_CAP_NOTICE,
  decideUnavailableSkip,
} from "../unavailableSkip";

describe("unavailable video skip", () => {
  it("advances to the next track and keeps the station going", () => {
    const decision = decideUnavailableSkip({
      consecutiveSkips: 2,
      tracksAfterRemoval: 6,
    });
    expect(decision.advance).toBe(true);
    expect(decision.stop).toBe(false);
    expect(decision.notice).toBe(SKIPPING_UNAVAILABLE_NOTICE);
    expect(decision.consecutiveSkips).toBe(3);
  });

  it("stops with a message when the queue has nothing left to play", () => {
    const decision = decideUnavailableSkip({
      consecutiveSkips: 1,
      tracksAfterRemoval: 0,
    });
    expect(decision.advance).toBe(false);
    expect(decision.stop).toBe(true);
    expect(decision.notice).toBe(NO_PLAYABLE_VIDEO_NOTICE);
  });

  it("stops after the consecutive cap instead of looping on dead ids", () => {
    let consecutiveSkips = 0;
    for (let step = 0; step < MAX_CONSECUTIVE_UNAVAILABLE_SKIPS; step += 1) {
      const decision = decideUnavailableSkip({
        consecutiveSkips,
        tracksAfterRemoval: 4,
      });
      expect(decision.stop).toBe(false);
      expect(decision.advance).toBe(true);
      consecutiveSkips = decision.consecutiveSkips;
    }
    const capped = decideUnavailableSkip({
      consecutiveSkips,
      tracksAfterRemoval: 4,
    });
    expect(consecutiveSkips).toBe(MAX_CONSECUTIVE_UNAVAILABLE_SKIPS);
    expect(capped.advance).toBe(false);
    expect(capped.stop).toBe(true);
    expect(capped.notice).toBe(UNAVAILABLE_CAP_NOTICE);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_SKIPS_PER_HOUR,
  SKIP_WINDOW_MS,
  canSkip,
  recordSkip,
  remainingSkips,
  resetSkipLimiter,
} from "../skip-limiter";

afterEach(() => {
  resetSkipLimiter();
});

describe("skip-limiter", () => {
  it("allows 6 skips inside a 60-minute window and refuses the 7th", () => {
    const start = 1_700_000_000_000;
    for (let i = 0; i < MAX_SKIPS_PER_HOUR; i += 1) {
      expect(recordSkip(start + i * 1_000)).toBe(true);
    }
    expect(canSkip(start + 10_000)).toBe(false);
    expect(recordSkip(start + 10_000)).toBe(false);
    expect(remainingSkips(start + 10_000)).toBe(0);
  });

  it("slides the window so an hour-old skip frees a slot", () => {
    const start = 1_700_000_000_000;
    expect(recordSkip(start)).toBe(true);
    for (let i = 1; i < MAX_SKIPS_PER_HOUR; i += 1) {
      expect(recordSkip(start + i * 1_000)).toBe(true);
    }
    expect(canSkip(start + SKIP_WINDOW_MS)).toBe(true);
    expect(recordSkip(start + SKIP_WINDOW_MS)).toBe(true);
  });
});

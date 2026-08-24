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
  // Caps DEFERRED Aug 24 2026 — canSkip / recordSkip always pass; skipTimes is not mutated.
  it("always allows skip even after 6 recorded calls (caps deferred)", () => {
    const start = 1_700_000_000_000;
    for (let i = 0; i < MAX_SKIPS_PER_HOUR; i += 1) {
      expect(recordSkip(start + i * 1_000)).toBe(true);
    }
    expect(canSkip(start + 10_000)).toBe(true);
    expect(recordSkip(start + 10_000)).toBe(true);
    expect(remainingSkips(start + 10_000)).toBe(MAX_SKIPS_PER_HOUR);
  });

  it("still reports a free slot after the window would have slid (caps deferred)", () => {
    const start = 1_700_000_000_000;
    expect(recordSkip(start)).toBe(true);
    for (let i = 1; i < MAX_SKIPS_PER_HOUR; i += 1) {
      expect(recordSkip(start + i * 1_000)).toBe(true);
    }
    expect(canSkip(start + SKIP_WINDOW_MS)).toBe(true);
    expect(recordSkip(start + SKIP_WINDOW_MS)).toBe(true);
    expect(remainingSkips(start + SKIP_WINDOW_MS)).toBe(MAX_SKIPS_PER_HOUR);
  });
});

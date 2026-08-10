import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DjBreakPrefetchEngine,
  PREFETCH_LOOKAHEAD_SECONDS,
  STANDARD_BREAK_DUCK_RATIO,
  EXTENDED_BREAK_AMBIENT_FLOOR,
  prefetchedBreaksMap,
  resolveBreakTransitionPolicy,
  shouldPrefetchUpcomingBreak,
} from "../prefetchEngine";

vi.mock("@/lib/dj-intro", () => ({
  generateDjBreak: vi.fn(async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    return new Blob([bytes], { type: "audio/mpeg" });
  }),
}));

afterEach(() => {
  prefetchedBreaksMap.clear();
  vi.clearAllMocks();
});

describe("shouldPrefetchUpcomingBreak", () => {
  it("opens the warmup window at 30s remaining", () => {
    expect(
      shouldPrefetchUpcomingBreak({ positionSeconds: 100, durationSeconds: 200 }),
    ).toBe(false);
    expect(
      shouldPrefetchUpcomingBreak({
        positionSeconds: 200 - PREFETCH_LOOKAHEAD_SECONDS,
        durationSeconds: 200,
      }),
    ).toBe(true);
  });

  it("warms sub-30s tracks from the first valid position", () => {
    expect(
      shouldPrefetchUpcomingBreak({ positionSeconds: 0, durationSeconds: 12 }),
    ).toBe(true);
  });
});

describe("resolveBreakTransitionPolicy", () => {
  it("ducks standard short breaks to 25%", () => {
    const policy = resolveBreakTransitionPolicy("standard");
    expect(policy.mode).toBe("duck_over_music");
    expect(policy.duckRatio).toBe(STANDARD_BREAK_DUCK_RATIO);
    expect(policy.pauseMusic).toBe(false);
  });

  it("pauses (or ambient-ducks) extended formats", () => {
    for (const format of ["roots_branches", "time_capsule", "directors_cut"] as const) {
      const policy = resolveBreakTransitionPolicy(format);
      expect(policy.mode).toBe("pause_or_ambient");
      expect(policy.duckRatio).toBe(EXTENDED_BREAK_AMBIENT_FLOOR);
      expect(policy.pauseMusic).toBe(true);
    }
  });
});

describe("DjBreakPrefetchEngine", () => {
  it("caches a warmed break in prefetchedBreaksMap", async () => {
    const engine = new DjBreakPrefetchEngine();
    engine.setContext({ commentaryFormat: "standard" });

    const prepared = await engine.ensurePrefetch({
      trackKey: "track-a",
      title: "Hotel California",
      artist: "Eagles",
    });

    expect(prepared?.trackKey).toBe("track-a");
    expect(prefetchedBreaksMap.has("track-a")).toBe(true);
    expect(engine.take("track-a")?.script).toBeDefined();
    expect(prefetchedBreaksMap.has("track-a")).toBe(false);
  });

  it("collapses repeat ensurePrefetch calls for the same key", async () => {
    const { generateDjBreak } = await import("@/lib/dj-intro");
    const engine = new DjBreakPrefetchEngine();

    const first = engine.ensurePrefetch({
      trackKey: "track-b",
      title: "One",
      artist: "U2",
    });
    const second = engine.ensurePrefetch({
      trackKey: "track-b",
      title: "One",
      artist: "U2",
    });

    await Promise.all([first, second]);
    expect(generateDjBreak).toHaveBeenCalledTimes(1);
  });
});

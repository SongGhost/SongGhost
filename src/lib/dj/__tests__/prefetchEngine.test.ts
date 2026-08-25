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
  it("ducks standard short breaks to 18% of pre-break volume", () => {
    const policy = resolveBreakTransitionPolicy("standard");
    expect(policy.mode).toBe("duck_over_music");
    expect(policy.duckRatio).toBe(STANDARD_BREAK_DUCK_RATIO);
    expect(STANDARD_BREAK_DUCK_RATIO).toBe(0.18);
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

  it("stamps persona and voice from prefetch context", async () => {
    const engine = new DjBreakPrefetchEngine();
    engine.setContext({
      commentaryFormat: "standard",
      personaId: "warm-companion",
      voice: "echo",
    });

    const prepared = await engine.ensurePrefetch({
      trackKey: "track-devon",
      title: "Autumn Leaves",
      artist: "Bill Evans",
    });

    expect(prepared?.personaId).toBe("warm-companion");
    expect(prepared?.voiceId).toBe("echo");
  });

  it("does not report inflight TTS as a completed warmed buffer", async () => {
    const { generateDjBreak } = await import("@/lib/dj-intro");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(generateDjBreak).mockImplementationOnce(async () => {
      await gate;
      const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
      return new Blob([bytes], { type: "audio/mpeg" });
    });

    const engine = new DjBreakPrefetchEngine();
    const pending = engine.ensurePrefetch({
      trackKey: "track-inflight",
      title: "In Flight",
      artist: "Warming",
    });

    expect(engine.has("track-inflight")).toBe(false);
    expect(engine.take("track-inflight")).toBeNull();
    expect(engine.peek("track-inflight")).toBeNull();

    release();
    await pending;

    expect(engine.has("track-inflight")).toBe(true);
    expect(engine.take("track-inflight")?.audioBuffer.byteLength).toBeGreaterThan(0);
    expect(engine.has("track-inflight")).toBe(false);
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

  it("passes the live on-air previousTrack into generateDjBreak", async () => {
    const { generateDjBreak } = await import("@/lib/dj-intro");
    const engine = new DjBreakPrefetchEngine();

    await engine.ensurePrefetch(
      {
        trackKey: "track-n-plus-1",
        title: "Next Song",
        artist: "Next Artist",
      },
      { title: "On Air Now", artist: "Live Act" },
    );

    expect(generateDjBreak).toHaveBeenCalledWith(
      expect.objectContaining({
        songTitle: "Next Song",
        artistName: "Next Artist",
        previousTrack: { title: "On Air Now", artist: "Live Act" },
      }),
    );
  });
});

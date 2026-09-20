import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DjBreakPrefetchEngine,
  getPrefetchLeadSeconds,
  PREFETCH_LOOKAHEAD_SECONDS,
  STANDARD_BREAK_DUCK_RATIO,
  EXTENDED_BREAK_AMBIENT_FLOOR,
  prefetchedBreaksMap,
  resolveBreakTransitionPolicy,
  shouldPrefetchUpcomingBreak,
} from "../prefetchEngine";
import {
  PREFETCH_LEAD_SECONDS_LOCAL_DIRECTORS_CUT,
} from "../loreBudget";

import { TWO_AHEAD_DEPTH, twoAheadTargets } from "../breakPackageCache";

vi.mock("@/lib/dj-intro", () => ({
  generateDjBreak: vi.fn(async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    return new Blob([bytes], { type: "audio/mpeg" });
  }),
  generatePavlovianDjBreak: vi.fn(async () => null),
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

  it("opens local Director's Cut warmup earlier than OpenAI", () => {
    expect(getPrefetchLeadSeconds("directors_cut")).toBe(60);
    expect(getPrefetchLeadSeconds("directors_cut", "local")).toBe(
      PREFETCH_LEAD_SECONDS_LOCAL_DIRECTORS_CUT,
    );
    expect(
      shouldPrefetchUpcomingBreak(
        { positionSeconds: 200 - 90, durationSeconds: 200 },
        "directors_cut",
        "openai",
      ),
    ).toBe(false);
    expect(
      shouldPrefetchUpcomingBreak(
        { positionSeconds: 200 - 90, durationSeconds: 200 },
        "directors_cut",
        "local",
      ),
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
    expect(engine.has("track-a")).toBe(true);
    expect(engine.take("track-a")?.script).toBeDefined();
    expect(engine.has("track-a")).toBe(false);
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

  it("queues a second local synth while the GPU is busy", async () => {
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
    engine.setContext({ provider: "local", commentaryFormat: "directors_cut" });
    const first = engine.ensurePrefetch({
      trackKey: "track-busy-a",
      title: "A",
      artist: "One",
    });
    const queued = engine.ensurePrefetch({
      trackKey: "track-busy-b",
      title: "B",
      artist: "Two",
    });

    expect(generateDjBreak).toHaveBeenCalledTimes(1);
    release();
    await first;
    await queued;
    expect(generateDjBreak).toHaveBeenCalledTimes(2);
    expect(engine.has("track-busy-b")).toBe(true);
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

  it("invalidates cached packages when the settings fingerprint changes", async () => {
    const engine = new DjBreakPrefetchEngine();
    engine.setContext({
      commentaryFormat: "standard",
      personaId: "warm-companion",
      voice: "echo",
      vibePrompt: "late night",
    });
    await engine.ensurePrefetch({
      trackKey: "track-fp",
      title: "Fingerprint",
      artist: "Test",
    });
    expect(engine.has("track-fp")).toBe(true);

    engine.setContext({
      commentaryFormat: "standard",
      personaId: "warm-companion",
      voice: "echo",
      vibePrompt: "morning drive",
    });
    expect(engine.has("track-fp")).toBe(false);
    expect(engine.take("track-fp")).toBeNull();
  });

  it("targets two upcoming tracks from song start without waiting for the lead window", async () => {
    const { generateDjBreak } = await import("@/lib/dj-intro");
    const engine = new DjBreakPrefetchEngine();
    engine.setContext({ provider: "openai", commentaryFormat: "standard" });

    const queue = [
      { trackKey: "n", title: "Now", artist: "On Air" },
      { trackKey: "n1", title: "Next", artist: "One" },
      { trackKey: "n2", title: "Later", artist: "Two" },
      { trackKey: "n3", title: "After", artist: "Three" },
    ];
    const targets = twoAheadTargets(queue, 0);
    expect(targets).toHaveLength(TWO_AHEAD_DEPTH);

    engine.ensureTwoAhead(targets);
    await Promise.all([
      engine.ensurePrefetch(targets[0]!),
      engine.ensurePrefetch(targets[1]!),
    ]);
    expect(engine.has("n1")).toBe(true);
    expect(engine.has("n2")).toBe(true);
    expect(engine.has("n3")).toBe(false);
    expect(generateDjBreak).toHaveBeenCalledTimes(2);
    expect(generateDjBreak).toHaveBeenCalledWith(
      expect.objectContaining({
        songTitle: "Next",
        previousTrack: { title: "Now", artist: "On Air" },
      }),
    );
    expect(generateDjBreak).toHaveBeenCalledWith(
      expect.objectContaining({
        songTitle: "Later",
        previousTrack: { title: "Next", artist: "One" },
      }),
    );
  });
});

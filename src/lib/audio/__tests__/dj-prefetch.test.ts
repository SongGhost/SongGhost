import { describe, expect, it, vi } from "vitest";
import { createDjSchedulerState } from "@/lib/dj/scheduler";
import type { DjSegmentPlan } from "@/types/dj";
import {
  DjPrefetchController,
  LOOKAHEAD_SECONDS,
  shouldStartLookahead,
  type PreparedDjBreak,
} from "../dj-prefetch";

const SEGMENT_PLAN: DjSegmentPlan = {
  kind: "song_intro",
  transition: "full_break",
  announceTracks: [{ title: "Hotel California", artist: "Eagles" }],
  maxDurationSeconds: 6,
};

function voicedBreak(audioBlob: Blob = {} as Blob): PreparedDjBreak {
  return {
    transition: "full_break",
    plan: SEGMENT_PLAN,
    nextState: { ...createDjSchedulerState(), voicedBreakCount: 1 },
    audioBlob,
  };
}

function silentBreak(): PreparedDjBreak {
  return {
    transition: "silent",
    plan: null,
    nextState: { ...createDjSchedulerState(), tracksSinceLastBreak: 1 },
  };
}

function createController(preloadGate?: Promise<void>) {
  const preloaded: Blob[] = [];
  const discarded: Blob[] = [];

  const controller = new DjPrefetchController({
    preload: async (blob) => {
      preloaded.push(blob);
      if (preloadGate) await preloadGate;
    },
    discardPreload: () => {
      discarded.push(preloaded[preloaded.length - 1]);
    },
  });

  return { controller, preloaded, discarded };
}

/** A promise the test resolves by hand, for holding a decode open. */
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Lets a started lookahead run its planning and decode microtasks to completion. */
function flush() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("shouldStartLookahead", () => {
  it("waits until the outgoing track is inside the warming window", () => {
    expect(shouldStartLookahead({ position: 100, duration: 200 })).toBe(false);
    expect(shouldStartLookahead({ position: 200 - LOOKAHEAD_SECONDS, duration: 200 })).toBe(true);
  });

  it("holds off while the provider still reports no duration", () => {
    expect(shouldStartLookahead({ position: 0, duration: 0 })).toBe(false);
    expect(shouldStartLookahead({ position: 0, duration: Number.NaN })).toBe(false);
  });

  it("warms a track shorter than the window from its first position report", () => {
    // A 12s track never has 20s remaining, so waiting for the window would
    // leave it with no break at all.
    expect(shouldStartLookahead({ position: 0, duration: 12 })).toBe(true);
  });

  it("ignores a position the provider has not settled yet", () => {
    expect(shouldStartLookahead({ position: Number.NaN, duration: 200 })).toBe(false);
    expect(shouldStartLookahead({ position: -1, duration: 200 })).toBe(false);
  });
});

describe("DjPrefetchController warming", () => {
  it("collapses repeat calls while a track is already being warmed", async () => {
    const { controller } = createController();
    const task = vi.fn(async () => voicedBreak());

    controller.start("track-b", task);
    controller.start("track-b", task);
    controller.start("track-b", task);
    await flush();

    expect(task).toHaveBeenCalledTimes(1);
  });

  it("hands the warmed break to the track it was planned for", async () => {
    const { controller } = createController();
    const blob = {} as Blob;

    controller.start("track-b", async () => voicedBreak(blob));
    await flush();

    const claimed = await controller.take("track-b");
    expect(claimed?.audioBlob).toBe(blob);
    expect(claimed?.plan).toBe(SEGMENT_PLAN);
    expect(controller.targetKey).toBeNull();
  });

  it("declines a break planned for a different track", async () => {
    const { controller } = createController();

    controller.start("track-b", async () => voicedBreak());
    await flush();

    expect(controller.take("track-z")).toBeNull();
    // The slot survives so the track it was planned for can still claim it.
    expect(controller.targetKey).toBe("track-b");
  });

  it("decodes the clip so the break opens without a buffering gap", async () => {
    const { controller, preloaded } = createController();
    const blob = {} as Blob;

    controller.start("track-b", async () => voicedBreak(blob));
    await flush();

    expect(preloaded).toEqual([blob]);
  });

  it("reserves a silent decision without synthesizing anything", async () => {
    const { controller, preloaded } = createController();

    controller.start("track-b", async () => silentBreak());
    await flush();

    const claimed = await controller.take("track-b");
    expect(claimed?.transition).toBe("silent");
    // The decision still has to be carried, or the pacing count for this
    // transition would be rolled twice.
    expect(claimed?.nextState.tracksSinceLastBreak).toBe(1);
    expect(preloaded).toEqual([]);
  });

  it("keeps the transition playable when the lookahead fails", async () => {
    const { controller } = createController();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    controller.start("track-b", async () => {
      throw new Error("tts unavailable");
    });
    await flush();

    await expect(controller.take("track-b")).resolves.toBeNull();
    warn.mockRestore();
  });

  it("abandons a lookahead whose target left the queue mid-flight", async () => {
    const { controller } = createController();

    controller.start("track-b", async () => null);
    await flush();

    await expect(controller.take("track-b")).resolves.toBeNull();
  });
});

describe("DjPrefetchController invalidation", () => {
  it("supersedes a warm-up when the lookahead retargets", async () => {
    const { controller } = createController();
    let firstSignal: AbortSignal | undefined;

    controller.start("track-b", async (signal) => {
      firstSignal = signal;
      return voicedBreak();
    });
    controller.start("track-c", async () => voicedBreak());

    expect(firstSignal?.aborted).toBe(true);
    expect(controller.targetKey).toBe("track-c");
  });

  it("keeps a break that is still on air or up next", async () => {
    const { controller, discarded } = createController();

    controller.start("track-b", async () => voicedBreak());
    await flush();

    controller.retain(["track-a", "track-b"]);

    expect(controller.targetKey).toBe("track-b");
    expect(discarded).toEqual([]);
  });

  it("drops a break the queue has moved past and releases its clip", async () => {
    const { controller, discarded } = createController();

    controller.start("track-b", async () => voicedBreak());
    await flush();

    // A reorder put a different track up next, so the warmed break can never play.
    controller.retain(["track-a", "track-x"]);

    expect(controller.targetKey).toBeNull();
    expect(discarded).toHaveLength(1);
  });

  it("tolerates an unknown upcoming slot", async () => {
    const { controller } = createController();

    controller.start("track-b", async () => voicedBreak());
    await flush();
    controller.retain([undefined, undefined]);

    expect(controller.targetKey).toBeNull();
  });

  it("aborts an in-flight request when the station changes", () => {
    const { controller } = createController();
    let signal: AbortSignal | undefined;

    controller.start("track-b", async (captured) => {
      signal = captured;
      return voicedBreak();
    });
    controller.clear();

    expect(signal?.aborted).toBe(true);
    expect(controller.targetKey).toBeNull();
  });

  it("releases a clip that finished decoding after its lookahead was abandoned", async () => {
    const decode = deferred();
    const { controller, discarded, preloaded } = createController(decode.promise);

    controller.start("track-b", async () => voicedBreak());
    await flush();
    expect(preloaded).toHaveLength(1);

    // Abandoned while the clip was still decoding, so the drop itself has
    // nothing to release yet — the decode lands in a node with no transition
    // left to play it.
    controller.clear();
    expect(discarded).toEqual([]);

    decode.resolve();
    await flush();

    expect(discarded).toEqual(preloaded);
  });

  it("warms nothing to release when abandoned before synthesis finishes", async () => {
    const { controller, discarded, preloaded } = createController();

    controller.start("track-b", async () => voicedBreak());
    controller.clear();
    await flush();

    expect(preloaded).toEqual([]);
    expect(discarded).toEqual([]);
  });

  it("leaves a claimed break alone when the lookahead is later cleared", async () => {
    const { controller, discarded } = createController();

    controller.start("track-b", async () => voicedBreak());
    await flush();
    await controller.take("track-b");
    controller.clear();

    // The clip belongs to the break now playing; clearing must not pull it.
    expect(discarded).toEqual([]);
  });
});

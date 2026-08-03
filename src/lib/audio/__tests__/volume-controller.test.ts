import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVolumeController } from "../volume-controller";

type Frame = (now: number) => void;

const frames = new Map<number, Frame>();
let nextFrameId = 1;

/**
 * Drives `rampVolume`'s animation frames by hand. The node test environment has
 * no rAF, and a real one would make ramp assertions depend on wall-clock timing.
 */
function installFrameClock() {
  frames.clear();
  nextFrameId = 1;
  vi.stubGlobal("requestAnimationFrame", (cb: Frame) => {
    const id = nextFrameId++;
    frames.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });
}

function advanceFrame(now: number) {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((frame) => frame(now));
}

function createProbe(initial = 1) {
  let level = initial;
  const writes: number[] = [];
  return {
    writes,
    get level() {
      return level;
    },
    source: {
      getVolume: () => level,
      setVolume: (next: number) => {
        level = next;
        writes.push(next);
      },
    },
  };
}

beforeEach(() => {
  installFrameClock();
  vi.spyOn(performance, "now").mockReturnValue(0);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createVolumeController", () => {
  it("clamps reads and writes into 0–1", () => {
    const probe = createProbe();
    const bus = createVolumeController(probe.source);

    bus.setVolume(1.6);
    expect(probe.level).toBe(1);

    bus.setVolume(-0.4);
    expect(probe.level).toBe(0);

    bus.setVolume(Number.NaN);
    expect(bus.getVolume()).toBe(0);
  });

  it("treats a zero-length ramp as a jump so the level lands this tick", () => {
    const probe = createProbe();
    const bus = createVolumeController(probe.source);

    bus.rampVolume(1, 0.25, 0);

    expect(probe.level).toBe(0.25);
    expect(frames.size).toBe(0);
  });

  it("anchors the ramp at its start level before the first frame", () => {
    const probe = createProbe();
    const bus = createVolumeController(probe.source);

    bus.rampVolume(1, 0.25, 300);

    expect(probe.level).toBe(1);
  });

  it("interpolates toward the target across frames", () => {
    const probe = createProbe();
    const bus = createVolumeController(probe.source);

    bus.rampVolume(1, 0.25, 400);
    advanceFrame(200);
    expect(probe.level).toBeCloseTo(0.625);

    advanceFrame(400);
    expect(probe.level).toBeCloseTo(0.25);
  });

  it("lets a direct set cancel the ramp it interrupts", () => {
    const probe = createProbe();
    const bus = createVolumeController(probe.source);

    bus.rampVolume(1, 0.25, 400);
    bus.setVolume(1);
    advanceFrame(200);

    // The cancelled ramp must not drag the level back down behind the set.
    expect(probe.level).toBe(1);
  });

  it("lets a new ramp cancel the one already running", () => {
    const probe = createProbe();
    const bus = createVolumeController(probe.source);

    bus.rampVolume(1, 0.25, 400);
    bus.rampVolume(0.25, 1, 400);
    advanceFrame(200);

    expect(probe.level).toBeCloseTo(0.625);
    expect(frames.size).toBe(1);
  });

  it("stops writing once its returned cancel is called", () => {
    const probe = createProbe();
    const bus = createVolumeController(probe.source);

    const cancel = bus.rampVolume(1, 0.25, 400);
    cancel();
    const writesAtCancel = probe.writes.length;
    advanceFrame(200);

    expect(probe.writes).toHaveLength(writesAtCancel);
  });
});

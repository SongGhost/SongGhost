import { describe, expect, it } from "vitest";
import { clampWebAudioGain, VOICE_HEADROOM_BOOST } from "../mix-bus";
import {
  attachVoiceOutputGraph,
  liveVoiceGain,
  VOICE_LIMITER_ATTACK_SEC,
  VOICE_LIMITER_KNEE_DB,
  VOICE_LIMITER_RATIO,
  VOICE_LIMITER_RELEASE_SEC,
  VOICE_LIMITER_THRESHOLD_DB,
} from "../voice-output-graph";

class FakeParam {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
  cancelScheduledValues(_time: number) {}
  setTargetAtTime(value: number, _start: number, _constant: number) {
    this.value = value;
  }
  setValueAtTime(value: number, _time: number) {
    this.value = value;
  }
  linearRampToValueAtTime(value: number, _time: number) {
    this.value = value;
  }
}

class FakeNode {
  readonly outputs: FakeNode[] = [];
  disconnects = 0;

  connect(target: FakeNode) {
    this.outputs.push(target);
    return target;
  }

  disconnect() {
    this.disconnects += 1;
    this.outputs.length = 0;
  }

  isConnectedTo(target: FakeNode): boolean {
    return this.outputs.includes(target);
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

class FakeCompressor extends FakeNode {
  threshold = new FakeParam(0);
  knee = new FakeParam(0);
  ratio = new FakeParam(0);
  attack = new FakeParam(0);
  release = new FakeParam(0);
}

class FakeAudioContext {
  readonly destination = new FakeNode();
  readonly sampleRate = 48000;
  state: AudioContextState = "running";
  currentTime = 0;
  readonly captured = new Set<unknown>();
  readonly sources: FakeNode[] = [];
  readonly gains: FakeGain[] = [];
  readonly compressors: FakeCompressor[] = [];

  createMediaElementSource(element: unknown) {
    if (this.captured.has(element)) {
      throw new Error("HTMLMediaElement already connected to a source node");
    }
    this.captured.add(element);
    const source = new FakeNode();
    this.sources.push(source);
    return source;
  }

  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  createDynamicsCompressor() {
    const compressor = new FakeCompressor();
    this.compressors.push(compressor);
    return compressor;
  }
}

describe("liveVoiceGain", () => {
  it("lets master × dj% × 1.35 exceed 1.0", () => {
    expect(liveVoiceGain(1, 1)).toBeCloseTo(VOICE_HEADROOM_BOOST);
    expect(liveVoiceGain(1, 1)).toBeGreaterThan(1);
    expect(liveVoiceGain(1, 0.85)).toBeCloseTo(0.85 * VOICE_HEADROOM_BOOST);
    expect(liveVoiceGain(1, 1)).toBeGreaterThan(liveVoiceGain(1, 0.85));
    expect(liveVoiceGain(1, 0.85)).toBeGreaterThan(liveVoiceGain(1, 0.5));
  });

  it("still mutes with the master fader or a zero DJ slider", () => {
    expect(liveVoiceGain(0, 1)).toBe(0);
    expect(liveVoiceGain(1, 0)).toBe(0);
  });

  it("does not exceed VOICE_HEADROOM_BOOST", () => {
    expect(liveVoiceGain(4, 1)).toBe(VOICE_HEADROOM_BOOST);
    expect(clampWebAudioGain(2)).toBe(VOICE_HEADROOM_BOOST);
  });
});

describe("attachVoiceOutputGraph", () => {
  it("wires MediaElementSource → GainNode → limiter → destination", () => {
    const ctx = new FakeAudioContext();
    const element = { volume: 0.4, muted: true } as unknown as HTMLMediaElement;

    const graph = attachVoiceOutputGraph(
      element,
      1.35,
      ctx as unknown as AudioContext,
    );

    expect(graph).not.toBeNull();
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.gains).toHaveLength(1);
    expect(ctx.compressors).toHaveLength(1);
    expect(ctx.sources[0].isConnectedTo(ctx.gains[0])).toBe(true);
    expect(ctx.gains[0].isConnectedTo(ctx.compressors[0])).toBe(true);
    expect(ctx.compressors[0].isConnectedTo(ctx.destination)).toBe(true);
    expect(ctx.gains[0].gain.value).toBeCloseTo(1.35);
    expect(element.volume).toBe(1);
    expect(element.muted).toBe(false);
  });

  it("configures a gentle brick-wall limiter", () => {
    const ctx = new FakeAudioContext();
    const graph = attachVoiceOutputGraph(
      {} as HTMLMediaElement,
      1,
      ctx as unknown as AudioContext,
    );

    expect(graph).not.toBeNull();
    const limiter = ctx.compressors[0];
    expect(limiter.threshold.value).toBe(VOICE_LIMITER_THRESHOLD_DB);
    expect(limiter.knee.value).toBe(VOICE_LIMITER_KNEE_DB);
    expect(limiter.ratio.value).toBe(VOICE_LIMITER_RATIO);
    expect(limiter.attack.value).toBe(VOICE_LIMITER_ATTACK_SEC);
    expect(limiter.release.value).toBe(VOICE_LIMITER_RELEASE_SEC);
    expect(VOICE_LIMITER_THRESHOLD_DB).toBe(-1);
    expect(VOICE_LIMITER_RATIO).toBeGreaterThanOrEqual(20);
  });

  it("updates the GainNode live without touching element.volume", () => {
    const ctx = new FakeAudioContext();
    const element = { volume: 1, muted: false } as unknown as HTMLMediaElement;
    const graph = attachVoiceOutputGraph(
      element,
      1.1475,
      ctx as unknown as AudioContext,
    );

    graph!.setGain(1.35);
    expect(ctx.gains[0].gain.value).toBeCloseTo(1.35);
    expect(element.volume).toBe(1);
  });

  it("refuses a suspended context so the element is not captured into silence", () => {
    const ctx = new FakeAudioContext();
    ctx.state = "suspended";
    const element = { volume: 0.85, muted: false } as unknown as HTMLMediaElement;

    const graph = attachVoiceOutputGraph(
      element,
      1.35,
      ctx as unknown as AudioContext,
    );

    expect(graph).toBeNull();
    expect(ctx.captured.size).toBe(0);
    expect(element.volume).toBe(0.85);
  });
});

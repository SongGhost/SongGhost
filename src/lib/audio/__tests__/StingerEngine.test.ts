import { describe, expect, it, vi } from "vitest";
import { DUCK_RATIO, musicGain, SFX_TRIM, sfxGain } from "../mix-bus";
import { renderStinger, SFX_ENABLED, StingerEngine, STINGER_IDS } from "../StingerEngine";

/**
 * Assertions about what a trigger puts on the audio graph. They have nothing to
 * observe while `SFX_ENABLED` is false, so they are skipped rather than deleted:
 * turning the kit back on has to restore the engine's coverage in full, not
 * leave the playback path untested.
 */
const itPlays = it.skipIf(!SFX_ENABLED);

/** The bypass itself, which only means something while the kit is off. */
const describeBypass = describe.skipIf(SFX_ENABLED);

class FakeAudioBuffer {
  private readonly channels: Float32Array[];

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel];
  }
}

class FakeGainNode {
  gain = { value: 1 };
  connectedTo: unknown[] = [];
  disconnectCalls = 0;

  connect(target: unknown) {
    this.connectedTo.push(target);
    return target;
  }

  disconnect() {
    this.disconnectCalls += 1;
  }
}

class FakeBufferSource {
  buffer: FakeAudioBuffer | null = null;
  onended: (() => void) | null = null;
  output: unknown = null;
  startCalls = 0;
  stopCalls = 0;
  disconnectCalls = 0;

  connect(target: unknown) {
    this.output = target;
    return target;
  }

  disconnect() {
    this.disconnectCalls += 1;
  }

  start() {
    this.startCalls += 1;
  }

  stop() {
    this.stopCalls += 1;
  }

  /** Drives the `ended` event a real graph would fire when the clip runs out. */
  finish() {
    this.onended?.();
  }
}

class FakeAudioContext {
  state: AudioContextState = "running";
  sampleRate = 48000;
  currentTime = 0;
  destination = { label: "destination" };

  readonly buffers: FakeAudioBuffer[] = [];
  readonly gains: FakeGainNode[] = [];
  readonly sources: FakeBufferSource[] = [];

  resume = vi.fn(async () => {
    this.state = "running";
  });

  close = vi.fn(async () => {
    this.state = "closed";
  });

  createBuffer(channels: number, length: number, sampleRate: number) {
    const buffer = new FakeAudioBuffer(channels, length, sampleRate);
    this.buffers.push(buffer);
    return buffer;
  }

  createGain() {
    const gain = new FakeGainNode();
    this.gains.push(gain);
    return gain;
  }

  createBufferSource() {
    const source = new FakeBufferSource();
    this.sources.push(source);
    return source;
  }
}

function createEngine(context = new FakeAudioContext()) {
  const engine = new StingerEngine({
    createContext: () => context as unknown as AudioContext,
  });
  return { engine, context };
}

/** An unlocked engine: what the app has from the first play gesture onward. */
function createUnlockedEngine(context = new FakeAudioContext()) {
  const built = createEngine(context);
  built.engine.unlock();
  return built;
}

function samplesOf(buffer: FakeAudioBuffer): Float32Array {
  return buffer.getChannelData(0);
}

function peakOf(buffer: FakeAudioBuffer): number {
  return samplesOf(buffer).reduce((loudest, sample) => Math.max(loudest, Math.abs(sample)), 0);
}

function zeroCrossingsOf(buffer: FakeAudioBuffer): number {
  const samples = samplesOf(buffer);
  let crossings = 0;
  for (let i = 1; i < samples.length; i += 1) {
    if (Math.sign(samples[i]) !== Math.sign(samples[i - 1])) crossings += 1;
  }
  return crossings;
}

describe("procedural synthesis", () => {
  it("renders every effect in the kit without needing a static asset", () => {
    const context = new FakeAudioContext();

    STINGER_IDS.forEach((id) => {
      const buffer = renderStinger(
        context as unknown as BaseAudioContext,
        id,
      ) as unknown as FakeAudioBuffer;

      expect(buffer.numberOfChannels).toBe(1);
      expect(buffer.sampleRate).toBe(context.sampleRate);
      expect(buffer.length).toBeGreaterThan(0);
      expect(samplesOf(buffer).every(Number.isFinite)).toBe(true);
    });
  });

  it("normalizes each effect to the same peak so one bus trim fits all three", () => {
    const context = new FakeAudioContext();

    STINGER_IDS.forEach((id) => {
      const buffer = renderStinger(
        context as unknown as BaseAudioContext,
        id,
      ) as unknown as FakeAudioBuffer;

      expect(peakOf(buffer)).toBeCloseTo(0.9, 5);
    });
  });

  it("follows the context's sample rate rather than assuming one", () => {
    const context = new FakeAudioContext();
    context.sampleRate = 22050;

    const buffer = renderStinger(
      context as unknown as BaseAudioContext,
      "station_chime",
    ) as unknown as FakeAudioBuffer;

    expect(buffer.sampleRate).toBe(22050);
    expect(buffer.duration).toBeCloseTo(1.1, 3);
  });

  it("gives the three effects distinct lengths and content", () => {
    const context = new FakeAudioContext();
    const rendered = STINGER_IDS.map(
      (id) => renderStinger(context as unknown as BaseAudioContext, id) as unknown as FakeAudioBuffer,
    );

    const lengths = new Set(rendered.map((buffer) => buffer.length));
    expect(lengths.size).toBe(STINGER_IDS.length);

    // A shared renderer would have produced identical heads across the kit.
    expect(samplesOf(rendered[0])[1000]).not.toBeCloseTo(samplesOf(rendered[1])[1000], 6);
  });

  it("renders the scratch as noise and the chime as a tone", () => {
    const context = new FakeAudioContext();
    const scratch = renderStinger(
      context as unknown as BaseAudioContext,
      "vinyl_scratch",
    ) as unknown as FakeAudioBuffer;
    const chime = renderStinger(
      context as unknown as BaseAudioContext,
      "station_chime",
    ) as unknown as FakeAudioBuffer;

    // Per-sample crossing rate: broadband noise flips sign far more often than a
    // pitched partial stack, which is the difference between the two by ear too.
    expect(zeroCrossingsOf(scratch) / scratch.length).toBeGreaterThan(
      (zeroCrossingsOf(chime) / chime.length) * 4,
    );
  });

  it("opens and closes every effect near silence so a transition cannot click", () => {
    const context = new FakeAudioContext();

    STINGER_IDS.forEach((id) => {
      const buffer = renderStinger(
        context as unknown as BaseAudioContext,
        id,
      ) as unknown as FakeAudioBuffer;
      const samples = samplesOf(buffer);

      expect(Math.abs(samples[0])).toBeLessThan(0.05);
      expect(Math.abs(samples[samples.length - 1])).toBeLessThan(0.05);
    });
  });

  it("renders deterministically, so the kit sounds the same every session", () => {
    const first = renderStinger(
      new FakeAudioContext() as unknown as BaseAudioContext,
      "vinyl_scratch",
    ) as unknown as FakeAudioBuffer;
    const second = renderStinger(
      new FakeAudioContext() as unknown as BaseAudioContext,
      "vinyl_scratch",
    ) as unknown as FakeAudioBuffer;

    expect([...samplesOf(second)]).toEqual([...samplesOf(first)]);
  });
});

describe("StingerEngine buffer re-use", () => {
  it("renders the kit up front so the first transition plays from cache", () => {
    const { context } = createUnlockedEngine();

    expect(context.buffers).toHaveLength(STINGER_IDS.length);
  });

  itPlays("decodes each effect once and replays it across transitions", () => {
    const { engine, context } = createUnlockedEngine();
    const buffersAfterUnlock = context.buffers.length;

    engine.playVinylScratch();
    context.sources[0].finish();
    engine.playVinylScratch();
    context.sources[1].finish();
    engine.playVinylScratch();

    // Three transitions, three source nodes, no additional render work.
    expect(context.sources).toHaveLength(3);
    expect(context.buffers).toHaveLength(buffersAfterUnlock);
    expect(context.sources.every((source) => source.buffer === context.buffers[0])).toBe(true);
  });

  itPlays("renders on demand for an engine that was never explicitly prepared", () => {
    const context = new FakeAudioContext();
    const { engine } = createEngine(context);

    engine.playStationChime();

    expect(context.buffers).toHaveLength(1);
    expect(context.sources[0].startCalls).toBe(1);
  });

  itPlays("gives each effect its own buffer", () => {
    const { engine, context } = createUnlockedEngine();

    engine.playVinylScratch();
    engine.playFrequencySweep();
    engine.playStationChime();

    const played = new Set(context.sources.map((source) => source.buffer));
    expect(played.size).toBe(3);
  });
});

describe("StingerEngine gain staging", () => {
  itPlays("routes every effect through one bus into the destination", () => {
    const { engine, context } = createUnlockedEngine();

    engine.playFrequencySweep();

    expect(context.gains).toHaveLength(1);
    expect(context.gains[0].connectedTo).toEqual([context.destination]);
    expect(context.sources[0].output).toBe(context.gains[0]);
  });

  it("opens the bus at the SFX level for the current master", () => {
    const { engine, context } = createUnlockedEngine();

    engine.setMasterVolume(0.5);

    expect(context.gains[0].gain.value).toBeCloseTo(sfxGain(0.5));
    expect(context.gains[0].gain.value).toBeCloseTo(0.5 * SFX_TRIM);
  });

  itPlays("carries a master set before the bus existed onto it", () => {
    const context = new FakeAudioContext();
    const { engine } = createEngine(context);

    engine.setMasterVolume(0.4);
    engine.playVinylScratch();

    expect(context.gains[0].gain.value).toBeCloseTo(sfxGain(0.4));
  });

  itPlays("pushes a fader move onto an effect already ringing", () => {
    const { engine, context } = createUnlockedEngine();

    engine.playVinylScratch();
    engine.setMasterVolume(0.2);

    expect(context.gains[0].gain.value).toBeCloseTo(sfxGain(0.2));
  });

  it("still mutes with the master fader", () => {
    const { engine, context } = createUnlockedEngine();

    engine.setMasterVolume(0);

    expect(context.gains[0].gain.value).toBe(0);
    expect(engine.getMasterVolume()).toBe(0);
  });

  it("clamps an out-of-range master", () => {
    const { engine } = createUnlockedEngine();

    engine.setMasterVolume(4);
    expect(engine.getMasterVolume()).toBe(1);

    engine.setMasterVolume(-2);
    expect(engine.getMasterVolume()).toBe(0);

    engine.setMasterVolume(Number.NaN);
    expect(engine.getMasterVolume()).toBe(0);
  });

  it("takes no duck gain, so the break-exit scratch is not buried by the break", () => {
    // A single argument is the whole signature: there is no seam through which a
    // caller could route DUCK_RATIO into the SFX channel.
    expect(sfxGain.length).toBe(1);

    for (const master of [0.1, 0.25, 0.5, 0.75, 1]) {
      expect(sfxGain(master)).toBeGreaterThan(musicGain(master, DUCK_RATIO));
    }
  });

  it("keeps effects under the music they punctuate", () => {
    expect(SFX_TRIM).toBeLessThan(1);
    expect(sfxGain(1)).toBeLessThan(musicGain(1));
  });
});

describe("StingerEngine voice lifecycle", () => {
  itPlays("cuts the identical effect it re-triggers instead of stacking copies", () => {
    const { engine, context } = createUnlockedEngine();

    engine.playFrequencySweep();
    engine.playFrequencySweep();

    // A spammed skip must stay one sweep: two overlaid copies of the same buffer
    // comb against each other and land at double level.
    expect(context.sources[0].stopCalls).toBe(1);
    expect(context.sources[0].disconnectCalls).toBeGreaterThan(0);
    expect(context.sources[1].stopCalls).toBe(0);
    expect(context.sources[1].startCalls).toBe(1);
  });

  itPlays("lets different effects overlap", () => {
    const { engine, context } = createUnlockedEngine();

    engine.playVinylScratch();
    engine.playFrequencySweep();

    // A scratch closing a break and a sweep from a skip are separate gestures.
    expect(context.sources[0].stopCalls).toBe(0);
    expect(context.sources[1].stopCalls).toBe(0);
  });

  itPlays("releases a source once its effect has rung out", () => {
    const { engine, context } = createUnlockedEngine();

    engine.playVinylScratch();
    context.sources[0].finish();

    expect(context.sources[0].disconnectCalls).toBe(1);

    // The finished source is already gone, so the next trigger has nothing to cut.
    engine.playVinylScratch();
    expect(context.sources[0].stopCalls).toBe(0);
    expect(context.sources[1].startCalls).toBe(1);
  });

  itPlays("tears the bus down and stops answering once destroyed", () => {
    const { engine, context } = createUnlockedEngine();

    engine.playVinylScratch();
    engine.destroy();

    expect(context.sources[0].stopCalls).toBe(1);
    expect(context.gains[0].disconnectCalls).toBe(1);
    expect(context.close).toHaveBeenCalledTimes(1);

    engine.playFrequencySweep();
    expect(context.sources).toHaveLength(1);
  });

  it("is safe to destroy twice", () => {
    const { engine, context } = createUnlockedEngine();

    engine.destroy();
    engine.destroy();

    expect(context.close).toHaveBeenCalledTimes(1);
  });
});

describe("StingerEngine context availability", () => {
  itPlays("drops an effect queued before the first gesture", () => {
    const context = new FakeAudioContext();
    context.state = "suspended";
    const { engine } = createEngine(context);

    engine.playFrequencySweep();

    // Starting a source on a sleeping context would fire the sweep whenever the
    // context eventually wakes — under a track it has nothing to do with.
    expect(context.sources).toHaveLength(0);
    expect(context.resume).toHaveBeenCalled();
  });

  itPlays("plays through a resume still in flight once unlocked", () => {
    const context = new FakeAudioContext();
    context.state = "suspended";
    const { engine } = createEngine(context);

    // `unlock` requests the resume; the state flip lands a microtask later, and
    // the launch sweep fires in between.
    context.resume.mockImplementation(async () => {});
    engine.unlock();
    engine.playFrequencySweep();

    expect(context.sources).toHaveLength(1);
    expect(context.sources[0].startCalls).toBe(1);
  });

  itPlays("no-ops on a closed context", () => {
    const { engine, context } = createUnlockedEngine();
    context.state = "closed";

    engine.playVinylScratch();

    expect(context.sources).toHaveLength(0);
  });

  it("stays silent where there is no Web Audio at all", () => {
    const engine = new StingerEngine({ createContext: () => null });

    expect(() => {
      engine.unlock();
      engine.playVinylScratch();
      engine.playFrequencySweep();
      engine.playStationChime();
      engine.setMasterVolume(0.5);
      engine.destroy();
    }).not.toThrow();
  });

  itPlays("gives up on a context factory that throws instead of retrying per effect", () => {
    const createContext = vi.fn(() => {
      throw new Error("AudioContext blocked");
    });
    const engine = new StingerEngine({ createContext });

    engine.playVinylScratch();
    engine.playFrequencySweep();
    engine.playStationChime();

    expect(createContext).toHaveBeenCalledTimes(1);
  });

  itPlays("survives a graph that refuses to build a source", () => {
    const context = new FakeAudioContext();
    const { engine } = createEngine(context);
    vi.spyOn(context, "createBufferSource").mockImplementation(() => {
      throw new Error("too many nodes");
    });

    expect(() => engine.playVinylScratch()).not.toThrow();
  });
});

describeBypass("SFX master bypass", () => {
  it("puts nothing on the graph for any effect", () => {
    const { engine, context } = createUnlockedEngine();

    engine.playVinylScratch();
    engine.playFrequencySweep();
    engine.playStationChime();

    expect(context.sources).toHaveLength(0);
  });

  it("returns before the engine reaches for a context at all", () => {
    const createContext = vi.fn(() => new FakeAudioContext() as unknown as AudioContext);
    const engine = new StingerEngine({ createContext });

    engine.playVinylScratch();
    engine.playFrequencySweep();
    engine.playStationChime();

    // A bypassed trigger costs a comparison: no hardware context, no render.
    expect(createContext).not.toHaveBeenCalled();
  });

  it("leaves the kit rendered and the fader live, ready for the flag to flip", () => {
    const { engine, context } = createUnlockedEngine();

    engine.setMasterVolume(0.3);

    expect(context.buffers).toHaveLength(STINGER_IDS.length);
    expect(engine.getMasterVolume()).toBe(0.3);
    expect(context.gains[0].gain.value).toBeCloseTo(sfxGain(0.3));
  });
});

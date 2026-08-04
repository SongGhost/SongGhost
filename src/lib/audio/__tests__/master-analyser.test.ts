import { describe, expect, it } from "vitest";
import {
  ANALYSER_FFT_SIZE,
  ANALYSER_SMOOTHING,
  getMasterAnalyser,
  MasterAnalyser,
  resetMasterAnalyser,
  UNDUCKED_GAIN,
} from "../mix-bus";

// ---- Fake Web Audio graph ---------------------------------------------------

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
  gain = { value: 0 };
}

class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
  /** What the next read hands back, per byte of the buffer. */
  level = 0;
  frequencyReads = 0;
  timeDomainReads = 0;

  get frequencyBinCount() {
    return this.fftSize / 2;
  }

  getByteFrequencyData(target: Uint8Array) {
    this.frequencyReads += 1;
    target.fill(this.level);
  }

  getByteTimeDomainData(target: Uint8Array) {
    this.timeDomainReads += 1;
    target.fill(this.level);
  }
}

class FakeAudioContext {
  readonly destination = new FakeNode();
  readonly sampleRate = 48000;
  state: AudioContextState = "running";
  closed = false;
  resumeCalls = 0;

  readonly gains: FakeGain[] = [];
  readonly analysers: FakeAnalyser[] = [];
  readonly sources: FakeNode[] = [];
  /** Mirrors the browser rule that one element gets one source node. */
  readonly captured = new Set<unknown>();

  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  createAnalyser() {
    const analyser = new FakeAnalyser();
    this.analysers.push(analyser);
    return analyser;
  }

  createMediaElementSource(element: unknown) {
    if (this.captured.has(element)) {
      throw new Error("HTMLMediaElement already connected to a source node");
    }
    this.captured.add(element);
    const source = new FakeNode();
    this.sources.push(source);
    return source;
  }

  resume() {
    this.resumeCalls += 1;
    this.state = "running";
    return Promise.resolve();
  }

  close() {
    this.closed = true;
    this.state = "closed";
    return Promise.resolve();
  }
}

type Harness = {
  analyser: MasterAnalyser;
  context: FakeAudioContext;
  element: HTMLMediaElement;
};

function createHarness(state: AudioContextState = "running"): Harness {
  const context = new FakeAudioContext();
  context.state = state;

  return {
    context,
    analyser: new MasterAnalyser({
      createContext: () => context as unknown as AudioContext,
    }),
    element: {} as HTMLMediaElement,
  };
}

function graphOf(context: FakeAudioContext) {
  return { output: context.gains[0], analyser: context.analysers[0] };
}

// ---- Graph ------------------------------------------------------------------

describe("MasterAnalyser graph", () => {
  it("hangs the analyser off the master output, in series with the destination", () => {
    const { analyser, context } = createHarness();

    const output = analyser.getMasterOutput() as unknown as FakeGain;
    const { analyser: node } = graphOf(context);

    expect(output).toBe(context.gains[0]);
    expect(output.isConnectedTo(node)).toBe(true);
    expect(node.isConnectedTo(context.destination)).toBe(true);
  });

  it("configures the FFT the visualizer expects", () => {
    const { analyser, context } = createHarness();
    analyser.getMasterOutput();

    expect(graphOf(context).analyser.fftSize).toBe(ANALYSER_FFT_SIZE);
    expect(graphOf(context).analyser.smoothingTimeConstant).toBe(ANALYSER_SMOOTHING);
  });

  it("leaves the master output at unity so metering cannot change the mix", () => {
    const { analyser, context } = createHarness();
    analyser.getMasterOutput();

    expect(graphOf(context).output.gain.value).toBe(UNDUCKED_GAIN);
  });

  it("opens one graph however many sources arrive", () => {
    const { analyser, context } = createHarness();

    analyser.captureMediaElement({} as HTMLMediaElement);
    analyser.captureMediaElement({} as HTMLMediaElement);
    analyser.getMasterOutput();

    expect(context.gains).toHaveLength(1);
    expect(context.analysers).toHaveLength(1);
  });

  it("reports the context sample rate, so a bin can be turned into hertz", () => {
    const { analyser } = createHarness();
    analyser.getMasterOutput();

    expect(analyser.getSampleRate()).toBe(48000);
  });
});

// ---- Capture ----------------------------------------------------------------

describe("MasterAnalyser media capture", () => {
  it("routes a captured element through the master output", () => {
    const { analyser, context, element } = createHarness();

    expect(analyser.captureMediaElement(element)).toBe(true);
    expect(context.sources[0].isConnectedTo(graphOf(context).output)).toBe(true);
    expect(analyser.isLive()).toBe(true);
  });

  it("captures an element once, since a second source node would throw", () => {
    const { analyser, context, element } = createHarness();

    expect(analyser.captureMediaElement(element)).toBe(true);
    expect(analyser.captureMediaElement(element)).toBe(true);
    expect(context.sources).toHaveLength(1);
  });

  it("refuses to reroute audio into a suspended graph", () => {
    // Capturing moves an element's output into the graph permanently, and a
    // suspended graph plays nothing — a visualization is not worth a silent DJ.
    const { analyser, context, element } = createHarness("suspended");

    expect(analyser.captureMediaElement(element)).toBe(false);
    expect(context.sources).toHaveLength(0);
    expect(analyser.isLive()).toBe(false);
  });

  it("accepts the element once a gesture has resumed the graph", () => {
    const { analyser, context, element } = createHarness("suspended");

    analyser.unlock();

    expect(context.resumeCalls).toBe(1);
    expect(analyser.captureMediaElement(element)).toBe(true);
  });

  it("leaves a running graph alone on unlock", () => {
    const { analyser, context } = createHarness();
    analyser.unlock();

    expect(context.resumeCalls).toBe(0);
  });

  it("drops the source node when a clip is released", () => {
    const { analyser, context, element } = createHarness();

    analyser.captureMediaElement(element);
    analyser.releaseMediaElement(element);

    expect(context.sources[0].disconnects).toBe(1);
    expect(analyser.isLive()).toBe(false);
  });

  it("ignores a release for an element it never captured", () => {
    const { analyser, element } = createHarness();

    expect(() => analyser.releaseMediaElement(element)).not.toThrow();
    expect(analyser.isLive()).toBe(false);
  });

  it("routes an existing audio node too", () => {
    const { analyser, context } = createHarness();
    const source = new FakeNode();

    expect(analyser.connect(source as unknown as AudioNode)).toBe(true);
    expect(source.isConnectedTo(graphOf(context).output)).toBe(true);
    expect(analyser.isLive()).toBe(true);
  });
});

// ---- Metering ---------------------------------------------------------------

describe("MasterAnalyser metering", () => {
  it("reports nothing until a source is routed through it", () => {
    const { analyser } = createHarness();

    expect(analyser.getFrequencyData()).toBeNull();
    expect(analyser.getByteTimeDomainData()).toBeNull();
    expect(analyser.isLive()).toBe(false);
  });

  it("hands back both frames once a source is live", () => {
    const { analyser, context, element } = createHarness();
    analyser.captureMediaElement(element);
    graphOf(context).analyser.level = 200;

    const frequency = analyser.getFrequencyData();
    const waveform = analyser.getByteTimeDomainData();

    expect(frequency).toHaveLength(ANALYSER_FFT_SIZE / 2);
    expect(waveform).toHaveLength(ANALYSER_FFT_SIZE);
    expect(frequency?.[0]).toBe(200);
    expect(waveform?.[0]).toBe(200);
  });

  it("reuses one buffer per frame kind rather than allocating per read", () => {
    const { analyser, element } = createHarness();
    analyser.captureMediaElement(element);

    expect(analyser.getFrequencyData()).toBe(analyser.getFrequencyData());
    expect(analyser.getByteTimeDomainData()).toBe(analyser.getByteTimeDomainData());
  });

  it("stops metering once every source has been released", () => {
    const { analyser, element } = createHarness();

    analyser.captureMediaElement(element);
    expect(analyser.getFrequencyData()).not.toBeNull();

    analyser.releaseMediaElement(element);
    expect(analyser.getFrequencyData()).toBeNull();
  });
});

// ---- Failure modes ----------------------------------------------------------

describe("MasterAnalyser resilience", () => {
  it("stays inert in a runtime with no Web Audio", () => {
    const analyser = new MasterAnalyser({ createContext: () => null });

    expect(analyser.getMasterOutput()).toBeNull();
    expect(analyser.captureMediaElement({} as HTMLMediaElement)).toBe(false);
    expect(analyser.getFrequencyData()).toBeNull();
    expect(analyser.getSampleRate()).toBeNull();
    expect(() => analyser.unlock()).not.toThrow();
  });

  it("gives up on a context factory that throws instead of retrying forever", () => {
    let attempts = 0;
    const analyser = new MasterAnalyser({
      createContext: () => {
        attempts += 1;
        throw new Error("no audio device");
      },
    });

    analyser.captureMediaElement({} as HTMLMediaElement);
    analyser.captureMediaElement({} as HTMLMediaElement);
    analyser.getMasterOutput();

    expect(attempts).toBe(1);
  });

  it("declines a capture the context refuses", () => {
    const { analyser, context } = createHarness();
    const element = {} as HTMLMediaElement;
    // Mirrors an element already bound to a source node built elsewhere.
    context.captured.add(element);

    expect(analyser.captureMediaElement(element)).toBe(false);
    expect(analyser.isLive()).toBe(false);
  });

  it("tears the graph down and reports silence afterwards", () => {
    const { analyser, context, element } = createHarness();
    analyser.captureMediaElement(element);

    analyser.destroy();

    expect(context.closed).toBe(true);
    expect(analyser.isLive()).toBe(false);
    expect(analyser.getFrequencyData()).toBeNull();
    // A destroyed analyser must not quietly open a second context.
    expect(analyser.captureMediaElement({} as HTMLMediaElement)).toBe(false);
    expect(context.gains).toHaveLength(1);
  });
});

describe("shared analyser", () => {
  it("hands every caller the same instance", () => {
    resetMasterAnalyser();
    expect(getMasterAnalyser()).toBe(getMasterAnalyser());
  });

  it("builds a fresh instance after a reset", () => {
    const first = getMasterAnalyser();
    resetMasterAnalyser();
    expect(getMasterAnalyser()).not.toBe(first);
  });

  it("stays inert on a server, where there is no window to open a context on", () => {
    resetMasterAnalyser();
    // The suite runs in the node environment, so this is the SSR path verbatim.
    expect(getMasterAnalyser().getMasterOutput()).toBeNull();
    resetMasterAnalyser();
  });
});

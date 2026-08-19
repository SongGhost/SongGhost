import { describe, expect, it, vi } from "vitest";
import type { VolumeController } from "@/types/audio";
import { DUCK_RATIO, UNDUCKED_GAIN, VOICE_HEADROOM_BOOST, voiceGain } from "../mix-bus";
import { SPEECH_END_TAIL_MS } from "../../volume-ramp";
import { BufferedVoiceNode } from "../VoiceNode";

class FakeVoiceElement {
  volume = 1;
  muted = false;
  paused = true;
  ended = false;
  playCalls = 0;
  playRejection: Error | null = null;
  readyState = 0;
  srcAssignedWhileAudible = false;
  preload = "";

  private _src = "";
  private listeners = new Map<string, Set<() => void>>();

  constructor(src?: string) {
    if (src) this.src = src;
  }

  get src(): string {
    return this._src;
  }

  set src(value: string) {
    if (value && (!this.muted || this.volume !== 0)) {
      this.srcAssignedWhileAudible = true;
    }
    this._src = value;
  }

  addEventListener(type: string, fn: () => void) {
    const bucket = this.listeners.get(type) ?? new Set();
    bucket.add(fn);
    this.listeners.set(type, bucket);
  }

  removeEventListener(type: string, fn: () => void) {
    this.listeners.get(type)?.delete(fn);
  }

  play() {
    this.playCalls += 1;
    if (this.playRejection) return Promise.reject(this.playRejection);
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }

  setAttribute(_name: string, _value: string) {}

  removeAttribute(_name: string) {}

  load() {}

  finish() {
    this.ended = true;
    this.paused = true;
    [...(this.listeners.get("ended") ?? [])].forEach((fn) => fn());
  }

  /** Reports the clip as buffered enough to play through. */
  buffered() {
    this.readyState = 4;
    [...(this.listeners.get("canplaythrough") ?? [])].forEach((fn) => fn());
  }

  fail() {
    [...(this.listeners.get("error") ?? [])].forEach((fn) => fn());
  }
}

/** Instant ramps: the duck curve is `volume-ramp`'s job, not the node's. */
function createFakeBus() {
  let level = UNDUCKED_GAIN;
  const ramps: Array<{ from: number; to: number; durationMs: number }> = [];

  const controller: VolumeController = {
    getVolume: () => level,
    setVolume: (next) => {
      level = next;
    },
    rampVolume: (from, to, durationMs) => {
      ramps.push({ from, to, durationMs });
      level = to;
      return () => {};
    },
  };

  return {
    controller,
    ramps,
    get level() {
      return level;
    },
  };
}

/** Records what the voice channel offers the master analyser, and takes it all. */
function createFakeTap() {
  const captured: unknown[] = [];
  const released: unknown[] = [];

  return {
    captured,
    released,
    tap: {
      captureMediaElement: (element: HTMLMediaElement) => {
        captured.push(element);
        return true;
      },
      releaseMediaElement: (element: HTMLMediaElement) => {
        released.push(element);
      },
    },
  };
}

function createNode(analyser = createFakeTap()) {
  const elements: FakeVoiceElement[] = [];
  const revoked: string[] = [];
  let urlCounter = 0;

  const node = new BufferedVoiceNode({
    createAudio: (src) => {
      const element = new FakeVoiceElement(src);
      elements.push(element);
      return element as unknown as HTMLAudioElement;
    },
    createObjectUrl: () => `blob:clip-${++urlCounter}`,
    revokeObjectUrl: (url) => {
      revoked.push(url);
    },
    analyser: analyser.tap,
  });

  return { node, elements, revoked, analyser, blob: {} as Blob };
}

/** Lets `play` reach its `waitForAudioEnd` listener before the clip is driven. */
function flush() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("BufferedVoiceNode levels", () => {
  it("opens a clip at the voice gain for the current master", () => {
    const { node, elements, blob } = createNode();
    node.setVolume(0.5);

    void node.play({ audioBlob: blob }).catch(() => {});

    expect(elements[0].volume).toBeCloseTo(voiceGain(0.5));
    expect(elements[0].volume).toBeCloseTo(0.5 * VOICE_HEADROOM_BOOST);
  });

  it("scales live speech by DJ Voice Volume in real time", () => {
    const { node, elements, blob } = createNode();
    node.setVolume(1);
    node.setDjVolume(0.5);

    void node.play({ audioBlob: blob }).catch(() => {});

    expect(elements[0].volume).toBeCloseTo(voiceGain(1, 0.5));
    expect(elements[0].volume).toBeCloseTo(0.5 * VOICE_HEADROOM_BOOST);

    node.setDjVolume(0.25);
    expect(elements[0].volume).toBeCloseTo(voiceGain(1, 0.25));
  });

  it("accepts DJ volume as 0–100 percent when above 1", () => {
    const { node, elements, blob } = createNode();
    node.setVolume(1);
    node.setDjVolume(50);

    void node.play({ audioBlob: blob }).catch(() => {});

    expect(elements[0].volume).toBeCloseTo(voiceGain(1, 0.5));
  });

  it("pushes a mid-break fader move onto the live clip", () => {
    const { node, elements, blob } = createNode();
    node.setVolume(0.9);
    void node.play({ audioBlob: blob }).catch(() => {});

    node.setVolume(0.4);

    expect(elements[0].volume).toBeCloseTo(voiceGain(0.4));
  });

  it("still mutes with the master fader", () => {
    const { node, elements, blob } = createNode();
    node.setVolume(0);

    void node.play({ audioBlob: blob }).catch(() => {});

    expect(elements[0].volume).toBe(0);
  });
});

describe("BufferedVoiceNode ducking", () => {
  it("ducks the music bus for the clip and restores it after", async () => {
    const { node, elements, blob } = createNode();
    const bus = createFakeBus();

    const playback = node.play({
      audioBlob: blob,
      duckingTarget: bus.controller,
      ducking: { rampOutMs: 0 },
    });

    expect(bus.ramps[0]).toMatchObject({ from: UNDUCKED_GAIN, to: DUCK_RATIO });
    expect(bus.level).toBe(DUCK_RATIO);

    await flush();
    elements[0].finish();
    await playback;

    expect(bus.level).toBe(UNDUCKED_GAIN);
  });

  it("releases the duck immediately on abort instead of riding the ramp out", async () => {
    const { node, elements, blob } = createNode();
    const bus = createFakeBus();
    const controller = new AbortController();

    const playback = node.play({
      audioBlob: blob,
      duckingTarget: bus.controller,
      signal: controller.signal,
    });

    await flush();
    controller.abort();
    await playback;

    expect(elements[0].paused).toBe(true);
    expect(bus.level).toBe(UNDUCKED_GAIN);
    // A restore ramp would have left a second entry to wait out.
    expect(bus.ramps).toHaveLength(1);
  });

  it("leaves the duck alone when a replacement break has taken over", async () => {
    const { node, elements, blob } = createNode();
    const bus = createFakeBus();

    const first = node.play({ audioBlob: blob, duckingTarget: bus.controller });
    await flush();

    const second = node.play({
      audioBlob: blob,
      duckingTarget: bus.controller,
      ducking: { rampOutMs: 0 },
    });
    await first;

    // The superseded break must not unduck the music the new one is speaking over.
    expect(bus.level).toBe(DUCK_RATIO);

    await flush();
    elements[1].finish();
    await second;

    expect(bus.level).toBe(UNDUCKED_GAIN);
  });

  it("does not touch the music bus when no ducking target is given", async () => {
    const { node, elements, blob } = createNode();
    const bus = createFakeBus();

    const playback = node.play({ audioBlob: blob });
    await flush();
    elements[0].finish();
    await playback;

    expect(bus.ramps).toHaveLength(0);
    expect(bus.level).toBe(UNDUCKED_GAIN);
  });
});

describe("BufferedVoiceNode break exit cue", () => {
  it("cues the exit as the music is handed its restore ramp, not a ramp later", async () => {
    const { node, elements, blob } = createNode();
    const bus = createFakeBus();
    const onRestore = vi.fn();

    const playback = node.play({
      audioBlob: blob,
      duckingTarget: bus.controller,
      ducking: { rampOutMs: 20 },
      onRestore,
    });

    await flush();
    elements[0].finish();
    // Speech-end tail cushion must elapse before unduck / onRestore fire.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, SPEECH_END_TAIL_MS);
    });
    await flush();

    // Still inside the ramp-out wait: a cue that fired on `play` settling would
    // land a full restore late, with the music already back at full level.
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(bus.ramps[1]).toMatchObject({ from: DUCK_RATIO, to: UNDUCKED_GAIN });

    await playback;
  });

  it("cues a break that ducked nothing, since the cue marks the speech ending", async () => {
    const { node, elements, blob } = createNode();
    const onRestore = vi.fn();

    const playback = node.play({ audioBlob: blob, onRestore });
    await flush();
    elements[0].finish();
    await playback;

    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it("stays silent for a break that was cut short", async () => {
    const { node, blob } = createNode();
    const onRestore = vi.fn();
    const controller = new AbortController();

    const playback = node.play({ audioBlob: blob, signal: controller.signal, onRestore });
    await flush();
    controller.abort();
    await playback;

    // A skip has its own transition effect; the break it interrupted never
    // reached an exit worth marking.
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("stays silent for a break a replacement took over", async () => {
    const { node, elements, blob } = createNode();
    const onRestore = vi.fn();

    const first = node.play({ audioBlob: blob, onRestore });
    await flush();
    const second = node.play({ audioBlob: blob, ducking: { rampOutMs: 0 } });
    await first;

    expect(onRestore).not.toHaveBeenCalled();

    await flush();
    elements[1].finish();
    await second;
  });

  it("stays silent for a break that failed mid-clip", async () => {
    const { node, elements, blob } = createNode();
    const onRestore = vi.fn();

    const playback = node.play({ audioBlob: blob, ducking: { rampOutMs: 0 }, onRestore });
    await flush();
    elements[0].fail();

    await expect(playback).rejects.toThrow();
    expect(onRestore).not.toHaveBeenCalled();
  });
});

describe("BufferedVoiceNode clip lifecycle", () => {
  it("revokes the object url it owns once the clip ends", async () => {
    const { node, elements, revoked, blob } = createNode();

    const playback = node.play({ audioBlob: blob, ducking: { rampOutMs: 0 } });
    await flush();
    elements[0].finish();
    await playback;

    expect(revoked).toEqual(["blob:clip-1"]);
    expect(node.isSpeaking()).toBe(false);
  });

  it("revokes the object url when the clip is aborted", async () => {
    const { node, revoked, blob } = createNode();
    const controller = new AbortController();

    const playback = node.play({ audioBlob: blob, signal: controller.signal });
    await flush();
    controller.abort();
    await playback;

    expect(revoked).toEqual(["blob:clip-1"]);
  });

  it("leaves a caller-owned url alone", async () => {
    const { node, elements, revoked } = createNode();

    const playback = node.play({ audioUrl: "https://cdn/clip.mp3" });
    await flush();
    elements[0].finish();
    await playback;

    expect(elements[0].src).toBe("https://cdn/clip.mp3");
    expect(revoked).toEqual([]);
  });

  it("rejects a play with neither a blob nor a url", async () => {
    const { node } = createNode();
    await expect(node.play({})).rejects.toThrow(/blob or url/);
  });

  it("settles the pending play when stopped, since a pause fires no event", async () => {
    const { node, elements, blob } = createNode();

    const playback = node.play({ audioBlob: blob });
    await flush();
    node.stop();

    await expect(playback).resolves.toBeUndefined();
    expect(elements[0].paused).toBe(true);
    expect(node.isSpeaking()).toBe(false);
  });

  it("hands the channel to the newest break", async () => {
    const { node, elements, blob } = createNode();

    const first = node.play({ audioBlob: blob });
    await flush();
    const second = node.play({ audioBlob: blob, ducking: { rampOutMs: 0 } });

    await first;
    expect(elements[0].paused).toBe(true);

    await flush();
    elements[1].finish();
    await second;

    expect(elements).toHaveLength(2);
  });
});

describe("BufferedVoiceNode lookahead warming", () => {
  it("adopts the warmed element instead of decoding the clip again", async () => {
    const { node, elements, revoked, blob } = createNode();

    const warming = node.preload(blob);
    elements[0].buffered();
    await warming;

    expect(node.isWarmedFor(blob)).toBe(true);

    const playback = node.play({ audioBlob: blob, ducking: { rampOutMs: 0 } });

    // A second element would mean the break paid the decode cost at the
    // transition, which is the whole thing the lookahead exists to avoid.
    expect(elements).toHaveLength(1);
    expect(elements[0].playCalls).toBe(1);

    await flush();
    elements[0].finish();
    await playback;

    expect(revoked).toEqual(["blob:clip-1"]);
    expect(node.isWarmedFor(blob)).toBe(false);
  });

  it("builds a fresh element for a break that was never warmed", async () => {
    const { node, elements, blob } = createNode();

    const playback = node.play({ audioBlob: blob, ducking: { rampOutMs: 0 } });
    await flush();
    elements[0].finish();
    await playback;

    expect(elements).toHaveLength(1);
  });

  it("drops a warmed clip that a different break has overtaken", async () => {
    const { node, elements, revoked } = createNode();
    const warmedBlob = {} as Blob;
    const liveBlob = {} as Blob;

    const warming = node.preload(warmedBlob);
    elements[0].buffered();
    await warming;

    const playback = node.play({ audioBlob: liveBlob, ducking: { rampOutMs: 0 } });

    expect(node.isWarmedFor(warmedBlob)).toBe(false);
    expect(revoked).toContain("blob:clip-1");

    await flush();
    elements[1].finish();
    await playback;
  });

  it("holds only the most recent warm-up", async () => {
    const { node, elements, revoked } = createNode();
    const first = {} as Blob;
    const second = {} as Blob;

    const firstWarming = node.preload(first);
    elements[0].buffered();
    await firstWarming;

    const secondWarming = node.preload(second);
    elements[1].buffered();
    await secondWarming;

    expect(revoked).toEqual(["blob:clip-1"]);
    expect(node.isWarmedFor(first)).toBe(false);
    expect(node.isWarmedFor(second)).toBe(true);
  });

  it("releases the clip when the warm-up is discarded", async () => {
    const { node, elements, revoked, blob } = createNode();

    const warming = node.preload(blob);
    elements[0].buffered();
    await warming;

    node.discardPreload();

    expect(revoked).toEqual(["blob:clip-1"]);
    expect(elements[0].paused).toBe(true);
    expect(node.isWarmedFor(blob)).toBe(false);
  });

  it("gives up on a clip that will not decode", async () => {
    const { node, elements, revoked, blob } = createNode();

    const warming = node.preload(blob);
    elements[0].fail();

    await expect(warming).rejects.toThrow(/decode/);
    expect(node.isWarmedFor(blob)).toBe(false);
    expect(revoked).toEqual(["blob:clip-1"]);
  });

  it("mutes the lookahead element before assigning src", async () => {
    const { node, elements, blob } = createNode();

    const warming = node.preload(blob);
    elements[0].buffered();
    await warming;

    expect(elements[0].muted).toBe(true);
    expect(elements[0].volume).toBe(0);
    expect(elements[0].srcAssignedWhileAudible).toBe(false);
    expect(elements[0].playCalls).toBe(0);
  });

  it("does not tap the session graph or duck the music bus during preload", async () => {
    const { node, elements, analyser, blob } = createNode();
    const bus = createFakeBus();

    const warming = node.preload(blob);
    elements[0].buffered();
    await warming;

    expect(analyser.captured).toEqual([]);
    expect(bus.ramps).toHaveLength(0);
    expect(bus.level).toBe(UNDUCKED_GAIN);
  });

  it("releases a warmed clip on teardown", async () => {
    const { node, elements, revoked, blob } = createNode();

    const warming = node.preload(blob);
    elements[0].buffered();
    await warming;

    node.destroy();

    expect(revoked).toEqual(["blob:clip-1"]);
  });

  it("leaves the warmed clip alone when the live break is stopped", async () => {
    const { node, elements, revoked, blob } = createNode();
    const liveBlob = {} as Blob;

    const playback = node.play({ audioBlob: liveBlob });
    await flush();

    const warming = node.preload(blob);
    elements[1].buffered();
    await warming;

    // A skip ends the break on air; the clip warmed for the next transition
    // still has a transition to play at.
    node.stop();
    await playback;

    expect(node.isWarmedFor(blob)).toBe(true);
    expect(revoked).not.toContain("blob:clip-2");
  });
});

describe("BufferedVoiceNode analyser tap", () => {
  it("offers the live clip to the analyser and releases it once the clip ends", async () => {
    const { node, elements, analyser, blob } = createNode();

    const playback = node.play({ audioBlob: blob, ducking: { rampOutMs: 0 } });
    expect(analyser.captured).toEqual([elements[0]]);
    expect(analyser.released).toEqual([]);

    await flush();
    elements[0].finish();
    await playback;

    expect(analyser.released).toEqual([elements[0]]);
  });

  it("releases the tap when the clip is aborted", async () => {
    const { node, elements, analyser, blob } = createNode();
    const controller = new AbortController();

    const playback = node.play({ audioBlob: blob, signal: controller.signal });
    await flush();
    controller.abort();
    await playback;

    expect(analyser.released).toEqual([elements[0]]);
  });

  it("releases the tap when the clip fails", async () => {
    const { node, elements, analyser, blob } = createNode();

    const playback = node.play({ audioBlob: blob, ducking: { rampOutMs: 0 } });
    await flush();
    elements[0].fail();

    await expect(playback).rejects.toThrow();
    expect(analyser.released).toEqual([elements[0]]);
  });

  it("releases the superseded clip's tap without touching the replacement's", async () => {
    const { node, elements, analyser, blob } = createNode();

    const first = node.play({ audioBlob: blob });
    await flush();
    const second = node.play({ audioBlob: blob, ducking: { rampOutMs: 0 } });
    await first;

    expect(analyser.released).toEqual([elements[0]]);

    await flush();
    elements[1].finish();
    await second;

    expect(analyser.released).toEqual([elements[0], elements[1]]);
  });

  it("keeps playing a clip the analyser declines", async () => {
    const declining = {
      captured: [] as unknown[],
      released: [] as unknown[],
      tap: {
        captureMediaElement: () => false,
        releaseMediaElement: () => {},
      },
    };
    const { node, elements, blob } = createNode(declining);

    const playback = node.play({ audioBlob: blob, ducking: { rampOutMs: 0 } });
    await flush();
    elements[0].finish();
    await playback;

    // Metering is decoration: a refused tap must not cost the listener a break.
    expect(elements[0].playCalls).toBe(1);
  });
});

describe("BufferedVoiceNode failures", () => {
  it("reports a playback failure to the error handler", async () => {
    const { node, elements, blob } = createNode();
    const onError = vi.fn();
    node.setEventHandlers({ onError });

    const playback = node.play({ audioBlob: blob });
    await flush();
    elements[0].fail();

    await expect(playback).rejects.toThrow(/DJ voice playback failed/);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("releases the duck when the clip fails", async () => {
    const { node, elements, blob } = createNode();
    const bus = createFakeBus();

    const playback = node.play({
      audioBlob: blob,
      duckingTarget: bus.controller,
      ducking: { rampOutMs: 0 },
    });
    await flush();
    elements[0].fail();

    await expect(playback).rejects.toThrow();
    expect(bus.level).toBe(UNDUCKED_GAIN);
  });

  it("does not report an abort as an error", async () => {
    const { node, blob } = createNode();
    const onError = vi.fn();
    node.setEventHandlers({ onError });
    const controller = new AbortController();

    const playback = node.play({ audioBlob: blob, signal: controller.signal });
    await flush();
    controller.abort();
    await playback;

    expect(onError).not.toHaveBeenCalled();
  });

  it("announces the end of a clip that played through", async () => {
    const { node, elements, blob } = createNode();
    const onStarted = vi.fn();
    const onEnded = vi.fn();
    node.setEventHandlers({ onStarted, onEnded });

    const playback = node.play({ audioBlob: blob, ducking: { rampOutMs: 0 } });
    expect(onStarted).toHaveBeenCalledTimes(1);

    await flush();
    elements[0].finish();
    await playback;

    expect(onEnded).toHaveBeenCalledTimes(1);
  });
});

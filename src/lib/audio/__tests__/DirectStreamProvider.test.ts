import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAudioUnlockRequest } from "@/lib/audio-unlock";
import { DUCK_RATIO } from "../mix-bus";
import {
  DirectStreamProvider,
  isHttpStreamUrl,
  resolveDirectStreamUrl,
} from "../DirectStreamProvider";
import { trackFromProviderId } from "../TrackProvider";

class FakeAudioElement {
  paused = true;
  ended = false;
  preload = "";
  crossOrigin = "";
  currentTime = 0;
  duration = 0;
  playCalls = 0;
  volumeWrites = 0;
  srcAssignedAfterAnonymous = false;
  error: { code: number } | null = null;

  private _volume = 1;
  private _src = "";
  private listeners = new Map<string, Set<() => void>>();

  get volume(): number {
    return this._volume;
  }

  set volume(value: number) {
    this.volumeWrites += 1;
    this._volume = value;
  }

  get src(): string {
    return this._src;
  }

  set src(value: string) {
    this.srcAssignedAfterAnonymous = this.crossOrigin === "anonymous";
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

  dispatch(type: string) {
    [...(this.listeners.get(type) ?? [])].forEach((fn) => fn());
  }

  play() {
    this.playCalls += 1;
    this.paused = false;
    this.dispatch("playing");
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
    this.dispatch("pause");
  }

  setAttribute(_name: string, _value: string) {}

  removeAttribute(name: string) {
    if (name === "src") this._src = "";
  }

  load() {}
}

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

const STREAM = trackFromProviderId("direct_stream", "https://cdn.example/a.mp3");

describe("resolveDirectStreamUrl", () => {
  it("prefers an explicit streamUrl", () => {
    expect(
      resolveDirectStreamUrl({
        streamUrl: "https://licensed.example/track.mp3",
        youtubeId: "abc",
        previewUrl: "https://preview.example/clip.mp3",
      }),
    ).toBe("https://licensed.example/track.mp3");
  });

  it("treats an http providerTrackId as the stream", () => {
    expect(resolveDirectStreamUrl(STREAM)).toBe("https://cdn.example/a.mp3");
  });

  it("does not steal a YouTube row's preview clip", () => {
    expect(
      resolveDirectStreamUrl({
        youtubeId: "abc123",
        previewUrl: "https://preview.example/clip.mp3",
      }),
    ).toBeUndefined();
  });

  it("does not treat a 30-second previewUrl as an on-air stream", () => {
    expect(
      resolveDirectStreamUrl({ previewUrl: "https://preview.example/clip.mp3" }),
    ).toBeUndefined();
  });

  it("rejects non-http identifiers", () => {
    expect(isHttpStreamUrl("dQw4w9wgWcQ")).toBe(false);
    expect(resolveDirectStreamUrl({ providerTrackId: "dQw4w9wgWcQ" })).toBeUndefined();
  });
});

describe("DirectStreamProvider", () => {
  let created: FakeAudioElement[] = [];

  beforeEach(() => {
    created = [];
    clearAudioUnlockRequest();
    vi.stubGlobal(
      "Audio",
      class {
        constructor(src?: string) {
          const element = new FakeAudioElement();
          if (src) element.src = src;
          created.push(element);
          return element as unknown as HTMLAudioElement;
        }
      },
    );
  });

  afterEach(() => {
    clearAudioUnlockRequest();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sets crossOrigin before assigning src", async () => {
    const provider = new DirectStreamProvider();
    expect(created).toHaveLength(1);
    expect(created[0].crossOrigin).toBe("anonymous");
    expect(created[0].src).toBe("");

    await provider.load(STREAM);

    expect(created[0].src).toBe("https://cdn.example/a.mp3");
    expect(created[0].srcAssignedAfterAnonymous).toBe(true);
  });

  it("reuses one long-lived element across track loads", async () => {
    const provider = new DirectStreamProvider();
    await provider.load(STREAM);
    await provider.load(trackFromProviderId("direct_stream", "https://cdn.example/b.mp3"));

    expect(created).toHaveLength(1);
    expect(created[0].src).toBe("https://cdn.example/b.mp3");
  });

  it("applies ducked musicGain to the element without a second source node", async () => {
    const analyser = createFakeTap();
    const provider = new DirectStreamProvider({ analyser: analyser.tap });
    provider.setVolume(0.8);
    provider.setDuckGain(DUCK_RATIO);

    await provider.load(STREAM);

    expect(created[0].volume).toBeCloseTo(0.8 * DUCK_RATIO);
    expect(analyser.captured).toEqual([created[0]]);
  });

  it("re-asserts duck gain on load-settle and playing", async () => {
    vi.useFakeTimers();
    const provider = new DirectStreamProvider();
    provider.setVolume(1);
    provider.setDuckGain(DUCK_RATIO);
    await provider.load(STREAM);

    created[0].volume = 1;
    vi.advanceTimersByTime(600);
    expect(created[0].volume).toBeCloseTo(DUCK_RATIO);

    created[0].volume = 1;
    created[0].dispatch("playing");
    expect(created[0].volume).toBeCloseTo(DUCK_RATIO);
  });

  it("seeks to 0 once and emits onPlaying once per track load", async () => {
    vi.useFakeTimers();
    const provider = new DirectStreamProvider();
    const onPlaying = vi.fn();
    provider.setEventHandlers({ onPlaying });

    await provider.load(STREAM);
    provider.play();
    vi.advanceTimersByTime(600);

    expect(created[0].currentTime).toBe(0);
    expect(created[0].playCalls).toBeGreaterThan(0);
    expect(onPlaying).toHaveBeenCalledTimes(1);

    created[0].dispatch("playing");
    created[0].dispatch("playing");
    expect(onPlaying).toHaveBeenCalledTimes(1);
  });

  it("keeps the mix-bus tap across unload and releases it on destroy", async () => {
    const analyser = createFakeTap();
    const provider = new DirectStreamProvider({ analyser: analyser.tap });
    await provider.load(STREAM);
    provider.unload();

    expect(analyser.released).toEqual([]);

    provider.destroy();
    expect(analyser.released).toEqual([created[0]]);
  });

  it("retries CORS/load failures a bounded number of times, then emits onError", async () => {
    vi.useFakeTimers();
    const provider = new DirectStreamProvider();
    const onError = vi.fn();
    provider.setEventHandlers({ onError });
    await provider.load(STREAM);

    created[0].dispatch("error");
    vi.advanceTimersByTime(2000);
    created[0].dispatch("error");
    vi.advanceTimersByTime(2000);
    created[0].dispatch("error");
    vi.advanceTimersByTime(2000);
    created[0].dispatch("error");
    vi.advanceTimersByTime(2000);

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("retries after a stream stall without skipping immediately", async () => {
    vi.useFakeTimers();
    const provider = new DirectStreamProvider();
    const onError = vi.fn();
    provider.setEventHandlers({ onError });
    provider.play();
    await provider.load(STREAM);
    vi.advanceTimersByTime(600);

    created[0].dispatch("stalled");
    vi.advanceTimersByTime(12_000);

    expect(onError).not.toHaveBeenCalled();
    expect(created[0].src).toBe("https://cdn.example/a.mp3");
  });

  it("re-offers the element to the analyser on unlock", async () => {
    const analyser = createFakeTap();
    const provider = new DirectStreamProvider({ analyser: analyser.tap });
    await provider.load(STREAM);
    expect(analyser.captured).toHaveLength(1);

    provider.unlockAudio();
    expect(analyser.captured).toHaveLength(2);
    expect(analyser.captured[1]).toBe(created[0]);
  });

  it("hard_pause launch hold keeps the element paused at 0:00 despite play()", async () => {
    vi.useFakeTimers();
    const provider = new DirectStreamProvider();
    const onPlaying = vi.fn();
    const onPaused = vi.fn();
    provider.setEventHandlers({ onPlaying, onPaused });

    provider.setLaunchHold(true, "hard_pause");
    await provider.load(STREAM);
    provider.play();
    vi.advanceTimersByTime(600);

    expect(created[0].paused).toBe(true);
    expect(created[0].currentTime).toBe(0);
    expect(created[0].playCalls).toBe(0);
    expect(onPlaying).toHaveBeenCalledTimes(1);
    expect(onPaused).not.toHaveBeenCalled();
  });

  it("intro_ramp launch hold starts playback without pinning duck gain", async () => {
    vi.useFakeTimers();
    const provider = new DirectStreamProvider();
    provider.setVolume(1);
    provider.setLaunchHold(true, "intro_ramp");
    await provider.load(STREAM);
    provider.play();
    vi.advanceTimersByTime(600);

    expect(created[0].paused).toBe(false);
    expect(created[0].currentTime).toBe(0);
    expect(created[0].playCalls).toBeGreaterThan(0);
    expect(provider.getDuckGain()).toBeCloseTo(1);
    expect(created[0].volume).toBeCloseTo(1);
  });

  it("intro_ramp applies duckBus gain without setLaunchHold re-pinning it", async () => {
    vi.useFakeTimers();
    const provider = new DirectStreamProvider();
    provider.setVolume(1);
    provider.setDuckGain(DUCK_RATIO);
    provider.setLaunchHold(true, "intro_ramp");
    await provider.load(STREAM);
    provider.play();
    vi.advanceTimersByTime(600);

    expect(created[0].paused).toBe(false);
    expect(created[0].volume).toBeCloseTo(DUCK_RATIO);
  });

  it("releaseLaunchHold allows a subsequent play() from 0:00 without onPaused bounce", async () => {
    vi.useFakeTimers();
    const provider = new DirectStreamProvider();
    const onPaused = vi.fn();
    provider.setEventHandlers({ onPaused });

    provider.setLaunchHold(true, "hard_pause");
    await provider.load(STREAM);
    provider.play();
    vi.advanceTimersByTime(600);
    expect(created[0].paused).toBe(true);

    provider.releaseLaunchHold();
    provider.resetPlayingEmitted();
    provider.play();

    expect(provider.holdForOpeningBreak).toBe(false);
    expect(created[0].paused).toBe(false);
    expect(created[0].currentTime).toBe(0);
    expect(onPaused).not.toHaveBeenCalled();
  });

  it("applyUnlock during hard_pause does not leak playElement frames", async () => {
    vi.useFakeTimers();
    const provider = new DirectStreamProvider();
    provider.setLaunchHold(true, "hard_pause");
    await provider.load(STREAM);
    provider.play();
    vi.advanceTimersByTime(600);
    expect(created[0].playCalls).toBe(0);

    provider.unlockAudio();

    expect(provider.isLaunchHoldActive()).toBe(true);
    expect(created[0].paused).toBe(true);
    expect(created[0].currentTime).toBe(0);
    expect(created[0].playCalls).toBe(0);
  });

  it("does not re-pin duck gain on timeupdate, playing, or ensurePlayback after restore", async () => {
    vi.useFakeTimers();
    const provider = new DirectStreamProvider();
    provider.setVolume(1);
    provider.setDuckGain(DUCK_RATIO);
    provider.setLaunchHold(true, "intro_ramp");
    await provider.load(STREAM);
    provider.play();
    vi.advanceTimersByTime(600);
    expect(created[0].volume).toBeCloseTo(DUCK_RATIO);

    provider.setDuckGain(1);
    expect(created[0].volume).toBeCloseTo(1);

    created[0].currentTime = 1.5;
    created[0].dispatch("timeupdate");
    created[0].dispatch("playing");
    provider.play();
    provider.unlockAudio();

    expect(provider.getDuckGain()).toBeCloseTo(1);
    expect(created[0].volume).toBeCloseTo(1);
  });

  it("releases a stale launch hold once playhead passes 3s while playing", async () => {
    vi.useFakeTimers();
    const provider = new DirectStreamProvider();
    provider.setVolume(1);
    provider.setDuckGain(DUCK_RATIO);
    provider.setLaunchHold(true, "intro_ramp");
    await provider.load(STREAM);
    provider.play();
    vi.advanceTimersByTime(600);
    expect(provider.isLaunchHoldActive()).toBe(true);
    expect(created[0].volume).toBeCloseTo(DUCK_RATIO);

    created[0].paused = false;
    created[0].ended = false;
    created[0].currentTime = 3.1;
    created[0].dispatch("timeupdate");

    expect(provider.isLaunchHoldActive()).toBe(false);
    // Position safety drops the lock only — it must not restore or re-pin gain.
    expect(created[0].volume).toBeCloseTo(DUCK_RATIO);
  });

  it("does not re-stamp element volume when the target is already applied", async () => {
    const provider = new DirectStreamProvider();
    provider.setVolume(0.5);
    await provider.load(STREAM);
    const writesAfterLoad = created[0].volumeWrites;

    created[0].dispatch("canplay");
    created[0].dispatch("canplay");
    created[0].dispatch("playing");
    provider.setVolume(0.5);

    expect(created[0].volumeWrites).toBe(writesAfterLoad);
    expect(created[0].volume).toBeCloseTo(0.5);
  });

  it("skips applyVolume and clears unlock retry when the element is already playing", async () => {
    vi.useFakeTimers();
    const provider = new DirectStreamProvider();
    provider.setVolume(0.5);
    await provider.load(STREAM);
    provider.play();
    vi.advanceTimersByTime(600);

    created[0].paused = false;
    created[0].ended = false;
    const writesBeforeUnlock = created[0].volumeWrites;

    provider.unlockAudio();
    provider.unlockAudio();
    vi.advanceTimersByTime(400 * 10);

    expect(created[0].volumeWrites).toBe(writesBeforeUnlock);
    expect(created[0].volume).toBeCloseTo(0.5);
  });
});

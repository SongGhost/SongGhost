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
  volume = 1;
  paused = true;
  ended = false;
  preload = "";
  crossOrigin = "";
  currentTime = 0;
  duration = 0;
  playCalls = 0;
  srcAssignedAfterAnonymous = false;
  error: { code: number } | null = null;

  private _src = "";
  private listeners = new Map<string, Set<() => void>>();

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

  it("falls back to previewUrl when the row is HTML5-only", () => {
    expect(
      resolveDirectStreamUrl({ previewUrl: "https://preview.example/clip.mp3" }),
    ).toBe("https://preview.example/clip.mp3");
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
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioTrack, PlaybackState } from "@/types/audio";
import { DUCK_RATIO } from "../mix-bus";
import {
  BaseTrackProvider,
  Html5TrackProvider,
  trackFromProviderId,
} from "../TrackProvider";

/**
 * Exercises the shared adapter contract without a real embed. Field names avoid
 * the base class's private members, which TypeScript treats as reserved.
 */
class StubTrackProvider extends BaseTrackProvider {
  readonly id = "youtube" as const;
  readonly capabilities = ["playback"] as const;

  /** Every level the base pushed down to the "player", in order. */
  readonly applied: number[] = [];

  private stubPosition = 0;
  private stubDuration = 0;

  protected applyVolume(): void {
    this.applied.push(this.musicLevel);
  }

  protected readPosition() {
    return { position: this.stubPosition, duration: this.stubDuration };
  }

  setReading(position: number, duration: number): void {
    this.stubPosition = position;
    this.stubDuration = duration;
  }

  async load(track: AudioTrack): Promise<void> {
    this.currentTrack = track;
    this.resetPosition();
    // A real embed comes back at its own default level here.
    this.applyVolume();
  }

  unload(): void {
    this.currentTrack = null;
    this.resetPosition();
    this.setPlaybackState("idle");
  }

  play(): void {
    this.intendedPlaying = true;
    this.startPositionPolling();
  }

  pause(): void {
    this.intendedPlaying = false;
    this.stopPositionPolling();
  }

  seekTo(seconds: number): void {
    this.publishPosition(seconds);
  }

  emitPosition(position: number, duration?: number): void {
    this.publishPosition(position, duration);
  }

  emitState(state: PlaybackState): void {
    this.setPlaybackState(state);
  }

  get lastApplied(): number {
    return this.applied[this.applied.length - 1];
  }
}

const SONG = trackFromProviderId("youtube", "abc123");

describe("trackFromProviderId", () => {
  it("builds a minimal track around the native id", () => {
    expect(trackFromProviderId("youtube", "abc123")).toMatchObject({
      id: "abc123",
      provider: "youtube",
      providerTrackId: "abc123",
      title: "",
      artist: "",
    });
  });

  it("keeps supplied metadata", () => {
    const track = trackFromProviderId("itunes", "https://preview.mp3", {
      title: "Cool Song",
      artist: "The Band",
    });

    expect(track.title).toBe("Cool Song");
    expect(track.artist).toBe("The Band");
    expect(track.providerTrackId).toBe("https://preview.mp3");
  });
});

describe("track provider levels", () => {
  it("routes master through the duck gain", () => {
    const provider = new StubTrackProvider();

    provider.setVolume(0.8);
    expect(provider.lastApplied).toBeCloseTo(0.8);

    provider.setDuckGain(DUCK_RATIO);
    expect(provider.lastApplied).toBeCloseTo(0.8 * DUCK_RATIO);
  });

  it("keeps a live duck across a track load", async () => {
    const provider = new StubTrackProvider();
    provider.setVolume(0.8);
    provider.setDuckGain(DUCK_RATIO);

    await provider.load(SONG);

    // The break is still on air: the new track must arrive already ducked.
    expect(provider.getDuckGain()).toBe(DUCK_RATIO);
    expect(provider.lastApplied).toBeCloseTo(0.8 * DUCK_RATIO);
  });

  it("keeps the fader across a track load", async () => {
    const provider = new StubTrackProvider();
    provider.setVolume(0.3);

    await provider.load(SONG);

    expect(provider.getVolume()).toBeCloseTo(0.3);
    expect(provider.lastApplied).toBeCloseTo(0.3);
  });

  it("stays relative to master when the fader moves mid-duck", () => {
    const provider = new StubTrackProvider();
    provider.setVolume(0.8);
    provider.setDuckGain(DUCK_RATIO);
    const ducked = provider.lastApplied;

    provider.setVolume(0.4);

    expect(provider.lastApplied).toBeCloseTo(ducked / 2);
    expect(provider.getDuckGain()).toBe(DUCK_RATIO);
  });

  it("clamps out-of-range levels", () => {
    const provider = new StubTrackProvider();

    provider.setVolume(4);
    expect(provider.getVolume()).toBe(1);

    provider.setVolume(-1);
    expect(provider.getVolume()).toBe(0);

    provider.setDuckGain(9);
    expect(provider.getDuckGain()).toBe(1);
  });

  it("exposes a volume controller that writes through to the player", () => {
    const provider = new StubTrackProvider();
    const bus = provider.getVolumeController();

    bus.setVolume(0.6);

    expect(provider.getVolume()).toBeCloseTo(0.6);
    expect(bus.getVolume()).toBeCloseTo(0.6);
    expect(provider.lastApplied).toBeCloseTo(0.6);
  });

  it("does not re-apply an unchanged fader or duck gain", () => {
    const provider = new StubTrackProvider();

    provider.setVolume(0.5);
    expect(provider.applied).toHaveLength(1);

    provider.setVolume(0.5);
    expect(provider.applied).toHaveLength(1);

    provider.setDuckGain(1);
    expect(provider.applied).toHaveLength(1);

    provider.setDuckGain(DUCK_RATIO);
    expect(provider.applied).toHaveLength(2);

    provider.setDuckGain(DUCK_RATIO);
    expect(provider.applied).toHaveLength(2);
  });

  it("hands out one controller per provider", () => {
    const provider = new StubTrackProvider();
    expect(provider.getVolumeController()).toBe(provider.getVolumeController());
  });
});

describe("track provider position clock", () => {
  it("holds the last known duration when the player reports zero", () => {
    const provider = new StubTrackProvider();

    provider.emitPosition(10, 200);
    provider.emitPosition(11, 0);

    expect(provider.getDuration()).toBe(200);
    expect(provider.getPosition()).toBe(11);
  });

  it("reports a new track with no inherited position or duration", async () => {
    const provider = new StubTrackProvider();
    provider.emitPosition(90, 200);

    await provider.load(SONG);

    expect(provider.getPosition()).toBe(0);
    expect(provider.getDuration()).toBe(0);
  });

  it("publishes readings to the time handler while playing", () => {
    vi.useFakeTimers();
    const provider = new StubTrackProvider();
    const onTimeUpdate = vi.fn();
    provider.setEventHandlers({ onTimeUpdate });

    provider.setReading(3, 120);
    provider.play();
    expect(onTimeUpdate).toHaveBeenLastCalledWith(3, 120);

    provider.setReading(8, 120);
    vi.advanceTimersByTime(500);
    expect(onTimeUpdate).toHaveBeenLastCalledWith(8, 120);

    provider.pause();
    provider.setReading(13, 120);
    vi.advanceTimersByTime(2000);
    expect(onTimeUpdate).toHaveBeenLastCalledWith(8, 120);

    vi.useRealTimers();
  });

  it("treats a non-finite reading as the start of the track", () => {
    const provider = new StubTrackProvider();
    provider.emitPosition(Number.NaN, Number.NaN);
    expect(provider.getPosition()).toBe(0);
    expect(provider.getDuration()).toBe(0);
  });
});

describe("track provider state", () => {
  it("announces each transition once", () => {
    const provider = new StubTrackProvider();
    const onStateChange = vi.fn();
    provider.setEventHandlers({ onStateChange });

    provider.emitState("loading");
    provider.emitState("loading");
    provider.emitState("playing");

    expect(onStateChange.mock.calls).toEqual([["loading"], ["playing"]]);
    expect(provider.getPlaybackState()).toBe("playing");
  });

  it("keeps handlers across a destroy so a remount stays subscribed", () => {
    const provider = new StubTrackProvider();
    const onStateChange = vi.fn();
    provider.setEventHandlers({ onStateChange });

    provider.destroy();
    provider.emitState("playing");

    expect(onStateChange).toHaveBeenCalledWith("playing");
  });
});

// ---------------------------------------------------------------------------

class FakeAudioElement {
  volume = 1;
  paused = true;
  ended = false;
  preload = "";
  currentTime = 0;
  duration = 0;
  playCalls = 0;

  private listeners = new Map<string, Set<() => void>>();

  constructor(public src: string) {}

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
    this.dispatch("play");
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
    this.dispatch("pause");
  }

  removeAttribute() {}
  load() {}
}

/** Records what a provider offers the master analyser, and takes it all. */
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

describe("Html5TrackProvider", () => {
  let created: FakeAudioElement[] = [];

  beforeEach(() => {
    created = [];
    vi.stubGlobal(
      "Audio",
      class {
        constructor(src: string) {
          const element = new FakeAudioElement(src);
          created.push(element);
          return element as unknown as HTMLAudioElement;
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applies the ducked music level to the element", async () => {
    const provider = new Html5TrackProvider();
    provider.setVolume(0.8);
    provider.setDuckGain(DUCK_RATIO);

    await provider.load(trackFromProviderId("itunes", "https://preview.mp3"));

    expect(created[0].volume).toBeCloseTo(0.8 * DUCK_RATIO);
  });

  it("carries the duck onto the next preview clip", async () => {
    const provider = new Html5TrackProvider();
    provider.setVolume(1);
    await provider.load(trackFromProviderId("itunes", "https://one.mp3"));

    provider.setDuckGain(DUCK_RATIO);
    await provider.load(trackFromProviderId("itunes", "https://two.mp3"));

    expect(created).toHaveLength(2);
    expect(created[1].volume).toBeCloseTo(DUCK_RATIO);
  });

  it("reuses the element when the same clip is loaded again", async () => {
    const provider = new Html5TrackProvider();
    const track = trackFromProviderId("itunes", "https://one.mp3");

    await provider.load(track);
    await provider.load(track);

    expect(created).toHaveLength(1);
  });

  it("forwards element lifecycle events to the engine", async () => {
    const provider = new Html5TrackProvider();
    const onPlaying = vi.fn();
    const onEnded = vi.fn();
    provider.setEventHandlers({ onPlaying, onEnded });

    await provider.load(trackFromProviderId("itunes", "https://one.mp3"));
    provider.play();
    expect(onPlaying).toHaveBeenCalledTimes(1);

    created[0].ended = true;
    created[0].dispatch("ended");
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(provider.getPlaybackState()).toBe("ended");
  });

  it("stops reporting a finished clip's position after unload", async () => {
    const provider = new Html5TrackProvider();
    const onTimeUpdate = vi.fn();
    provider.setEventHandlers({ onTimeUpdate });

    await provider.load(trackFromProviderId("itunes", "https://one.mp3"));
    created[0].currentTime = 12;
    created[0].duration = 30;
    created[0].dispatch("timeupdate");
    expect(provider.getPosition()).toBe(12);

    provider.unload();

    expect(provider.getPosition()).toBe(0);
    expect(provider.getDuration()).toBe(0);
  });

  describe("analyser tap", () => {
    it("offers a loaded clip to the analyser", async () => {
      const analyser = createFakeTap();
      const provider = new Html5TrackProvider("itunes", { analyser: analyser.tap });

      await provider.load(trackFromProviderId("itunes", "https://one.mp3"));

      expect(analyser.captured).toEqual([created[0]]);
      expect(analyser.released).toEqual([]);
    });

    it("releases the outgoing clip's tap when a new one loads", async () => {
      const analyser = createFakeTap();
      const provider = new Html5TrackProvider("itunes", { analyser: analyser.tap });

      await provider.load(trackFromProviderId("itunes", "https://one.mp3"));
      await provider.load(trackFromProviderId("itunes", "https://two.mp3"));

      expect(analyser.released).toEqual([created[0]]);
      expect(analyser.captured).toEqual([created[0], created[1]]);
    });

    it("releases the tap on unload", async () => {
      const analyser = createFakeTap();
      const provider = new Html5TrackProvider("itunes", { analyser: analyser.tap });

      await provider.load(trackFromProviderId("itunes", "https://one.mp3"));
      provider.unload();

      expect(analyser.released).toEqual([created[0]]);
    });

    it("keeps playing a clip the analyser declines", async () => {
      const declining = {
        captureMediaElement: () => false,
        releaseMediaElement: () => {},
      };
      const provider = new Html5TrackProvider("itunes", { analyser: declining });
      provider.play();

      await provider.load(trackFromProviderId("itunes", "https://one.mp3"));

      expect(created[0].playCalls).toBe(1);
    });

    it("defaults to the shared session analyser when none is injected", async () => {
      // No injected tap: this exercises the real `getMasterAnalyser()` seam,
      // which stays inert without a DOM `AudioContext` and must not throw.
      const provider = new Html5TrackProvider();
      await expect(
        provider.load(trackFromProviderId("itunes", "https://one.mp3")),
      ).resolves.toBeUndefined();
    });
  });
});

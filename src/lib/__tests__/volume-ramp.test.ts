import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUDIO_END_TIMEOUT_SLACK_MS,
  SPEECH_END_TAIL_MS,
  waitForAudioEnd,
} from "../volume-ramp";

/** Minimal stand-in: `waitForAudioEnd` only needs the event target surface. */
function createFakeAudio(init?: {
  ended?: boolean;
  duration?: number;
  currentTime?: number;
}) {
  const target = new EventTarget();
  const element = Object.assign(target, {
    ended: init?.ended ?? false,
    duration: init?.duration ?? Number.NaN,
    currentTime: init?.currentTime ?? 0,
  }) as unknown as HTMLAudioElement;
  return {
    element,
    emit: (type: "ended" | "error") => target.dispatchEvent(new Event(type)),
  };
}

describe("waitForAudioEnd", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves after the speech-end tail cushion when the clip finishes", async () => {
    const { element, emit } = createFakeAudio();
    const pending = waitForAudioEnd(element);
    emit("ended");
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(SPEECH_END_TAIL_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBeUndefined();
    expect(settled).toBe(true);
  });

  it("can skip the cushion when tailMs is 0", async () => {
    const { element, emit } = createFakeAudio();
    const pending = waitForAudioEnd(element, undefined, 0);
    emit("ended");
    await expect(pending).resolves.toBeUndefined();
  });

  it("rejects when playback fails", async () => {
    const { element, emit } = createFakeAudio();
    const pending = waitForAudioEnd(element);
    emit("error");
    await expect(pending).rejects.toThrow("DJ voice playback failed");
  });

  // A skip pauses the clip, which fires neither `ended` nor `error`. Without the
  // signal this promise hangs and the caller never releases the duck gain.
  it("resolves when the break is aborted mid-clip", async () => {
    const { element } = createFakeAudio();
    const controller = new AbortController();
    const pending = waitForAudioEnd(element, controller.signal);
    controller.abort();
    await expect(pending).resolves.toBeUndefined();
  });

  it("resolves immediately when the signal is already aborted", async () => {
    const { element } = createFakeAudio();
    const controller = new AbortController();
    controller.abort();
    await expect(waitForAudioEnd(element, controller.signal)).resolves.toBeUndefined();
  });

  it("ignores an abort that lands after the clip already ended", async () => {
    const { element, emit } = createFakeAudio();
    const controller = new AbortController();
    const pending = waitForAudioEnd(element, controller.signal);
    emit("ended");
    await vi.advanceTimersByTimeAsync(SPEECH_END_TAIL_MS);
    await pending;
    controller.abort();
    await expect(pending).resolves.toBeUndefined();
  });

  it("resolves early if aborted during the tail cushion", async () => {
    const { element, emit } = createFakeAudio();
    const controller = new AbortController();
    const pending = waitForAudioEnd(element, controller.signal);
    emit("ended");
    controller.abort();
    await expect(pending).resolves.toBeUndefined();
  });

  it("resolves immediately when the media element has already ended", async () => {
    const { element } = createFakeAudio({ ended: true, duration: 2, currentTime: 2 });
    await expect(waitForAudioEnd(element)).resolves.toBeUndefined();
  });

  it("resolves immediately when currentTime has reached a finite duration", async () => {
    const { element } = createFakeAudio({
      ended: false,
      duration: 3,
      currentTime: 3,
    });
    await expect(waitForAudioEnd(element)).resolves.toBeUndefined();
  });

  it("resolves via the duration fallback when ended never fires", async () => {
    const durationSec = 0.1;
    const { element } = createFakeAudio({
      ended: false,
      duration: durationSec,
      currentTime: 0,
    });
    const pending = waitForAudioEnd(element);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    const timeoutMs = durationSec * 1000 + AUDIO_END_TIMEOUT_SLACK_MS;
    await vi.advanceTimersByTimeAsync(timeoutMs - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBeUndefined();
    expect(settled).toBe(true);
  });
});

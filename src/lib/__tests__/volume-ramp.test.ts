import { describe, expect, it } from "vitest";
import { waitForAudioEnd } from "../volume-ramp";

/** Minimal stand-in: `waitForAudioEnd` only needs the event target surface. */
function createFakeAudio() {
  const target = new EventTarget();
  return {
    element: target as unknown as HTMLAudioElement,
    emit: (type: "ended" | "error") => target.dispatchEvent(new Event(type)),
  };
}

describe("waitForAudioEnd", () => {
  it("resolves when the clip finishes", async () => {
    const { element, emit } = createFakeAudio();
    const pending = waitForAudioEnd(element);
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
    await pending;
    controller.abort();
    await expect(pending).resolves.toBeUndefined();
  });
});

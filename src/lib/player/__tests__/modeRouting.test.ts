import { describe, expect, it } from "vitest";
import {
  isModeBHoldState,
  isModeBSpeechHoldState,
  isUsableTtsDurationSeconds,
  MODE_A_DURATION_THRESHOLD_SEC,
  prefetchedBreakMatchesActiveHost,
  resolveModeAbFromDuration,
  shouldFailClosedHoldIncomingTransport,
} from "@/lib/audio/legacy/webOrchestrator";

describe("isUsableTtsDurationSeconds", () => {
  it("accepts a finite positive duration", () => {
    expect(isUsableTtsDurationSeconds(8.25)).toBe(true);
    expect(isUsableTtsDurationSeconds(15)).toBe(true);
  });

  it("rejects missing, non-finite, and non-positive values", () => {
    expect(isUsableTtsDurationSeconds(null)).toBe(false);
    expect(isUsableTtsDurationSeconds(undefined)).toBe(false);
    expect(isUsableTtsDurationSeconds(Number.NaN)).toBe(false);
    expect(isUsableTtsDurationSeconds(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isUsableTtsDurationSeconds(Number.NEGATIVE_INFINITY)).toBe(false);
    expect(isUsableTtsDurationSeconds(0)).toBe(false);
    expect(isUsableTtsDurationSeconds(-1)).toBe(false);
  });
});

describe("resolveModeAbFromDuration", () => {
  it("routes clips at or under the 15s threshold to Mode A", () => {
    expect(resolveModeAbFromDuration(1)).toBe("A");
    expect(resolveModeAbFromDuration(MODE_A_DURATION_THRESHOLD_SEC)).toBe("A");
  });

  it("routes clips longer than 15s to Mode B", () => {
    expect(resolveModeAbFromDuration(15.01)).toBe("B");
    expect(resolveModeAbFromDuration(42)).toBe("B");
  });

  it("fails closed to Mode B when duration is unknown or invalid", () => {
    expect(resolveModeAbFromDuration(null)).toBe("B");
    expect(resolveModeAbFromDuration(undefined)).toBe("B");
    expect(resolveModeAbFromDuration(Number.NaN)).toBe("B");
    expect(resolveModeAbFromDuration(Number.POSITIVE_INFINITY)).toBe("B");
    expect(resolveModeAbFromDuration(0)).toBe("B");
  });
});

describe("isModeBHoldState", () => {
  it("holds the playhead during prefetch and Mode B bed/speech", () => {
    expect(isModeBHoldState("PREFETCHING_BREAK")).toBe(true);
    expect(isModeBHoldState("MODE_B_BED_FADE")).toBe(true);
    expect(isModeBHoldState("MODE_B_SPEAKING")).toBe(true);
    expect(isModeBHoldState("MODE_B_LAUNCH")).toBe(false);
    expect(isModeBHoldState("MODE_A_SPEAKING")).toBe(false);
    expect(isModeBHoldState("PLAYING_MUSIC")).toBe(false);
  });
});

describe("isModeBSpeechHoldState", () => {
  it("is true only while Mode B is fading or speaking", () => {
    expect(isModeBSpeechHoldState("MODE_B_BED_FADE")).toBe(true);
    expect(isModeBSpeechHoldState("MODE_B_SPEAKING")).toBe(true);
    expect(isModeBSpeechHoldState("PREFETCHING_BREAK")).toBe(false);
    expect(isModeBSpeechHoldState("MODE_B_LAUNCH")).toBe(false);
    expect(isModeBSpeechHoldState("PLAYING_MUSIC")).toBe(false);
  });
});

describe("shouldFailClosedHoldIncomingTransport", () => {
  const off = {
    djDisabled: false,
    fsmHold: false,
    breakDue: false,
    willBreakOnNextTrack: false,
    hasWarmedBreak: false,
  };

  it("never holds when DJ is disabled", () => {
    expect(
      shouldFailClosedHoldIncomingTransport({
        ...off,
        djDisabled: true,
        breakDue: true,
        hasWarmedBreak: true,
      }),
    ).toBe(false);
  });

  it("holds when a break is due, warmed, or the FSM is already holding", () => {
    expect(shouldFailClosedHoldIncomingTransport({ ...off, breakDue: true })).toBe(true);
    expect(
      shouldFailClosedHoldIncomingTransport({ ...off, willBreakOnNextTrack: true }),
    ).toBe(true);
    expect(
      shouldFailClosedHoldIncomingTransport({ ...off, hasWarmedBreak: true }),
    ).toBe(true);
    expect(shouldFailClosedHoldIncomingTransport({ ...off, fsmHold: true })).toBe(true);
    expect(shouldFailClosedHoldIncomingTransport(off)).toBe(false);
  });
});

describe("prefetchedBreakMatchesActiveHost", () => {
  const devonVoice = "2ajXGJNYBR0iNHpS4VZb";
  const milesVoice = "gyIv9PAQRvJjSZlk68oE";

  it("accepts a clip that matches the live Devon host", () => {
    expect(
      prefetchedBreakMatchesActiveHost(
        { personaId: "devon", voiceId: devonVoice },
        { personaId: "devon-pulse", voiceId: devonVoice },
      ),
    ).toBe(true);
  });

  it("rejects a Miles clip while Devon is locked", () => {
    expect(
      prefetchedBreakMatchesActiveHost(
        { personaId: "miles", voiceId: milesVoice },
        { personaId: "devon-pulse", voiceId: devonVoice },
      ),
    ).toBe(false);
  });

  it("rejects an unstamped clip when a live host is set", () => {
    expect(
      prefetchedBreakMatchesActiveHost(
        {},
        { personaId: "devon-pulse", voiceId: devonVoice },
      ),
    ).toBe(false);
  });

  it("allows a clip when no live host or voice is set", () => {
    expect(
      prefetchedBreakMatchesActiveHost(
        { personaId: "miles", voiceId: milesVoice },
        { personaId: null, voiceId: null },
      ),
    ).toBe(true);
  });
});

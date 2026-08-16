import { describe, expect, it } from "vitest";
import {
  isModeBHoldState,
  isUsableTtsDurationSeconds,
  MODE_A_DURATION_THRESHOLD_SEC,
  resolveModeAbFromDuration,
} from "../webOrchestrator";

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
  it("holds the playhead during bed fade and speaking only", () => {
    expect(isModeBHoldState("MODE_B_BED_FADE")).toBe(true);
    expect(isModeBHoldState("MODE_B_SPEAKING")).toBe(true);
    expect(isModeBHoldState("MODE_B_LAUNCH")).toBe(false);
    expect(isModeBHoldState("MODE_A_SPEAKING")).toBe(false);
    expect(isModeBHoldState("PLAYING_MUSIC")).toBe(false);
  });
});

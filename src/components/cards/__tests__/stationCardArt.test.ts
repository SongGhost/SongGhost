import { describe, expect, it } from "vitest";
import {
  accentGradientStyle,
  shouldUseAccentGradient,
} from "../stationCardArt";

describe("StationCard accent gradient", () => {
  it("uses the accent gradient only when artwork is empty and an accent is set", () => {
    expect(shouldUseAccentGradient(null, "#C4882A")).toBe(true);
    expect(shouldUseAccentGradient("", "#2992cf")).toBe(true);
    expect(shouldUseAccentGradient("  ", "#2992cf")).toBe(true);
    expect(shouldUseAccentGradient("https://example.com/art.jpg", "#C4882A")).toBe(false);
    expect(shouldUseAccentGradient(null, "")).toBe(false);
    expect(shouldUseAccentGradient(null, undefined)).toBe(false);
    expect(shouldUseAccentGradient(null, "#C4882A", false)).toBe(false);
  });

  it("builds an on-brand gradient from the accent color", () => {
    const style = accentGradientStyle("#C4882A");
    expect(style.background).toContain("#C4882A");
    expect(style.background).toContain("linear-gradient");
  });
});

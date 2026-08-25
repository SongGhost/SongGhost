import { describe, expect, it } from "vitest";
import {
  VIBE_CHIPS,
  FREE_VIBE_TEASER_CHIP_ID,
  getFreeVibeTeaserChip,
  resolveActiveVibeChipId,
  selectVibeChip,
} from "@/data/vibe-chips";
import { sanitizeVibePrompt } from "@/types/station";

describe("vibe chips — single-select replace", () => {
  it("ships five Pro presets with labels and vibe strings", () => {
    expect(VIBE_CHIPS).toHaveLength(5);
    expect(VIBE_CHIPS.map((chip) => chip.label)).toEqual([
      "Late Night",
      "Hype",
      "Storyteller",
      "Deep Cuts",
      "Front Porch",
    ]);
    for (const chip of VIBE_CHIPS) {
      expect(chip.vibe.trim().length).toBeGreaterThan(0);
      expect(sanitizeVibePrompt(chip.vibe)).toBe(chip.vibe);
    }
  });

  it("replaces the custom text with the selected chip vibe (no stacking)", () => {
    const lateNight = selectVibeChip("late-night");
    const hype = selectVibeChip("hype");
    expect(lateNight).toContain("after-hours");
    expect(hype).toContain("fist-pump");
    expect(lateNight).not.toContain(hype);
    expect(resolveActiveVibeChipId(hype)).toBe("hype");
  });

  it("clears the active chip when the text no longer matches a preset", () => {
    const fromChip = selectVibeChip("storyteller");
    expect(resolveActiveVibeChipId(fromChip)).toBe("storyteller");
    expect(resolveActiveVibeChipId(`${fromChip} extra notes`)).toBeNull();
    expect(resolveActiveVibeChipId("")).toBeNull();
    expect(resolveActiveVibeChipId("   ")).toBeNull();
  });

  it("uses Late Night as the Free teaser preset", () => {
    expect(FREE_VIBE_TEASER_CHIP_ID).toBe("late-night");
    expect(getFreeVibeTeaserChip().id).toBe("late-night");
    expect(getFreeVibeTeaserChip().vibe).toBe(selectVibeChip("late-night"));
  });
});

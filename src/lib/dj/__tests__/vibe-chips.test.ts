import { afterEach, describe, expect, it } from "vitest";
import { getFreeVibeTeaserChip } from "@/data/vibe-chips";
import { clampHostTuningForTier } from "../scriptGenerator";
import {
  VIBE_PREVIEW_VOICED_BREAKS,
  clearVibePreview,
  consumeVibePreviewBreak,
  isVibePreviewActive,
  overlayVibePreviewOnPayload,
  peekVibePreview,
  startVibePreview,
} from "../vibePreview";
import { stripVibePromptsFromStationConfigs } from "@/types/station";
import { buildCloudPreferencesPayload, normalizeUserPreferences } from "@/lib/user/preferences";

const FREE_SETTINGS = {
  pace: "long_breaks" as const,
  lore: "roots_branches" as const,
  knowledge: "genius" as const,
  allowExplicit: true,
  customDirectives: "sound like a pirate",
};

afterEach(() => {
  clearVibePreview();
});

describe("clampHostTuningForTier — vibe chips", () => {
  it("still forces Free persisted customDirectives to empty", () => {
    const clamped = clampHostTuningForTier(FREE_SETTINGS, false);
    expect(clamped.customDirectives).toBe("");
    expect(clamped.lore).toBe("standard");
  });

  it("lets a live Free preview through the clamp without changing other Free locks", () => {
    const clamped = clampHostTuningForTier(FREE_SETTINGS, false, {
      vibePreviewActive: true,
    });
    expect(clamped.customDirectives).toBe("sound like a pirate");
    expect(clamped.lore).toBe("standard");
    expect(clamped.allowExplicit).toBe(false);
  });

  it("passes Pro host tuning through unchanged", () => {
    expect(clampHostTuningForTier(FREE_SETTINGS, true)).toEqual(FREE_SETTINGS);
    expect(
      clampHostTuningForTier(FREE_SETTINGS, true, { vibePreviewActive: true }),
    ).toEqual(FREE_SETTINGS);
  });
});

describe("preview-vibe window", () => {
  it("expires after N voiced breaks and clears", () => {
    const started = startVibePreview(getFreeVibeTeaserChip().vibe);
    expect(started?.remainingBreaks).toBe(VIBE_PREVIEW_VOICED_BREAKS);
    expect(isVibePreviewActive()).toBe(true);

    const first = consumeVibePreviewBreak();
    expect(first.expired).toBe(false);
    expect(first.remaining).toBe(1);
    expect(isVibePreviewActive()).toBe(true);

    const second = consumeVibePreviewBreak();
    expect(second.expired).toBe(true);
    expect(second.remaining).toBe(0);
    expect(isVibePreviewActive()).toBe(false);
    expect(peekVibePreview()).toBeNull();
  });

  it("overlays the preview vibe for Free and leaves persisted Pro vibe alone", () => {
    startVibePreview(getFreeVibeTeaserChip().vibe);
    const free = overlayVibePreviewOnPayload("", false);
    expect(free.vibePreviewActive).toBe(true);
    expect(free.vibePrompt).toBe(getFreeVibeTeaserChip().vibe);

    const pro = overlayVibePreviewOnPayload("keep it dusty", true);
    expect(pro.vibePreviewActive).toBe(false);
    expect(pro.vibePrompt).toBe("keep it dusty");
  });

  it("does not leak the preview into stationConfigs or the cloud sync payload", () => {
    startVibePreview(getFreeVibeTeaserChip().vibe);
    const prefs = normalizeUserPreferences({
      stationConfigs: {
        "90s-alt": { stationId: "90s-alt", vibePrompt: "" },
      },
    });
    expect(prefs.stationConfigs["90s-alt"]?.vibePrompt).toBeUndefined();

    const payload = buildCloudPreferencesPayload(prefs, {
      activeHostId: null,
      isHostLocked: false,
    });
    expect(payload.stationConfigs?.["90s-alt"]?.vibePrompt).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain(getFreeVibeTeaserChip().vibe);
  });
});

describe("mid-session downgrade clears the vibe", () => {
  it("strips persisted vibePrompt from every station config", () => {
    const stripped = stripVibePromptsFromStationConfigs({
      "70s-classic-rock": {
        stationId: "70s-classic-rock",
        vibePrompt: "intimate, hushed, after-hours warmth — like a 3 AM drive-time host",
      },
      "90s-alt": { stationId: "90s-alt" },
    });
    expect(stripped["70s-classic-rock"]?.vibePrompt).toBeUndefined();
    expect(stripped["90s-alt"]?.vibePrompt).toBeUndefined();
  });

  it("ends the preview window so a Free listener cannot keep a Pro vibe", () => {
    startVibePreview(getFreeVibeTeaserChip().vibe);
    expect(isVibePreviewActive()).toBe(true);
    clearVibePreview();
    expect(isVibePreviewActive()).toBe(false);
    const overlay = overlayVibePreviewOnPayload("leftover pro vibe", false);
    expect(overlay.vibePreviewActive).toBe(false);
    const clamped = clampHostTuningForTier(
      { ...FREE_SETTINGS, customDirectives: overlay.vibePrompt },
      false,
    );
    expect(clamped.customDirectives).toBe("");
  });
});

/**
 * Host Studio Vibe Chips (WS-5).
 *
 * One-click presets that populate the existing `vibePrompt` field — not a
 * parallel directive store. Selecting a chip replaces the custom text box;
 * typing in the box clears the active chip (the text becomes the vibe).
 *
 * Free listeners cannot persist a chip; they get a session-scoped preview of
 * {@link FREE_VIBE_TEASER_CHIP_ID} via `src/lib/dj/vibePreview.ts`.
 */

import { sanitizeVibePrompt } from "@/types/station";

export type VibeChipId =
  | "late-night"
  | "hype"
  | "storyteller"
  | "deep-cuts"
  | "front-porch";

export type VibeChip = {
  id: VibeChipId;
  label: string;
  /** Written into `vibePrompt` when selected. */
  vibe: string;
};

/**
 * Initial Pro set — tunable by the designer after ear test.
 * Each `vibe` string is what `buildVibeDirective` already knows how to steer.
 */
export const VIBE_CHIPS: readonly VibeChip[] = [
  {
    id: "late-night",
    label: "Late Night",
    vibe: "intimate, hushed, after-hours warmth — like a 3 AM drive-time host",
  },
  {
    id: "hype",
    label: "Hype",
    vibe: "big energy, fist-pump, like a peak-hour floor-filler set",
  },
  {
    id: "storyteller",
    label: "Storyteller",
    vibe: "narrative, set the scene, lean into the story behind the track",
  },
  {
    id: "deep-cuts",
    label: "Deep Cuts",
    vibe: "lean into the obscure, the B-sides, the forgotten takes",
  },
  {
    id: "front-porch",
    label: "Front Porch",
    vibe: "easygoing, conversational, like a friend on the porch",
  },
] as const;

/** Free teaser chip previews this Pro preset for 1–2 voiced breaks. */
export const FREE_VIBE_TEASER_CHIP_ID: VibeChipId = "late-night";

export function getVibeChip(id: VibeChipId): VibeChip | undefined {
  return VIBE_CHIPS.find((chip) => chip.id === id);
}

export function getFreeVibeTeaserChip(): VibeChip {
  return getVibeChip(FREE_VIBE_TEASER_CHIP_ID) ?? VIBE_CHIPS[0];
}

/**
 * Single-select replace: the chip whose vibe string matches `vibePrompt`.
 * Empty / custom text that does not match a preset → no chip active.
 */
export function resolveActiveVibeChipId(
  vibePrompt: string | undefined,
): VibeChipId | null {
  const vibe = sanitizeVibePrompt(vibePrompt);
  if (!vibe) return null;
  return VIBE_CHIPS.find((chip) => sanitizeVibePrompt(chip.vibe) === vibe)?.id ?? null;
}

/** Chip click → replace the custom text box with that chip's vibe string. */
export function selectVibeChip(chipId: VibeChipId): string {
  return sanitizeVibePrompt(getVibeChip(chipId)?.vibe);
}

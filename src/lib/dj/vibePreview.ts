/**
 * Session-scoped Free vibe-chip preview (WS-5).
 *
 * Independent of the WS-4 Roots & Branches `teaserSlotCount`. Lives in a
 * module-level window — never written to `stationConfigs.vibePrompt`, never
 * synced through `/api/user/sync`.
 *
 * When active, the prompt-build path reads this vibe and `clampHostTuningForTier`
 * allows it through via `vibePreviewActive`. After {@link VIBE_PREVIEW_VOICED_BREAKS}
 * voiced generations, the window clears and listeners are notified so Host
 * Studio can surface the existing upgrade modal.
 */

import { getFreeVibeTeaserChip } from "@/data/vibe-chips";
import { sanitizeVibePrompt } from "@/types/station";

/** Voiced breaks the Free teaser colours before reverting (1–2). */
export const VIBE_PREVIEW_VOICED_BREAKS = 2;

export type VibePreviewWindow = {
  vibe: string;
  remainingBreaks: number;
};

export type VibePreviewListener = (
  state: VibePreviewWindow | null,
  expired: boolean,
) => void;

let previewWindow: VibePreviewWindow | null = null;
const listeners = new Set<VibePreviewListener>();

function notify(expired: boolean): void {
  const snapshot = previewWindow;
  for (const listener of listeners) {
    listener(snapshot, expired);
  }
}

export function subscribeVibePreview(listener: VibePreviewListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function peekVibePreview(): VibePreviewWindow | null {
  return previewWindow;
}

export function isVibePreviewActive(): boolean {
  return previewWindow != null && previewWindow.remainingBreaks > 0;
}

export function startVibePreview(
  vibe: string = getFreeVibeTeaserChip().vibe,
  breaks: number = VIBE_PREVIEW_VOICED_BREAKS,
): VibePreviewWindow | null {
  const nextVibe = sanitizeVibePrompt(vibe);
  const remaining = Number.isFinite(breaks)
    ? Math.max(1, Math.min(2, Math.round(breaks)))
    : VIBE_PREVIEW_VOICED_BREAKS;
  if (!nextVibe) {
    previewWindow = null;
    notify(false);
    return null;
  }
  previewWindow = { vibe: nextVibe, remainingBreaks: remaining };
  notify(false);
  return previewWindow;
}

/**
 * Clear without firing the upgrade-nudge (`expired: false`).
 * Used on mid-session Pro → Free downgrade and explicit reset.
 */
export function clearVibePreview(): void {
  if (!previewWindow) return;
  previewWindow = null;
  notify(false);
}

/**
 * Count one voiced break against the preview window.
 * Hits zero → clears and notifies `expired: true` (upgrade nudge).
 */
export function consumeVibePreviewBreak(): {
  expired: boolean;
  remaining: number;
} {
  if (!previewWindow) return { expired: false, remaining: 0 };
  const remaining = previewWindow.remainingBreaks - 1;
  if (remaining <= 0) {
    previewWindow = null;
    notify(true);
    return { expired: true, remaining: 0 };
  }
  previewWindow = { ...previewWindow, remainingBreaks: remaining };
  notify(false);
  return { expired: false, remaining };
}

export type PromptVibeOverlay = {
  vibePrompt: string;
  vibePreviewActive: boolean;
};

/**
 * Prompt-build overlay. Pro always uses persisted `vibePrompt`.
 * Free uses the session preview when live; otherwise the persisted value
 * (which the Free clamp still strips unless `vibePreviewActive` is set).
 */
export function overlayVibePreviewOnPayload(
  persistedVibe: string | undefined,
  isPro: boolean,
): PromptVibeOverlay {
  if (isPro) {
    return {
      vibePrompt: sanitizeVibePrompt(persistedVibe),
      vibePreviewActive: false,
    };
  }
  if (previewWindow) {
    return {
      vibePrompt: sanitizeVibePrompt(previewWindow.vibe),
      vibePreviewActive: true,
    };
  }
  return {
    vibePrompt: sanitizeVibePrompt(persistedVibe),
    vibePreviewActive: false,
  };
}

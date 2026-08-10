"use client";

import { useEffect, useRef } from "react";

export type UseKeyboardShortcutsOptions = {
  /**
   * Tune the parked station on a 1-based memory dial slot (keys `1`–`6`).
   * No-op when the slot is empty — callers decide how to handle misses.
   */
  playMemorySlot: (slotIndex: number) => void;
  /** When false, the global listener is detached. Defaults to true. */
  enabled?: boolean;
};

/**
 * Globally registered digit hotkeys for memory presets 1–6.
 *
 * Strictly ignored while focus is inside an input, textarea, or contenteditable
 * so typing in Smart Search / Host Settings never hijacks the dial.
 */
export function useKeyboardShortcuts({
  playMemorySlot,
  enabled = true,
}: UseKeyboardShortcutsOptions): void {
  const playMemorySlotRef = useRef(playMemorySlot);
  playMemorySlotRef.current = playMemorySlot;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return; // Ignore hotkey while typing in search bar or input fields
      }

      if (e.key < "1" || e.key > "6") return;

      e.preventDefault();
      playMemorySlotRef.current(Number(e.key));
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

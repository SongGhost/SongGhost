"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useMemo } from "react";
import { useUserPreferences } from "@/context/UserPreferencesContext";
import type { MemoryPreset, MemoryPresetList } from "@/types/station";

export type UseMemoryPresetsResult = {
  presets: MemoryPresetList;
  /** False until auth + localStorage hydration finishes — do not persist defaults before this. */
  isHydrated: boolean;
  /** Clerk account id used for `songhost_presets_${userId}` storage. */
  userId: string | null | undefined;
  savePreset: (
    slot: number,
    preset: Omit<MemoryPreset, "slot" | "savedAt">,
  ) => void;
  /** Reset a dial slot (1–6) to empty (`---`) and persist. */
  clearPreset: (slotIndex: number) => void;
};

/**
 * Account-scoped memory dial (slots 1–6) with a hydration guard so the empty
 * default list cannot overwrite saved presets before async storage loads.
 */
export function useMemoryPresets(): UseMemoryPresetsResult {
  const { userId } = useAuth();
  const {
    memoryPresets,
    isHydrated,
    saveMemoryPreset,
    clearPreset: clearPresetSlot,
  } = useUserPreferences();

  const clearPreset = useCallback(
    (slotIndex: number) => {
      if (!isHydrated) return;
      clearPresetSlot(slotIndex);
    },
    [clearPresetSlot, isHydrated],
  );

  const savePreset = useCallback(
    (slot: number, preset: Omit<MemoryPreset, "slot" | "savedAt">) => {
      if (!isHydrated) return;
      saveMemoryPreset(slot, preset);
    },
    [isHydrated, saveMemoryPreset],
  );

  return useMemo(
    () => ({
      presets: memoryPresets,
      isHydrated,
      userId,
      savePreset,
      clearPreset,
    }),
    [memoryPresets, isHydrated, userId, savePreset, clearPreset],
  );
}

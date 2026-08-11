"use client";

import MemoryToolbar from "@/components/MemoryToolbar";
import type { MemoryPreset, MemoryPresetList } from "@/types/station";

export type MemoryDialBarProps = {
  presets: MemoryPresetList;
  activeStationId: string;
  onTune: (
    preset: MemoryPreset,
    e?: { preventDefault(): void; stopPropagation(): void },
  ) => void;
  onAssign: (slot: number) => void;
  onClear?: (slot: number) => void;
  canAssign: boolean;
  /**
   * When true, show the first-run helper above slot 1 — starter genre presets
   * were auto-parked and can be overwritten via Save.
   */
  starterPresetsActive?: boolean;
};

/**
 * Control-deck memory dials with optional starter-preset helper copy.
 */
export default function MemoryDialBar({
  presets,
  activeStationId,
  onTune,
  onAssign,
  onClear,
  canAssign,
  starterPresetsActive = false,
}: MemoryDialBarProps) {
  return (
    <div className="bg-transparent">
      {starterPresetsActive && (
        <p className="px-3 pb-0.5 font-sans text-[10px] leading-snug text-zinc-500 sm:px-4">
          Starter presets active. Click &apos;Save&apos; on any station to overwrite.
        </p>
      )}
      <MemoryToolbar
        presets={presets}
        activeStationId={activeStationId}
        onTune={onTune}
        onAssign={onAssign}
        onClear={onClear}
        canAssign={canAssign}
      />
    </div>
  );
}

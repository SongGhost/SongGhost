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
   * When true, show the first-run helper beside the Memory label — starter
   * genre presets were auto-parked and can be overwritten via Save.
   */
  starterPresetsActive?: boolean;
  /** Clerk user present — when false, slot/save clicks soft-gate to account creation. */
  isAuthenticated?: boolean;
  /** Soft gate — open onboarding Step 1 ("Create SongHost Account"). */
  onRequireAuth?: () => void;
};

const STARTER_PRESET_HINT =
  "Starter presets active. Click 'Save' on any station to overwrite.";

/**
 * Control-deck memory dials with optional starter-preset helper copy.
 * Unauthenticated slot / save clicks open the account soft gate.
 */
export default function MemoryDialBar({
  presets,
  activeStationId,
  onTune,
  onAssign,
  onClear,
  canAssign,
  starterPresetsActive = false,
  isAuthenticated = true,
  onRequireAuth,
}: MemoryDialBarProps) {
  const requireAccount = () => {
    onRequireAuth?.();
  };

  const gateTune = (
    preset: MemoryPreset,
    e?: { preventDefault(): void; stopPropagation(): void },
  ) => {
    if (!isAuthenticated) {
      e?.preventDefault();
      e?.stopPropagation();
      requireAccount();
      return;
    }
    onTune(preset, e);
  };

  const gateAssign = (slot: number) => {
    if (!isAuthenticated) {
      requireAccount();
      return;
    }
    onAssign(slot);
  };

  const gateClear = onClear
    ? (slot: number) => {
        if (!isAuthenticated) {
          requireAccount();
          return;
        }
        onClear(slot);
      }
    : undefined;

  return (
    <div className="bg-transparent">
      <MemoryToolbar
        presets={presets}
        activeStationId={activeStationId}
        onTune={gateTune}
        onAssign={gateAssign}
        onClear={gateClear}
        canAssign={isAuthenticated ? canAssign : true}
        headerHint={starterPresetsActive ? STARTER_PRESET_HINT : undefined}
      />
    </div>
  );
}

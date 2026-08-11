"use client";

import { Radio, Save, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getStationById } from "@/data/stations";
import { formatStationMetaTag } from "@/lib/station-meta";
import {
  MEMORY_PRESET_SLOTS,
  normalizeMemoryPresets,
  type MemoryPreset,
  type MemoryPresetList,
} from "@/types/station";

/** Hold time that turns a tune-in tap into a slot assignment. */
const LONG_PRESS_MS = 600;

/** How long the "saved to 3" confirmation stays on the button. */
const CONFIRM_MS = 1600;

type MemoryToolbarProps = {
  presets: MemoryPresetList;
  /** Station on air, so its parked slot can light up */
  activeStationId: string;
  /** Tune straight to a parked station */
  onTune: (
    preset: MemoryPreset,
    e?: { preventDefault(): void; stopPropagation(): void },
  ) => void;
  /** Park the live station on a slot — long-press, or the arm button then a tap */
  onAssign: (slot: number) => void;
  /** Clear a filled slot back to empty (`---`) */
  onClear?: (slot: number) => void;
  /** False when nothing is on air, which disables assignment entirely */
  canAssign: boolean;
  /** Optional helper shown beside the Memory label (e.g. starter presets). */
  headerHint?: string;
};

function presetSubtitle(preset: MemoryPreset): string {
  const station = getStationById(preset.stationId);
  if (station) return formatStationMetaTag(station);
  return "Saved";
}

export default function MemoryToolbar({
  presets,
  activeStationId,
  onTune,
  onAssign,
  onClear,
  canAssign,
  headerHint,
}: MemoryToolbarProps) {
  const slots = normalizeMemoryPresets(presets);

  /**
   * Assignment arming. Touch devices have no right-click and a long-press is
   * undiscoverable on its own, so the explicit toggle is the same action reached
   * a second way rather than a fallback.
   */
  const [armed, setArmed] = useState(false);
  const [confirmedSlot, setConfirmedSlot] = useState<number | null>(null);

  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set by the long-press timer so the click that follows the release is swallowed. */
  const longPressFiredRef = useRef(false);

  useEffect(
    () => () => {
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!canAssign) setArmed(false);
  }, [canAssign]);

  const assign = useCallback(
    (slot: number) => {
      if (!canAssign) return;
      onAssign(slot);
      setArmed(false);
      setConfirmedSlot(slot);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => setConfirmedSlot(null), CONFIRM_MS);
    },
    [canAssign, onAssign],
  );

  const cancelPress = useCallback(() => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  }, []);

  const startPress = useCallback(
    (slot: number) => {
      if (!canAssign) return;
      longPressFiredRef.current = false;
      cancelPress();
      pressTimerRef.current = setTimeout(() => {
        pressTimerRef.current = null;
        longPressFiredRef.current = true;
        assign(slot);
      }, LONG_PRESS_MS);
    },
    [assign, canAssign, cancelPress],
  );

  const handleClick = useCallback(
    (
      slot: number,
      preset: MemoryPreset | null,
      e?: { preventDefault(): void; stopPropagation(): void },
    ) => {
      e?.preventDefault();
      e?.stopPropagation();
      cancelPress();
      if (longPressFiredRef.current) {
        longPressFiredRef.current = false;
        return;
      }
      if (armed) {
        assign(slot);
        return;
      }
      // An empty slot has nothing to tune to, so a plain tap parks the live
      // station on it rather than doing nothing at all.
      if (!preset) {
        assign(slot);
        return;
      }
      onTune(preset, e);
    },
    [armed, assign, cancelPress, onTune],
  );

  return (
    <div className="bg-transparent">
      {headerHint && (
        <p className="mx-auto max-w-6xl px-3 pt-1 text-right text-xs text-slate-400 sm:hidden">
          {headerHint}
        </p>
      )}
      <div className="mx-auto flex max-w-6xl items-center gap-1.5 px-3 py-1 sm:gap-3 sm:px-4 sm:py-2">
        <div className="hidden min-w-0 shrink items-center gap-2 sm:flex">
          <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            <Radio className="h-3 w-3" aria-hidden="true" />
            Memory
          </span>
          {headerHint && (
            <span
              className="max-w-[14rem] truncate text-xs text-slate-400 lg:max-w-none"
              title={headerHint}
            >
              {headerHint}
            </span>
          )}
        </div>

        <div
          className="no-scrollbar min-w-0 flex-1 overflow-x-auto"
          role="group"
          aria-label="Station memory presets"
        >
          <div className="flex flex-nowrap items-stretch gap-1 sm:gap-2">
            {MEMORY_PRESET_SLOTS.map((slot) => {
              const preset = slots[slot - 1];
              const isActive = Boolean(preset && preset.stationId === activeStationId);
              const isConfirmed = confirmedSlot === slot;

              return (
                <div
                  key={slot}
                  className={`group relative min-w-[72px] shrink-0 sm:min-w-0 sm:flex-1 ${
                    preset && onClear ? "pr-0" : ""
                  }`}
                >
                  <button
                    type="button"
                    onPointerDown={() => startPress(slot)}
                    onPointerUp={cancelPress}
                    onPointerLeave={cancelPress}
                    onPointerCancel={cancelPress}
                    onContextMenu={(e) => {
                      if (!canAssign) return;
                      e.preventDefault();
                      assign(slot);
                    }}
                    onClick={(e) => handleClick(slot, preset, e)}
                    aria-pressed={isActive}
                    title={
                      preset
                        ? `${preset.stationName} — tap to tune, hold to overwrite`
                        : "Empty preset — tap to park the current station here"
                    }
                    className={`flex w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-left transition-all active:scale-[0.97] sm:gap-2 sm:px-2 sm:py-1.5 ${
                      armed
                        ? "border-accent/70 bg-accent/10"
                        : isActive
                          ? "border-accent/60 bg-[#121215] shadow-[0_0_14px_rgba(41, 146, 207,0.25)]"
                          : "border-white/[0.08] bg-[#121215]/60 hover:border-white/[0.14] hover:bg-[#121215]"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-bold tabular-nums transition-colors sm:h-6 sm:w-6 sm:text-[11px] ${
                        isActive
                          ? "bg-accent text-zinc-950"
                          : preset
                            ? "bg-zinc-800 text-accent group-hover:bg-zinc-700"
                            : "bg-zinc-800/70 text-zinc-500"
                      }`}
                      style={
                        isActive || !preset ? undefined : { color: preset.accentColor }
                      }
                    >
                      {slot}
                    </span>

                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span
                        className={`truncate font-sans text-[10px] sm:text-[11px] ${
                          preset ? "text-zinc-200" : "text-zinc-600 italic"
                        }`}
                      >
                        {isConfirmed ? "Saved" : (preset?.stationName ?? "Empty")}
                      </span>
                      <span className="hidden truncate font-mono text-[9px] uppercase tracking-wider text-zinc-500 sm:inline">
                        {preset ? presetSubtitle(preset) : "— — —"}
                      </span>
                    </span>

                    <span className="sr-only">
                      {preset
                        ? `Preset ${slot}: ${preset.stationName}`
                        : `Preset ${slot} is empty`}
                    </span>
                  </button>

                  {preset && onClear && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onClear(slot);
                      }}
                      className="absolute right-1 top-1 z-10 rounded p-0.5 text-zinc-500 opacity-0 transition-opacity hover:bg-zinc-800 hover:text-zinc-200 group-hover:opacity-100 focus-visible:opacity-100"
                      title={`Clear preset ${slot}`}
                      aria-label={`Clear memory preset ${slot}`}
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setArmed((value) => !value)}
          disabled={!canAssign}
          aria-pressed={armed}
          className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors disabled:pointer-events-none disabled:opacity-30 sm:py-1.5 ${
            armed
              ? "border-accent bg-accent text-zinc-950"
              : "border-white/[0.08] bg-[#121215]/60 text-zinc-400 hover:border-accent/50 hover:text-accent"
          }`}
          title={
            canAssign
              ? "Save the current station to a preset — then pick a slot"
              : "Tune in to a station first"
          }
        >
          <Save className="h-3 w-3" aria-hidden="true" />
          <span className="hidden sm:inline">{armed ? "Pick a slot" : "Save"}</span>
        </button>
      </div>
    </div>
  );
}

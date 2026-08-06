"use client";

import { Mic2, MicOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  CHATTER_PACING_OPTIONS,
  getChatterPacingProfile,
  type ChatterPacing,
} from "@/types/station";

type ChatterPacingPillProps = {
  value: ChatterPacing;
  onChange: (pacing: ChatterPacing) => void;
  /** True when this pacing came from a station override rather than the global default */
  isStationOverride?: boolean;
  /**
   * When set, the badge opens the DJ Tuning Console instead of the inline
   * pacing menu (used by the ControlDeck Talkative / Standard badge).
   */
  onOpenSettings?: () => void;
  className?: string;
};

/**
 * Mid-session DJ talk-density control, parked next to the now-playing host badge.
 * Pacing changes land on the very next transition, so this is a live adjustment
 * rather than something that needs a re-tune.
 */
export default function ChatterPacingPill({
  value,
  onChange,
  isStationOverride,
  onOpenSettings,
  className = "",
}: ChatterPacingPillProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const profile = getChatterPacingProfile(value);
  const opensTuningConsole = Boolean(onOpenSettings);

  useEffect(() => {
    if (!open || opensTuningConsole) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, opensTuningConsole]);

  const Icon = profile.muted ? MicOff : Mic2;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => {
          if (onOpenSettings) {
            onOpenSettings();
            return;
          }
          setOpen((prev) => !prev);
        }}
        aria-expanded={opensTuningConsole ? undefined : open}
        aria-haspopup={opensTuningConsole ? "dialog" : "listbox"}
        aria-label={
          opensTuningConsole
            ? `DJ chatter: ${profile.label}. Open tuning console.`
            : `DJ chatter: ${profile.label}. Activate to change.`
        }
        className={`flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${
          profile.muted
            ? "border-zinc-700 bg-zinc-900/80 text-zinc-500 hover:text-zinc-300"
            : "border-amber-500/30 bg-amber-500/10 text-amber-400 hover:border-amber-500/60"
        }`}
      >
        <Icon className="h-2.5 w-2.5" aria-hidden="true" />
        {profile.shortLabel}
        {isStationOverride && (
          <span
            aria-hidden="true"
            className="ml-0.5 h-1 w-1 rounded-full bg-current opacity-70"
            title="Set for this station"
          />
        )}
      </button>

      {!opensTuningConsole && open && (
        <div
          role="listbox"
          aria-label="DJ chatter pacing"
          className="absolute left-0 top-full z-50 mt-1.5 w-60 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/95 shadow-2xl backdrop-blur-md"
        >
          <p className="border-b border-zinc-800 px-3 py-2 font-mono text-[9px] uppercase tracking-widest text-zinc-500">
            DJ Chatter
          </p>
          {CHATTER_PACING_OPTIONS.map((option) => {
            const isSelected = option.id === value;
            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
                className={`block w-full px-3 py-2 text-left transition-colors ${
                  isSelected ? "bg-amber-500/10" : "hover:bg-zinc-900"
                }`}
              >
                <span
                  className={`block font-sans text-xs font-medium ${
                    isSelected ? "text-amber-400" : "text-zinc-200"
                  }`}
                >
                  {option.label}
                </span>
                <span className="mt-0.5 block font-sans text-[10px] leading-snug text-zinc-500">
                  {option.description}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

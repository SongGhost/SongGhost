"use client";

import { Volume2 } from "lucide-react";

type VolumeKnobProps = {
  value: number;
  onChange: (value: number) => void;
  deck?: boolean;
};

export default function VolumeKnob({ value, onChange, deck }: VolumeKnobProps) {
  const percent = Math.round(value * 100);
  const sweep = Math.max(8, value * 270);
  const dialSize = deck ? "h-12 w-12 md:h-14 md:w-14" : "h-16 w-16 sm:h-20 sm:w-20";

  return (
    <div className={`flex flex-col items-center ${deck ? "gap-1" : "gap-1.5 sm:gap-3"}`}>
      <div className="flex items-center gap-1.5 text-[10px] sm:text-xs tracking-widest text-amber-200/60 uppercase">
        <Volume2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        <span className="hidden md:inline">Master Volume</span>
        <span className="md:hidden">Vol</span>
      </div>
      <div className="relative flex items-center gap-2 md:gap-3">
        <div className={`relative ${dialSize}`}>
          <div
            className="volume-dial-ring absolute inset-0 rounded-full"
            style={{
              background: `conic-gradient(from 225deg, var(--station-accent, var(--color-gold)) 0deg, var(--station-accent, var(--color-gold)) ${sweep}deg, rgba(255,255,255,0.06) ${sweep}deg 270deg, transparent 270deg)`,
              boxShadow: `0 0 ${8 + value * 20}px color-mix(in srgb, var(--station-accent, var(--color-gold)) ${Math.round(value * 45)}%, transparent)`,
            }}
          />
          <div className="volume-dial-core absolute inset-[3px] md:inset-1 rounded-full flex items-center justify-center">
            <span className="text-[10px] md:text-xs font-bold tabular-nums text-amber-100/90">
              {percent}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={percent}
            onChange={(e) => onChange(Number(e.target.value) / 100)}
            className="knob-input absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label="Master volume dial"
          />
        </div>
        <div className={`volume-slider flex-1 ${deck ? "min-w-[64px] md:min-w-[80px]" : "min-w-[80px] sm:min-w-[120px]"}`}>
          <input
            type="range"
            min={0}
            max={100}
            value={percent}
            onChange={(e) => onChange(Number(e.target.value) / 100)}
            className="volume-range w-full"
            aria-label="Volume slider"
          />
        </div>
      </div>
    </div>
  );
}

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
    <div className={`flex flex-col items-center ${deck ? "gap-2" : "gap-1.5 sm:gap-3"}`}>
      <span className="chassis-badge mb-0 flex items-center gap-1.5">
        <Volume2 className="h-3 w-3" />
        Master Volume
      </span>
      <div className="relative flex items-center gap-2 md:gap-3">
        <div className={`relative ${dialSize}`}>
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: `conic-gradient(from 225deg, #d97706 0deg, #d97706 ${sweep}deg, #d6d3d1 ${sweep}deg 270deg, transparent 270deg)`,
              boxShadow: `0 2px 8px rgba(217,119,6,${0.12 + value * 0.18})`,
            }}
          />
          <div className="absolute inset-[3px] md:inset-1 rounded-full bg-[#FAF7EE] border border-[#D8CFC2] flex items-center justify-center shadow-inner pointer-events-none">
            <Volume2 className="h-3 w-3 text-stone-400" aria-hidden="true" />
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={percent}
            onChange={(e) => onChange(Number(e.target.value) / 100)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label="Master volume dial"
          />
        </div>
        <div
          className={`flex flex-col gap-1.5 ${deck ? "min-w-[64px] md:min-w-[80px]" : "min-w-[80px] sm:min-w-[120px]"}`}
        >
          <span className="bg-stone-900 text-amber-400 font-mono text-xs font-bold px-2.5 py-1 rounded-md shadow-sm tabular-nums self-start">
            {percent}
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={percent}
            onChange={(e) => onChange(Number(e.target.value) / 100)}
            className="volume-range w-full accent-amber-600 h-1.5 rounded-lg"
            aria-label="Volume slider"
          />
        </div>
      </div>
    </div>
  );
}

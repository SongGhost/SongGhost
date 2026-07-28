"use client";

import { Volume2 } from "lucide-react";

type VolumeKnobProps = {
  value: number;
  onChange: (value: number) => void;
};

export default function VolumeKnob({ value, onChange }: VolumeKnobProps) {
  const rotation = value * 270 - 135;

  return (
    <div className="flex flex-col items-center gap-1.5 sm:gap-3">
      <div className="flex items-center gap-1.5 text-[10px] sm:text-xs tracking-widest text-amber-200/60 uppercase">
        <Volume2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        <span className="hidden xs:inline">Master Volume</span>
        <span className="xs:hidden">Vol</span>
      </div>
      <div className="relative flex items-center gap-3 sm:gap-6">
        <div className="relative h-14 w-14 sm:h-20 sm:w-20">
          <div className="absolute inset-0 rounded-full knob-face border-2 border-zinc-600" />
          <div
            className="absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-full rounded-full bg-amber-300 origin-bottom"
            style={{ transform: `translateX(-50%) translateY(-50%) rotate(${rotation}deg)` }}
          />
          <div className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-500 border border-zinc-400" />
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(value * 100)}
            onChange={(e) => onChange(Number(e.target.value) / 100)}
            className="knob-input absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label="Master volume"
          />
        </div>
        <div className="volume-slider flex-1 min-w-[80px] sm:min-w-[120px]">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(value * 100)}
            onChange={(e) => onChange(Number(e.target.value) / 100)}
            className="volume-range w-full"
            aria-label="Volume slider"
          />
          <p className="mt-1 text-center text-sm text-amber-200/70 tabular-nums">
            {Math.round(value * 100)}%
          </p>
        </div>
      </div>
    </div>
  );
}

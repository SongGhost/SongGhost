"use client";

import { Pause, Play, SkipBack, SkipForward } from "lucide-react";

type TransportControlsProps = {
  isPlaying: boolean;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  disablePrev?: boolean;
  disableNext?: boolean;
};

export default function TransportControls({
  isPlaying,
  onPlayPause,
  onPrev,
  onNext,
  disablePrev = false,
  disableNext = false,
}: TransportControlsProps) {
  const secondaryClass =
    "bg-white hover:bg-zinc-100 text-stone-800 border border-[#D2C5B4] rounded-full p-3 shadow-sm transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white";

  return (
    <div className="flex items-center justify-center gap-3 sm:gap-4 shrink-0">
      <button
        type="button"
        onClick={onPrev}
        disabled={disablePrev}
        className={secondaryClass}
        aria-label="Previous track"
      >
        <SkipBack className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={onPlayPause}
        className="bg-accent hover:bg-accent-hover text-stone-950 rounded-full p-4 font-bold shadow-[0_4_14px_var(--brand-accent-glow)] transition-all active:scale-95"
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? (
          <Pause className="h-7 w-7" />
        ) : (
          <Play className="h-7 w-7 ml-0.5" />
        )}
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={disableNext}
        className={secondaryClass}
        aria-label="Next track"
      >
        <SkipForward className="h-5 w-5" />
      </button>
    </div>
  );
}

"use client";

import { Pause, Play, SkipBack, SkipForward } from "lucide-react";

type TransportControlsProps = {
  isPlaying: boolean;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
};

export default function TransportControls({
  isPlaying,
  onPlayPause,
  onPrev,
  onNext,
}: TransportControlsProps) {
  return (
    <div className="flex items-center justify-center gap-4 md:gap-6">
      <button
        type="button"
        onClick={onPrev}
        className="analog-btn group"
        aria-label="Previous track"
      >
        <SkipBack className="h-5 w-5 group-active:scale-95 transition-transform" />
      </button>
      <button
        type="button"
        onClick={onPlayPause}
        className="analog-btn analog-btn-primary group"
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? (
          <Pause className="h-7 w-7 group-active:scale-95 transition-transform" />
        ) : (
          <Play className="h-7 w-7 ml-0.5 group-active:scale-95 transition-transform" />
        )}
      </button>
      <button
        type="button"
        onClick={onNext}
        className="analog-btn group"
        aria-label="Next track"
      >
        <SkipForward className="h-5 w-5 group-active:scale-95 transition-transform" />
      </button>
    </div>
  );
}

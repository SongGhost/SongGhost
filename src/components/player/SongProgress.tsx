"use client";

import type { CSSProperties } from "react";
import { seekPlayback, usePlaybackProgress } from "@/components/player/playbackProgress";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

type SongProgressProps = {
  className?: string;
  /** Amber readouts for the Drive mode screen. */
  tone?: "accent" | "amber";
};

/**
 * Elapsed time, duration, and scrubber. Reads the playhead the audio engine
 * publishes, so the dock, the expanded phone player, and Drive mode stay in step
 * without moving the YouTube host.
 */
export default function SongProgress({ className = "", tone = "accent" }: SongProgressProps) {
  const { time, duration } = usePlaybackProgress();
  const max = duration > 0 ? duration : 1;
  const value = duration > 0 ? time : 0;
  const label = `${formatTime(time)} of ${formatTime(duration)}`;

  return (
    <div
      className={`song-progress w-full max-w-full min-w-0 space-y-1 overflow-hidden ${className}`}
      style={
        tone === "amber"
          ? ({
              "--brand-accent": "#fbbf24",
              "--brand-accent-glow": "rgba(251, 191, 36, 0.35)",
            } as CSSProperties)
          : undefined
      }
    >
      <div
        className={`flex items-center justify-between font-mono text-xs font-bold tabular-nums ${
          tone === "amber" ? "text-amber-200" : "text-accent"
        }`}
      >
        <span>{formatTime(time)}</span>
        <span>{formatTime(duration)}</span>
      </div>
      <div className="relative w-full max-w-full overflow-hidden rounded-full">
        <input
          type="range"
          min={0}
          max={max}
          step={0.5}
          value={value}
          disabled={duration <= 0}
          onChange={(event) => seekPlayback(Number(event.target.value))}
          className="song-progress-slider block w-full max-w-full"
          aria-label="Song progress"
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={label}
        />
      </div>
    </div>
  );
}

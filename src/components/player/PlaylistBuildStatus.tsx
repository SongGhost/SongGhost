"use client";

import { useEffect, useMemo, useState } from "react";
import {
  playlistBarPercent,
  playlistStageCopy,
  shufflePlaylistLines,
  type PlaylistBuildUpdate,
} from "@/lib/station/playlist-progress";

const LINE_MS = 3200;

/**
 * Shown while a station playlist is being built.
 * The stage and song count come from the build. The lines rotate so the wait does not feel stuck.
 */
export default function PlaylistBuildStatus({
  progress,
}: {
  progress?: PlaylistBuildUpdate | null;
}) {
  const stage = progress?.stage === "songs" || progress?.stage === "polish"
    ? progress.stage
    : "lineup";
  const songs = progress?.songs ?? 0;
  const percent = playlistBarPercent(stage, songs);
  const stageCopy = playlistStageCopy(stage, songs);
  const deck = useMemo(() => shufflePlaylistLines(Date.now()), []);
  const [lineIndex, setLineIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setLineIndex((current) => (current + 1) % deck.length);
    }, LINE_MS);
    return () => window.clearInterval(id);
  }, [deck]);

  const line = deck[lineIndex] ?? deck[0];

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-4 px-4 py-8 text-center">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
        Building the playlist
      </p>
      <p className="font-sans text-sm font-medium text-zinc-800" role="status">
        {stageCopy}
      </p>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-[#E7E0D4]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={stageCopy}
      >
        <div
          className={`h-full rounded-full bg-accent shadow-[0_0_12px_rgba(196,136,42,0.45)] transition-[width] duration-500 ${
            songs === 0 && stage !== "polish" ? "animate-pulse" : ""
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p
        className="min-h-10 font-sans text-sm text-zinc-600"
        aria-live="polite"
      >
        {line}
      </p>
    </div>
  );
}

"use client";

import { Ban, ThumbsUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type TrackFeedbackControlsProps = {
  /** Hides the cluster entirely when nothing is on air. */
  trackId: string;
  artist: string;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onBanTrack: () => void;
  onBanArtist: () => void;
};

const BUTTON_CLASS =
  "rounded-full border border-zinc-800 bg-zinc-900/70 p-2 text-zinc-400 transition-colors hover:border-accent/50 hover:text-accent active:scale-95";

/**
 * Thumbs up and ban, for the track on air.
 *
 * The ban asks which scope before it commits. A blacklist entry survives every
 * future session and silently shrinks the catalog, so it is the one control on
 * the deck where a mis-tap has consequences the listener cannot see — and
 * "this song" versus "this artist" is not a distinction a single icon can make.
 */
export default function TrackFeedbackControls({
  trackId,
  artist,
  isFavorite,
  onToggleFavorite,
  onBanTrack,
  onBanArtist,
}: TrackFeedbackControlsProps) {
  const [scopeOpen, setScopeOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scopeOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setScopeOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setScopeOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [scopeOpen]);

  if (!trackId) return null;

  const commit = (ban: () => void) => {
    setScopeOpen(false);
    ban();
  };

  return (
    <div ref={wrapperRef} className="relative flex items-center gap-1.5">
      <button
        type="button"
        onClick={onToggleFavorite}
        className={
          isFavorite
            ? "rounded-full border border-accent/60 bg-accent/15 p-2 text-accent transition-colors active:scale-95"
            : BUTTON_CLASS
        }
        aria-pressed={isFavorite}
        aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
        title={isFavorite ? "Favorited" : "Favorite this track"}
      >
        <ThumbsUp className={`h-3.5 w-3.5 ${isFavorite ? "fill-accent" : ""}`} />
      </button>

      <button
        type="button"
        onClick={() => setScopeOpen((open) => !open)}
        className={
          scopeOpen
            ? "rounded-full border border-red-500/60 bg-red-500/15 p-2 text-red-400 transition-colors active:scale-95"
            : `${BUTTON_CLASS} hover:border-red-500/50 hover:text-red-400`
        }
        aria-expanded={scopeOpen}
        aria-haspopup="menu"
        aria-label="Never play this again"
        title="Never play this again"
      >
        <Ban className="h-3.5 w-3.5" />
      </button>

      {scopeOpen && (
        <div
          role="menu"
          aria-label="Ban scope"
          className="absolute right-0 top-full z-50 mt-2 w-48 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/95 shadow-2xl backdrop-blur-md"
        >
          <p className="border-b border-zinc-800 px-3 py-2 font-mono text-[9px] uppercase tracking-widest text-zinc-500">
            Never play again
          </p>
          <button
            type="button"
            role="menuitem"
            onClick={() => commit(onBanTrack)}
            className="block w-full px-3 py-2 text-left font-sans text-xs text-zinc-300 transition-colors hover:bg-red-500/10 hover:text-red-400"
          >
            This song
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => commit(onBanArtist)}
            className="block w-full border-t border-zinc-800/70 px-3 py-2 text-left font-sans text-xs text-zinc-300 transition-colors hover:bg-red-500/10 hover:text-red-400"
          >
            <span className="block">Anything by</span>
            <span className="block truncate font-mono text-[10px] text-zinc-500">
              {artist || "this artist"}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

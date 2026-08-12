"use client";

import { Ban, ThumbsUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Tooltip from "@/components/ui/Tooltip";
import type { TrackPreferenceTab } from "@/hooks/useTrackPreferences";

type TrackFeedbackControlsProps = {
  /** Hides the cluster entirely when nothing is on air. */
  trackId: string;
  artist: string;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onBanTrack: () => void;
  onBanArtist: () => void;
  /** Long-press / right-click opens the preference drawer on the given tab. */
  onOpenPreferences?: (tab: TrackPreferenceTab) => void;
};

const BUTTON_CLASS =
  "rounded-full border border-zinc-800 bg-zinc-900/70 p-2 text-zinc-400 transition-colors hover:border-accent/50 hover:text-accent active:scale-95";

/** Hold duration that opens the preference drawer instead of the short-click action. */
const LONG_PRESS_MS = 500;

/**
 * Thumbs up and ban, for the track on air.
 *
 * Short click likes or opens the ban-scope menu. Long-press / right-click opens
 * the liked or blocked preference drawer so the listener can manage the list.
 */
export default function TrackFeedbackControls({
  trackId,
  artist,
  isFavorite,
  onToggleFavorite,
  onBanTrack,
  onBanArtist,
  onOpenPreferences,
}: TrackFeedbackControlsProps) {
  const [scopeOpen, setScopeOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const likePressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const banPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const likeLongPressFiredRef = useRef(false);
  const banLongPressFiredRef = useRef(false);

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

  useEffect(
    () => () => {
      if (likePressTimerRef.current) clearTimeout(likePressTimerRef.current);
      if (banPressTimerRef.current) clearTimeout(banPressTimerRef.current);
    },
    [],
  );

  if (!trackId) return null;

  const clearLikePress = () => {
    if (likePressTimerRef.current) {
      clearTimeout(likePressTimerRef.current);
      likePressTimerRef.current = null;
    }
  };

  const clearBanPress = () => {
    if (banPressTimerRef.current) {
      clearTimeout(banPressTimerRef.current);
      banPressTimerRef.current = null;
    }
  };

  const openLikedDrawer = () => {
    likeLongPressFiredRef.current = true;
    clearLikePress();
    setScopeOpen(false);
    onOpenPreferences?.("LIKED TRACKS");
  };

  const openBlockedDrawer = () => {
    banLongPressFiredRef.current = true;
    clearBanPress();
    setScopeOpen(false);
    onOpenPreferences?.("BLOCKED TRACKS & ARTISTS");
  };

  const startLikePress = () => {
    if (!onOpenPreferences) return;
    likeLongPressFiredRef.current = false;
    clearLikePress();
    likePressTimerRef.current = setTimeout(openLikedDrawer, LONG_PRESS_MS);
  };

  const startBanPress = () => {
    if (!onOpenPreferences) return;
    banLongPressFiredRef.current = false;
    clearBanPress();
    banPressTimerRef.current = setTimeout(openBlockedDrawer, LONG_PRESS_MS);
  };

  const commit = (ban: () => void) => {
    setScopeOpen(false);
    ban();
  };

  return (
    <div ref={wrapperRef} className="relative flex items-center gap-1.5">
      <Tooltip content="Favorite Track — Click to like. Long-press to view and manage liked tracks.">
        <button
          type="button"
          onMouseDown={startLikePress}
          onMouseUp={clearLikePress}
          onMouseLeave={clearLikePress}
          onTouchStart={startLikePress}
          onTouchEnd={clearLikePress}
          onTouchCancel={clearLikePress}
          onContextMenu={(event) => {
            if (!onOpenPreferences) return;
            event.preventDefault();
            openLikedDrawer();
          }}
          onClick={() => {
            clearLikePress();
            if (likeLongPressFiredRef.current) {
              likeLongPressFiredRef.current = false;
              return;
            }
            onToggleFavorite();
          }}
          className={
            isFavorite
              ? "rounded-full border border-accent/60 bg-accent/15 p-2 text-accent transition-colors active:scale-95"
              : BUTTON_CLASS
          }
          aria-pressed={isFavorite}
          aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
        >
          <ThumbsUp className={`h-3.5 w-3.5 ${isFavorite ? "fill-accent" : ""}`} />
        </button>
      </Tooltip>

      <Tooltip content="Block Track — Click to ban from station. Long-press to view and manage block list.">
        <button
          type="button"
          onMouseDown={startBanPress}
          onMouseUp={clearBanPress}
          onMouseLeave={clearBanPress}
          onTouchStart={startBanPress}
          onTouchEnd={clearBanPress}
          onTouchCancel={clearBanPress}
          onContextMenu={(event) => {
            if (!onOpenPreferences) return;
            event.preventDefault();
            openBlockedDrawer();
          }}
          onClick={() => {
            clearBanPress();
            if (banLongPressFiredRef.current) {
              banLongPressFiredRef.current = false;
              return;
            }
            setScopeOpen((open) => !open);
          }}
          className={
            scopeOpen
              ? "rounded-full border border-red-500/60 bg-red-500/15 p-2 text-red-400 transition-colors active:scale-95"
              : `${BUTTON_CLASS} hover:border-red-500/50 hover:text-red-400`
          }
          aria-expanded={scopeOpen}
          aria-haspopup="menu"
          aria-label="Never play this again"
        >
          <Ban className="h-3.5 w-3.5" />
        </button>
      </Tooltip>

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

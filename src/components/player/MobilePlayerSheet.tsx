"use client";

import { ChevronDown, Pause, Play, Radio, Volume2 } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import TrackMetadata from "@/components/player/TrackMetadata";
import WebPlayer from "@/components/player/WebPlayer";
import TransportControls from "@/components/TransportControls";

/**
 * Full-screen "now playing" sheet for viewports under 768px, plus the
 * docked mini-bar that expands into it.
 *
 * `children` is the audio engine's own render slot — the same one
 * `ControlDeck` exposes on desktop — so the hidden YouTube host and the seek
 * bar it renders stay mounted once, in the sheet body, for the life of the
 * session. The mini-bar never renders `children` itself: doing so would mount
 * a second copy of that host and split the broadcast engine across two DOM
 * nodes. Expand/collapse is therefore a transform on an always-mounted panel,
 * never a conditional unmount, which is what keeps a swipe from tearing down
 * playback.
 */

const DRAG_DISMISS_PX = 120;
/** px/ms — a fast downward flick dismisses well short of the distance threshold. */
const DRAG_DISMISS_VELOCITY = 0.5;
const SHEET_TRANSITION = "transform 320ms cubic-bezier(0.32, 0.72, 0, 1)";

type DragState = {
  startY: number;
  startTime: number;
  lastY: number;
  lastTime: number;
};

export type MobilePlayerSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accentColor: string;
  title: string;
  artist: string;
  /** Album name from the active track or station.albumContext.albumTitle */
  album?: string | null;
  albumArt: string;
  /** No station session — mini-bar stays hidden entirely. */
  idle: boolean;
  stationName?: string;
  personaName?: string;
  /** Clean `[GENRE • ERA]` tag — replaces FM dial readouts */
  stationMetaTag?: string;
  isPlaying: boolean;
  onPlayPause: () => void;
  onPrev: () => void;
  disablePrev?: boolean;
  disableNext?: boolean;
  onNext: () => void;
  volume: number;
  onVolumeChange: (value: number) => void;
  /** Favorite/ban cluster, rendered above the transport row when expanded. */
  trackActions?: ReactNode;
  /** Host Studio / Host Controls bar, rendered below track actions when expanded. */
  hostControlsSlot?: ReactNode;
  /** Audio engine's hidden video host + seek progress bar. */
  children?: ReactNode;
  /**
   * Docked bottom mini-bar that expands into the sheet. When the sticky
   * ControlDeck already owns the compact chrome, leave this false so the
   * two surfaces do not fight for the same tap targets.
   */
  showMiniBar?: boolean;
};

export default function MobilePlayerSheet({
  open,
  onOpenChange,
  accentColor,
  title,
  artist,
  album = null,
  albumArt,
  idle,
  stationName,
  isPlaying,
  onPlayPause,
  onPrev,
  onNext,
  disablePrev = false,
  disableNext = false,
  volume,
  onVolumeChange,
  trackActions,
  hostControlsSlot,
  children,
  showMiniBar = true,
}: MobilePlayerSheetProps) {
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const hasArt = Boolean(albumArt?.trim());

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  // Body scroll is locked for the sheet's own lifetime, not just while a drag
  // is live — a background scroll reaching its own end would otherwise be
  // free to chain into the pull-to-refresh gesture the sheet exists to avoid.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  // A collapse from anywhere else (e.g. the listener hits a preset button)
  // must not leave a half-completed drag offset behind on the next open.
  useEffect(() => {
    if (!open) {
      dragRef.current = null;
      setIsDragging(false);
      setDragY(0);
    }
  }, [open]);

  const handleDragStart = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragRef.current = {
      startY: event.clientY,
      startTime: event.timeStamp,
      lastY: event.clientY,
      lastTime: event.timeStamp,
    };
    setIsDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const handleDragMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state) return;
    const delta = event.clientY - state.startY;
    state.lastY = event.clientY;
    state.lastTime = event.timeStamp;
    // Only tracks a downward pull — dismissal is one-directional, and letting
    // an upward move go negative would rubber-band the sheet past its own top.
    setDragY(Math.max(0, delta));
  }, []);

  const endDrag = useCallback(() => {
    const state = dragRef.current;
    if (!state) return;
    const elapsedMs = Math.max(1, state.lastTime - state.startTime);
    const velocity = (state.lastY - state.startY) / elapsedMs;
    const shouldDismiss = dragY > DRAG_DISMISS_PX || velocity > DRAG_DISMISS_VELOCITY;

    dragRef.current = null;
    setIsDragging(false);
    setDragY(0);

    if (shouldDismiss) close();
  }, [dragY, close]);

  const sheetTransform = open ? `translateY(${dragY}px)` : "translateY(100%)";

  return (
    <div className="md:hidden">
      {/* Docked mini-bar. Its own opacity/pointer-events, not a conditional
          unmount, so the sheet beneath it — and the audio host inside —
          never leaves the DOM while the listener is toggling between them. */}
      {showMiniBar && !idle && (
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          aria-label="Expand now playing"
          aria-hidden={open}
          style={{
            "--station-accent": accentColor,
            opacity: open ? 0 : 1,
            pointerEvents: open ? "none" : "auto",
          } as React.CSSProperties}
          className="fixed inset-x-0 bottom-0 z-40 flex w-full items-center gap-3 border-t border-zinc-800/80 bg-zinc-950/95 px-3 py-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] text-left backdrop-blur-md transition-opacity duration-200 active:bg-zinc-900/95"
        >
          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
            {hasArt ? (
              <Image src={albumArt} alt="" fill sizes="40px" className="object-cover" unoptimized />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Radio className="h-4 w-4 text-zinc-600" aria-hidden="true" />
              </div>
            )}
          </div>
          <TrackMetadata
            title={title}
            artist={artist}
            album={album}
            className="flex-1"
          />
          <div
            onClick={(event) => {
              event.stopPropagation();
              onPlayPause();
            }}
            role="button"
            tabIndex={0}
            aria-label={isPlaying ? "Pause" : "Play"}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onPlayPause();
              }
            }}
            className="flex shrink-0 items-center justify-center rounded-full bg-accent p-2.5 text-zinc-950 shadow-[0_2px_10px_var(--brand-accent-glow)] transition-colors hover:bg-accent-hover active:scale-95"
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Play className="h-4 w-4 translate-x-px" aria-hidden="true" />
            )}
          </div>
        </button>
      )}

      {/* Backdrop. Purely a dimmer — closing it collapses the sheet rather
          than unmounting it. */}
      <button
        type="button"
        onClick={close}
        aria-hidden="true"
        tabIndex={-1}
        style={{ opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none" }}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
      />

      {/* The sheet itself. Always mounted — collapsed state is a 100% Y
          translate, not a return null, so `children` (the hidden video host)
          is never torn down by opening or closing this panel. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${title} — now playing`}
        aria-hidden={!open}
        style={{
          "--station-accent": accentColor,
          transform: sheetTransform,
          transition: isDragging ? "none" : SHEET_TRANSITION,
        } as React.CSSProperties}
        className="fixed inset-x-0 bottom-0 z-[60] flex max-h-[92vh] flex-col overscroll-y-contain rounded-t-3xl border-t border-white/[0.08] bg-[#09090b] shadow-2xl"
      >
        {/* Drag handle + header. `touch-none` hands the whole gesture to the
            pointer handlers below instead of letting the browser interpret a
            vertical drag here as a page scroll (or refresh). */}
        <div
          className="flex shrink-0 touch-none flex-col items-center gap-2 pt-2.5"
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div className="h-1.5 w-10 rounded-full bg-zinc-700" aria-hidden="true" />
          <div className="flex w-full items-center justify-between px-4 pb-1">
            <button
              type="button"
              onClick={close}
              aria-label="Collapse now playing"
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-500 transition-colors hover:text-accent"
            >
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </button>
            <div className="min-w-0 flex-1 text-center">
              {!idle && stationName && (
                <p className="truncate font-sans text-xs font-medium text-slate-400">
                  {stationName}
                </p>
              )}
            </div>
            <div className="w-8" aria-hidden="true" />
          </div>
        </div>

        {/* Scrollable body. `overscroll-y-contain` + `touch-pan-y` keep a
            swipe that reaches the top or bottom of this list from chaining
            into the page behind the sheet — the same gesture that fires a
            pull-to-refresh reload if it escapes. */}
        <div className="flex-1 touch-pan-y overflow-y-auto overscroll-y-contain px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-1">
          <div className="mx-auto flex max-w-sm flex-col items-center gap-5 py-4">
            <div className="relative aspect-square w-full max-w-[280px] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-xl">
              {hasArt ? (
                <Image
                  src={albumArt}
                  alt={`${title} album art`}
                  fill
                  sizes="280px"
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Radio className="h-16 w-16 text-zinc-700" aria-hidden="true" />
                </div>
              )}
            </div>

            <TrackMetadata
              title={title}
              artist={artist}
              album={album}
              size="sheet"
              align="center"
              className="w-full"
            />

            {trackActions && <div className="flex items-center justify-center">{trackActions}</div>}

            {hostControlsSlot && (
              <div className="w-full px-1 py-2">{hostControlsSlot}</div>
            )}

            {/* Audio engine's own slot — hidden video host + seek bar. */}
            {children && <div className="w-full">{children}</div>}

            <TransportControls
              isPlaying={isPlaying}
              onPlayPause={onPlayPause}
              onPrev={onPrev}
              onNext={onNext}
              disablePrev={disablePrev}
              disableNext={disableNext}
            />

            <div className="flex w-full items-center justify-center pt-1">
              <WebPlayer />
            </div>

            <div className="flex w-full items-center gap-2.5 pt-1">
              <Volume2 className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(volume * 100)}
                onChange={(event) => onVolumeChange(Number(event.target.value) / 100)}
                className="volume-range h-1.5 w-full flex-1 rounded-lg accent-accent"
                aria-label="Volume"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
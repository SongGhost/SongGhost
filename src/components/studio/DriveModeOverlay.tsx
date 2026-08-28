"use client";

import { Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { useEffect } from "react";
import {
  setDriveMode,
  setDriveModeBatterySaver,
  useDriveMode,
  useDriveModeBatterySaver,
} from "@/components/player/WebPlayer";

export type DriveModeOverlayProps = {
  title: string;
  artist: string;
  /** Album or station line under the artist */
  album?: string | null;
  stationName?: string;
  albumArt?: string;
  /** When true, chrome labels the on-air host break */
  isDjBreak?: boolean;
  /** Free Roots & Branches teaser — Pro Preview badge while this break is on air. */
  showProPreview?: boolean;
  hostName?: string;
  isPlaying?: boolean;
  onPlayPause?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  disablePrev?: boolean;
  disableNext?: boolean;
  nextTitle?: string | null;
  nextArtist?: string | null;
};

/**
 * Full-screen, high-contrast car-mount overlay.
 * Mounts only while Drive Mode is armed (wake lock + this surface).
 * Owns the full-screen background, video slot, title/artist, Up Next, and
 * transport controls.
 */
export default function DriveModeOverlay({
  title,
  artist,
  album = null,
  stationName,
  isDjBreak = false,
  showProPreview = false,
  hostName,
  isPlaying = false,
  onPlayPause,
  onPrev,
  onNext,
  disablePrev = false,
  disableNext = false,
  nextTitle,
  nextArtist,
}: DriveModeOverlayProps) {
  const driveMode = useDriveMode();
  const batterySaver = useDriveModeBatterySaver();
  const displayTitle = title.trim() || "SongHost";
  const displayArtist = artist.trim() || (hostName?.trim() || "On Air");
  const subtitle =
    album?.trim() ||
    stationName?.trim() ||
    (isDjBreak && hostName ? `${hostName} · Live Break` : null);
  const upNextTitle = nextTitle?.trim() || "";
  const upNextArtist = nextArtist?.trim() || "";

  useEffect(() => {
    if (!driveMode) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [driveMode]);

  useEffect(() => {
    if (!driveMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        void setDriveMode(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [driveMode]);

  if (!driveMode) return null;

  const exit = () => {
    void setDriveMode(false);
  };

  return (
    <div
      className={`fixed inset-0 z-[200] flex flex-col text-amber-50 ${
        batterySaver ? "bg-[#000]" : "bg-[#0c0a09]"
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="Drive Mode"
    >
      {batterySaver ? null : (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(245,158,11,0.12),_transparent_55%),radial-gradient(ellipse_at_bottom,_rgba(120,53,15,0.35),_transparent_60%)]"
        />
      )}

      <header className="relative z-10 flex items-center justify-between gap-3 px-5 pb-2 pt-[max(1rem,env(safe-area-inset-top))] sm:px-8">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-400/90">
            Drive Mode
          </p>
          {stationName?.trim() ? (
            <p className="mt-1 truncate font-sans text-sm text-amber-100/70">
              {stationName.trim()}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={batterySaver}
            aria-label="Battery saver"
            onClick={() => setDriveModeBatterySaver(!batterySaver)}
            style={{ touchAction: "manipulation" }}
            className={
              batterySaver
                ? "relative z-10 flex min-h-11 shrink-0 items-center rounded-full border border-white/25 bg-white/10 px-3 font-mono text-[10px] font-semibold uppercase tracking-widest text-white"
                : "relative z-10 flex min-h-11 shrink-0 items-center rounded-full border border-amber-500/30 bg-amber-950/40 px-3 font-mono text-[10px] font-semibold uppercase tracking-widest text-amber-100"
            }
          >
            Battery saver
          </button>
          <button
            type="button"
            onClick={exit}
            style={{ touchAction: "manipulation" }}
            className="relative z-10 flex min-h-14 min-w-14 shrink-0 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-950/40 text-amber-100 transition-colors hover:border-amber-400/50 hover:bg-amber-900/50"
            aria-label="Exit Drive Mode"
          >
            <X className="h-7 w-7" aria-hidden="true" />
          </button>
        </div>
      </header>

      <main className="relative flex min-h-0 flex-1 flex-col items-center justify-start px-5 pb-6 pt-6 sm:px-8">
        {/* Video slot: reserved space for the promoted YouTube iframe
            (rendered by AudioPlayer at z-[210] above this overlay). */}
        <div aria-hidden className="h-[200px] w-[200px]" />

        <div className="flex flex-1 flex-col items-center justify-center w-full max-w-xl text-center">
          <div className="flex w-full max-w-xl flex-col items-center text-center">
            {isDjBreak ? (
              <span className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-amber-400/40 bg-amber-950/80 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-amber-200">
                Host Live
                {showProPreview ? (
                  <span
                    className="inline-flex items-center rounded border border-accent/45 bg-accent/15 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-widest text-accent"
                    title="Roots & Branches — Pro"
                  >
                    Pro Preview
                  </span>
                ) : null}
              </span>
            ) : null}
            <h1 className="font-sans text-3xl font-semibold leading-tight tracking-tight text-amber-50 sm:text-4xl md:text-5xl">
              {displayTitle}
            </h1>
            <p className="mt-3 font-sans text-xl text-amber-200/85 sm:text-2xl">
              {displayArtist}
            </p>
            {subtitle ? (
              <p className="mt-2 truncate font-mono text-xs uppercase tracking-[0.18em] text-amber-500/70 sm:text-sm">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>

        {upNextTitle ? (
          <div aria-label="Up next" className="w-full max-w-xl px-1 pt-3 text-center">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-amber-500/70">
              Up Next: {upNextTitle}
              {upNextArtist ? ` — ${upNextArtist}` : ""}
            </span>
          </div>
        ) : null}
      </main>

      <div className="relative z-10 flex items-center justify-center gap-6 px-5 pb-2 pt-4 sm:gap-8">
        <button
          type="button"
          onClick={onPrev}
          disabled={disablePrev}
          style={{ touchAction: "manipulation" }}
          className="flex min-h-14 min-w-14 items-center justify-center rounded-full border border-amber-500/30 bg-amber-950/40 text-amber-100 transition-colors hover:border-amber-400/50 hover:bg-amber-900/50 disabled:pointer-events-none disabled:opacity-40"
          aria-label="Previous track"
        >
          <SkipBack className="h-6 w-6" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onPlayPause}
          style={{ touchAction: "manipulation" }}
          className={
            batterySaver
              ? "flex min-h-16 min-w-16 items-center justify-center rounded-full bg-amber-500 text-amber-950 transition-colors hover:bg-amber-400 active:scale-95"
              : "flex min-h-16 min-w-16 items-center justify-center rounded-full bg-amber-500 text-amber-950 shadow-[0_0_24px_rgba(245,158,11,0.45)] transition-colors hover:bg-amber-400 active:scale-95"
          }
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <Pause className="h-7 w-7" aria-hidden="true" />
          ) : (
            <Play className="h-7 w-7" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={disableNext}
          style={{ touchAction: "manipulation" }}
          className="flex min-h-14 min-w-14 items-center justify-center rounded-full border border-amber-500/30 bg-amber-950/40 text-amber-100 transition-colors hover:border-amber-400/50 hover:bg-amber-900/50 disabled:pointer-events-none disabled:opacity-40"
          aria-label="Next track"
        >
          <SkipForward className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>

      <footer className="relative px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2 text-center sm:px-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-700/80">
          Tap X or press Esc to exit · Screen stays awake
        </p>
      </footer>
    </div>
  );
}

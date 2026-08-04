"use client";

import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import { AudioLines, Disc3, Radio, Share2, Volume2 } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";
import ChatterPacingPill from "@/components/ChatterPacingPill";
import { consoleActionBtnClass } from "@/components/QuickConnectors";
import TransportControls from "@/components/TransportControls";
import AudioVisualizer from "@/components/visualizer/AudioVisualizer";
import VUMeter from "@/components/VUMeter";
import {
  getEraDefinition,
  isEraLocked,
  type AlbumContext,
  type ChatterPacing,
  type EraLock,
} from "@/types/station";
import { VISUALIZER_MODE_LABELS, type VisualizerMode } from "@/types/visuals";

type ControlDeckProps = {
  accentColor: string;
  title: string;
  artist: string;
  albumArt: string;
  /** No station session — badge row and album art are hidden in standby state */
  idle: boolean;
  stationName?: string;
  personaName?: string;
  /** Host on air — themes the visualizer behind the deck */
  personaId?: string | null;
  frequency: number;
  isPlaying: boolean;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  volume: number;
  onVolumeChange: (value: number) => void;
  visualizerMode: VisualizerMode;
  /** Cycles the visualizer style */
  onCycleVisualizer: () => void;
  /** DJ talk density on air, adjustable from the badge row mid-session */
  chatterPacing: ChatterPacing;
  onChatterPacingChange: (pacing: ChatterPacing) => void;
  /** True when the pacing came from a station override rather than the global default */
  chatterIsStationOverride?: boolean;
  /** Decade the active station is locked to — badged next to the dial readout */
  eraLock?: EraLock;
  /** The record behind an `album_deep_dive` station — shows the liner-notes trigger when set */
  albumContext?: AlbumContext | null;
  /** Opens the liner notes panel; only called when `albumContext` is present */
  onOpenLinerNotes?: () => void;
  /** Opens the share-station modal for the live session */
  onShareStation?: () => void;
  /**
   * Per-track listener controls (favorite, ban) rendered beside the transport.
   * A slot rather than props so the deck stays unaware of the feedback store.
   */
  trackActions?: ReactNode;
  /** Mounts the audio engine's hidden video host + seek progress bar beneath the transport row */
  children?: ReactNode;
};

export default function ControlDeck({
  accentColor,
  title,
  artist,
  albumArt,
  idle,
  stationName,
  personaName,
  personaId,
  frequency,
  isPlaying,
  onPlayPause,
  onPrev,
  onNext,
  volume,
  onVolumeChange,
  visualizerMode,
  onCycleVisualizer,
  chatterPacing,
  onChatterPacingChange,
  chatterIsStationOverride,
  eraLock = "all",
  albumContext = null,
  onOpenLinerNotes,
  onShareStation,
  trackActions,
  children,
}: ControlDeckProps) {
  const { isSignedIn, isLoaded } = useAuth();
  const hasArt = Boolean(albumArt?.trim());
  const volumePercent = Math.round(volume * 100);
  const badgeLine = [stationName, personaName].filter(Boolean).join(" · ");
  const eraBadge = isEraLocked(eraLock) ? getEraDefinition(eraLock) : null;

  return (
    <header
      className="sticky top-0 z-50 bg-zinc-950/95 backdrop-blur-md border-b border-zinc-800/80 px-4 py-3"
      style={{ "--station-accent": accentColor } as React.CSSProperties}
    >
      {/*
        Audio-reactive backdrop. Clipped by its own wrapper rather than by the
        header, so the header can still let the auth popover overflow. The scrim
        above it is what buys the deck's text its contrast back.
      */}
      <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
        <AudioVisualizer
          mode={visualizerMode}
          personaId={personaId}
          active={isPlaying && !idle}
          className="h-full w-full"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/55 via-zinc-950/35 to-zinc-950/65" />
      </div>

      <div className="relative max-w-6xl mx-auto flex items-center justify-between gap-3 sm:gap-4">
        {/* Left: cover art + title/artist + station/persona badge */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="relative shrink-0 h-12 w-12 rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800 flex items-center justify-center">
            {hasArt ? (
              <Image
                src={albumArt}
                alt={`${title} album art`}
                width={48}
                height={48}
                className="h-12 w-12 object-cover"
                unoptimized
              />
            ) : (
              <Radio className="h-5 w-5 text-zinc-600" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-zinc-100 font-sans font-semibold text-sm truncate leading-tight">
              {title}
            </p>
            <p className="text-amber-400 font-mono text-xs truncate leading-tight mt-0.5">
              {artist}
            </p>
            {!idle && (
              <div className="flex items-center gap-1.5 mt-1">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: accentColor }}
                />
                <span className="font-mono text-[10px] text-zinc-500 truncate tracking-wide">
                  {frequency > 0 && (
                    <span className="text-amber-500 tabular-nums font-bold mr-1.5">
                      {frequency.toFixed(1)} FM
                    </span>
                  )}
                  {badgeLine}
                </span>
                {eraBadge && (
                  <span
                    className="shrink-0 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold tabular-nums text-amber-400"
                    title={`Era locked to ${eraBadge.label}`}
                  >
                    {eraBadge.shortLabel}
                  </span>
                )}
                <ChatterPacingPill
                  value={chatterPacing}
                  onChange={onChatterPacingChange}
                  isStationOverride={chatterIsStationOverride}
                  className="shrink-0"
                />
                {albumContext && (
                  <button
                    type="button"
                    onClick={onOpenLinerNotes}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-amber-400 transition-colors hover:bg-amber-500/20"
                    aria-label={`Open liner notes for ${albumContext.albumTitle}`}
                    title={`Liner notes: ${albumContext.albumTitle}`}
                  >
                    <Disc3 className="h-2.5 w-2.5" aria-hidden="true" />
                    Liner Notes
                  </button>
                )}
                {onShareStation && (
                  <button
                    type="button"
                    onClick={onShareStation}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-zinc-700/80 bg-zinc-900/70 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-zinc-400 transition-colors hover:border-amber-500/40 hover:text-amber-400"
                    aria-label={`Share ${stationName ?? "station"} permalink`}
                    title="Share station link"
                  >
                    <Share2 className="h-2.5 w-2.5" aria-hidden="true" />
                    Share
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Center: transport controls + compact VU meter */}
        <div className="flex items-center gap-3 sm:gap-4 shrink-0">
          <TransportControls
            isPlaying={isPlaying}
            onPlayPause={onPlayPause}
            onPrev={onPrev}
            onNext={onNext}
          />
          {trackActions && <div className="hidden sm:flex items-center">{trackActions}</div>}
          <div className="hidden md:block">
            <VUMeter active={isPlaying} inline />
          </div>
          <button
            type="button"
            onClick={onCycleVisualizer}
            className="hidden lg:flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/70 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-zinc-400 transition-colors hover:border-amber-500/50 hover:text-amber-400"
            aria-label={`Visualizer style: ${VISUALIZER_MODE_LABELS[visualizerMode]}. Activate to change.`}
          >
            <AudioLines className="h-3 w-3" aria-hidden="true" />
            {VISUALIZER_MODE_LABELS[visualizerMode]}
          </button>
        </div>

        {/* Right: compact volume + auth */}
        <div className="flex items-center gap-3 shrink-0 flex-1 justify-end">
          <div className="hidden sm:flex items-center gap-2">
            <Volume2 className="h-4 w-4 text-zinc-400 shrink-0" aria-hidden="true" />
            <input
              type="range"
              min={0}
              max={100}
              value={volumePercent}
              onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
              className="volume-range w-20 md:w-24 accent-amber-500 h-1.5 rounded-lg"
              aria-label="Volume"
            />
          </div>
          {isLoaded && !isSignedIn && (
            <SignInButton mode="modal">
              <button type="button" className={`${consoleActionBtnClass} hidden sm:inline-flex`}>
                Sign In
              </button>
            </SignInButton>
          )}
          {isLoaded && isSignedIn && (
            <UserButton
              appearance={{
                elements: {
                  avatarBox: "h-8 w-8 ring-2 ring-amber-500/40",
                },
              }}
            />
          )}
        </div>
      </div>

      {children && <div className="relative max-w-6xl mx-auto mt-2">{children}</div>}
    </header>
  );
}

"use client";

import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import {
  AudioLines,
  ChevronUp,
  Disc3,
  Pause,
  Play,
  Radio,
  Share2,
  SkipForward,
  Volume2,
} from "lucide-react";
import Image from "next/image";
import { useState, type ReactNode } from "react";
import ChatterPacingPill from "@/components/ChatterPacingPill";
import Header from "@/components/header/Header";
import MobilePlayerSheet from "@/components/player/MobilePlayerSheet";
import TrackMetadata from "@/components/player/TrackMetadata";
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
  /** Album name from the active track when known */
  album?: string | null;
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
  /** Opens the DJ Tuning Console when the chatter badge is clicked */
  onOpenDjSettings?: () => void;
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

const mobileTransportBtnClass =
  "flex shrink-0 items-center justify-center rounded-full border border-[#D2C5B4] bg-white p-2.5 text-stone-800 shadow-sm transition-all active:scale-95";

export default function ControlDeck({
  accentColor,
  title,
  artist,
  album = null,
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
  onOpenDjSettings,
  eraLock = "all",
  albumContext = null,
  onOpenLinerNotes,
  onShareStation,
  trackActions,
  children,
}: ControlDeckProps) {
  const { isSignedIn, isLoaded } = useAuth();
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const hasArt = Boolean(albumArt?.trim());
  const volumePercent = Math.round(volume * 100);
  const badgeLine = [stationName, personaName].filter(Boolean).join(" · ");
  const eraBadge = isEraLocked(eraLock) ? getEraDefinition(eraLock) : null;
  /** Prefer per-track album; fall back to the deep-dive sleeve title. */
  const albumTitle =
    album?.trim() || albumContext?.albumTitle?.trim() || null;

  return (
    <>
      <header
        className="sticky top-0 z-50 border-b border-zinc-800/80 bg-zinc-950/95 px-4 py-3 backdrop-blur-md"
        style={{ "--station-accent": accentColor } as React.CSSProperties}
      >
        {/*
          Audio-reactive backdrop. Desktop/tablet only — on mobile portrait the
          compact deck keeps chrome minimal and the sheet owns the richer UI.
        */}
        <div aria-hidden="true" className="absolute inset-0 hidden overflow-hidden md:block">
          <AudioVisualizer
            mode={visualizerMode}
            personaId={personaId}
            active={isPlaying && !idle}
            className="h-full w-full"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/55 via-zinc-950/35 to-zinc-950/65" />
        </div>

        {/* Mobile portrait deck (< md): art + meta | Play / Next */}
        <div className="relative mx-auto flex max-w-6xl items-center gap-2 md:hidden">
          <button
            type="button"
            onClick={() => setMobileSheetOpen(true)}
            aria-label="Expand now playing"
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          >
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
              {hasArt ? (
                <Image
                  src={albumArt}
                  alt={`${title} album art`}
                  width={40}
                  height={40}
                  className="h-10 w-10 object-cover"
                  unoptimized
                />
              ) : (
                <Radio className="h-4 w-4 text-zinc-600" aria-hidden="true" />
              )}
            </div>
            <TrackMetadata
              title={title}
              artist={artist}
              album={albumTitle}
              className="flex-1"
            />
            <ChevronUp
              className="h-4 w-4 shrink-0 text-zinc-500"
              aria-hidden="true"
            />
          </button>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onPlayPause}
              className="flex shrink-0 items-center justify-center rounded-full bg-amber-500 p-2.5 text-zinc-950 shadow-[0_2px_10px_rgba(245,158,11,0.35)] transition-transform active:scale-95"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <Pause className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Play className="h-4 w-4 translate-x-px" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              onClick={onNext}
              className={mobileTransportBtnClass}
              aria-label="Next track"
            >
              <SkipForward className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Desktop / tablet deck (md+) */}
        <div className="relative mx-auto hidden max-w-6xl items-center justify-between gap-4 md:flex">
          {/* Left: cover art + title/artist·album + badge row (bounded so it never eats the transport) */}
          <div className="flex min-w-0 max-w-[300px] flex-1 flex-shrink-0 items-center gap-3 lg:max-w-[380px]">
            <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
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
            <div className="min-w-0 flex-1">
              <TrackMetadata title={title} artist={artist} album={albumTitle} />
              {!idle && (
                <div className="mt-1 flex flex-nowrap items-center gap-1.5 overflow-hidden">
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: accentColor }}
                  />
                  <span className="min-w-0 truncate font-mono text-[10px] tracking-wide text-zinc-500">
                    {frequency > 0 && (
                      <span className="mr-1.5 font-bold tabular-nums text-amber-500">
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
                    onOpenSettings={onOpenDjSettings}
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

          {/* Center: transport controls + compact VU meter — fixed spacing, never shrinks */}
          <div className="mx-4 flex flex-shrink-0 items-center gap-3 sm:gap-4">
            <TransportControls
              isPlaying={isPlaying}
              onPlayPause={onPlayPause}
              onPrev={onPrev}
              onNext={onNext}
            />
            {trackActions && <div className="flex items-center">{trackActions}</div>}
            <div>
              <VUMeter active={isPlaying} inline />
            </div>
            <button
              type="button"
              onClick={onCycleVisualizer}
              className="hidden items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/70 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-zinc-400 transition-colors hover:border-amber-500/50 hover:text-amber-400 lg:flex"
              aria-label={`Visualizer style: ${VISUALIZER_MODE_LABELS[visualizerMode]}. Activate to change.`}
            >
              <AudioLines className="h-3 w-3" aria-hidden="true" />
              {VISUALIZER_MODE_LABELS[visualizerMode]}
            </button>
          </div>

          {/* Right: compact volume + music source + auth */}
          <div className="flex flex-1 shrink-0 items-center justify-end gap-3">
            <div className="flex items-center gap-2">
              <Volume2 className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
              <input
                type="range"
                min={0}
                max={100}
                value={volumePercent}
                onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
                className="volume-range h-1.5 w-20 rounded-lg accent-amber-500 md:w-24"
                aria-label="Volume"
              />
            </div>
            <Header />
            {isLoaded && !isSignedIn && (
              <SignInButton mode="modal">
                <button type="button" className={consoleActionBtnClass}>
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

        {/*
          Audio engine slot stays mounted for every viewport so the YouTube host
          is never torn down by a resize between the compact deck and md+.
        */}
        {children && <div className="relative mx-auto mt-2 max-w-6xl">{children}</div>}
      </header>

      <MobilePlayerSheet
        open={mobileSheetOpen}
        onOpenChange={setMobileSheetOpen}
        showMiniBar={false}
        accentColor={accentColor}
        title={title}
        artist={artist}
        album={albumTitle}
        albumArt={albumArt}
        idle={idle}
        stationName={stationName}
        personaName={personaName}
        frequency={frequency}
        isPlaying={isPlaying}
        onPlayPause={onPlayPause}
        onPrev={onPrev}
        onNext={onNext}
        volume={volume}
        onVolumeChange={onVolumeChange}
        trackActions={trackActions}
      />
    </>
  );
}

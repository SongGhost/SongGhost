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
  SlidersHorizontal,
  Volume2,
} from "lucide-react";
import Image from "next/image";
import { useState, type ReactNode } from "react";
import MusicSourceHeader from "@/components/header/Header";
import BrandHeader from "@/components/layout/Header";
import {
  HostControlsBar,
  resolveHostDisplayName,
} from "@/components/player/HostBar";
import MobilePlayerSheet from "@/components/player/MobilePlayerSheet";
import TrackMetadata from "@/components/player/TrackMetadata";
import WebPlayer, { useActiveTrack } from "@/components/player/WebPlayer";
import { consoleActionBtnClass } from "@/components/QuickConnectors";
import TransportControls from "@/components/TransportControls";
import AudioVisualizer from "@/components/visualizer/AudioVisualizer";
import VUMeter from "@/components/VUMeter";
import { useTier } from "@/context/TierContext";
import { useUserPreferences } from "@/context/UserPreferencesContext";
import type { OrchestratorStatus } from "@/lib/player/webOrchestrator";
import type { DjTuningSettings } from "@/types/dj";
import {
  getEraDefinition,
  isEraLocked,
  type AlbumContext,
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
  /** Clean `[GENRE • ERA]` tag — replaces FM dial readouts */
  stationMetaTag?: string;
  isPlaying: boolean;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  volume: number;
  onVolumeChange: (value: number) => void;
  visualizerMode: VisualizerMode;
  /** Cycles the visualizer style */
  onCycleVisualizer: () => void;
  /** Glows the brand "g" while a host break is live */
  djBreakActive?: boolean;
  /** Decade the active station is locked to — used when meta tag is absent */
  eraLock?: EraLock;
  /** The record behind an `album_deep_dive` station — sleeve title fallback */
  albumContext?: AlbumContext | null;
  /** Opens the liner notes drawer for the active track */
  onOpenLinerNotes?: () => void;
  /** Opens the share-station modal for the live session */
  onShareStation?: () => void;
  /** Host Studio bar — single DJ settings entry point */
  hostTuning?: DjTuningSettings;
  onOpenHostSettings?: () => void;
  hostSettingsOpen?: boolean;
  orchestratorStatus?: OrchestratorStatus;
  onBreakNow?: () => void;
  onSkipDj?: () => void;
  canTriggerBreak?: boolean;
  /** Utility shortcuts rendered inside the host controls bar */
  onViewPlaylist?: () => void;
  onTeleprompter?: () => void;
  teleprompterOpen?: boolean;
  onBroadcastLog?: () => void;
  /**
   * Per-track listener controls (favorite, ban) rendered beside the transport.
   * A slot rather than props so the deck stays unaware of the feedback store.
   */
  trackActions?: ReactNode;
  /** Memory presets strip — host controls render directly beneath this row */
  memorySlot?: ReactNode;
  /**
   * Station Finder mode tabs (Song Radio / Artist Mix / …) — rendered beside the
   * Tune Station toggle so the matrix drawer can open inline under the finder.
   */
  stationFinderTabs?: ReactNode;
  /** Whether the Decade/Genre Matrix tuner drawer is expanded */
  tunerOpen?: boolean;
  /** Expands / collapses the StationTuner drawer */
  onToggleTuner?: () => void;
  /** Inline StationTuner drawer content (shown when `tunerOpen`) */
  stationTuner?: ReactNode;
  /** Mounts the audio engine's hidden video host + seek progress bar beneath the transport row */
  children?: ReactNode;
};

const mobileTransportBtnClass =
  "flex shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-[#121215] p-2.5 text-zinc-200 shadow-sm transition-all active:scale-95";

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
  stationMetaTag,
  isPlaying,
  onPlayPause,
  onPrev,
  onNext,
  volume,
  onVolumeChange,
  visualizerMode,
  onCycleVisualizer,
  djBreakActive = false,
  eraLock = "all",
  albumContext = null,
  onOpenLinerNotes,
  onShareStation,
  hostTuning,
  onOpenHostSettings,
  hostSettingsOpen = false,
  orchestratorStatus = "STANDBY",
  onBreakNow,
  onSkipDj,
  canTriggerBreak = false,
  onViewPlaylist,
  onTeleprompter,
  teleprompterOpen = false,
  onBroadcastLog,
  trackActions,
  memorySlot,
  stationFinderTabs,
  tunerOpen = false,
  onToggleTuner,
  stationTuner,
  children,
}: ControlDeckProps) {
  const { isSignedIn, isLoaded } = useAuth();
  const { isPro } = useTier();
  const { preferredVoice, activePersonaId } = useUserPreferences();
  const hostDisplayName = resolveHostDisplayName({
    preferredVoice,
    activePersonaId,
    isPro,
    fallback: personaName ?? "Host",
  });
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const currentTrack = useActiveTrack();
  // Placeholder props ("Tuning in…") yield to the orchestrator stamp so the
  // opener paints before page nowPlaying catches up. Once props carry a real
  // track title they win — that path updates synchronously on skip/advance.
  const trimmedTitle = title.trim();
  const propsArePlaceholder =
    idle ||
    !trimmedTitle ||
    trimmedTitle === "Tuning in…" ||
    trimmedTitle === "Ready to Tune In";
  const displayTitle = djBreakActive
    ? title
    : propsArePlaceholder
      ? currentTrack?.title?.trim() || trimmedTitle || "Ready to Tune In"
      : trimmedTitle;
  const displayArtist = djBreakActive
    ? artist
    : propsArePlaceholder
      ? currentTrack?.artist?.trim() || artist.trim() || "Select a station or search..."
      : artist.trim() || currentTrack?.artist?.trim() || "Select a station or search...";
  const displayArt = (
    (propsArePlaceholder ? currentTrack?.albumArtUrl : albumArt.trim()) ||
    currentTrack?.albumArtUrl ||
    albumArt ||
    ""
  ).trim();
  const hasArt = Boolean(displayArt);
  const volumePercent = Math.round(volume * 100);
  const eraBadge = isEraLocked(eraLock) ? getEraDefinition(eraLock) : null;
  /** Prefer live track album, then prop, then deep-dive sleeve title. */
  const albumTitle =
    (propsArePlaceholder ? currentTrack?.album?.trim() : album?.trim()) ||
    currentTrack?.album?.trim() ||
    album?.trim() ||
    albumContext?.albumTitle?.trim() ||
    null;
  const trackMetaKey =
    currentTrack?.id?.trim() ||
    [displayTitle, displayArtist].filter(Boolean).join("\0") ||
    "idle";

  /** Always mount when host props are wired — visible before a track is playing. */
  const showHostBar = Boolean(
    hostTuning && onOpenHostSettings && onBreakNow && onSkipDj,
  );

  const authActions = (
    <>
      <MusicSourceHeader />
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
              avatarBox: "h-8 w-8 ring-2 ring-accent/40",
            },
          }}
        />
      )}
    </>
  );

  return (
    <>
      <header
        className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#09090b]/92 px-3 py-2 backdrop-blur-xl sm:px-4 sm:py-3"
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
          <div className="absolute inset-0 bg-gradient-to-b from-[#09090b]/70 via-[#09090b]/45 to-[#09090b]/80" />
        </div>

        {/*
          Mobile sticky budget stays under ~130px (brand + transport only).
          Memory presets + DJ controls render below so station content remains
          reachable without scrolling past a full-screen chrome stack.
        */}
        <div className="relative mx-auto max-w-6xl space-y-2 sm:space-y-3">
          <BrandHeader
            djBreakActive={djBreakActive}
            actions={<div className="flex items-center gap-2">{authActions}</div>}
            className="pb-0 sm:pb-1"
          />

          {/* Mobile portrait deck (< md): art + meta | Play / Next */}
          <div className="flex items-center gap-2 md:hidden">
            <button
              type="button"
              onClick={() => setMobileSheetOpen(true)}
              aria-label="Expand now playing"
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            >
              <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/[0.08] bg-[#121215]">
                {hasArt ? (
                  <Image
                    src={displayArt}
                    alt={`${displayTitle} album art`}
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
                key={trackMetaKey}
                title={displayTitle}
                artist={displayArtist}
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
                className="flex shrink-0 items-center justify-center rounded-full bg-accent p-2.5 text-zinc-950 shadow-[0_2px_10px_var(--brand-accent-glow)] transition-colors hover:bg-accent-hover active:scale-95"
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
          <div className="hidden items-center justify-between gap-4 md:flex">
            {/* Left: cover art + title/artist·album + badge row */}
            <div className="flex min-w-0 max-w-[300px] flex-1 items-center gap-3 lg:max-w-[380px]">
              <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/[0.08] bg-[#121215]">
                {hasArt ? (
                  <Image
                    src={displayArt}
                    alt={`${displayTitle} album art`}
                    width={48}
                    height={48}
                    className="h-12 w-12 object-cover"
                    unoptimized
                  />
                ) : (
                  <Radio className="h-5 w-5 text-zinc-600" aria-hidden="true" />
                )}
              </div>
              <div key={trackMetaKey} className="min-w-0 flex-1">
                <TrackMetadata
                  title={displayTitle}
                  artist={displayArtist}
                  album={albumTitle}
                  className="min-w-0"
                />
                {!idle && (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 shrink-0">
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: accentColor }}
                    />
                    {stationMetaTag && (
                      <span className="shrink-0 rounded-md border border-white/[0.08] bg-[#121215]/80 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-accent/90">
                        {stationMetaTag}
                      </span>
                    )}
                    <span className="min-w-0 truncate font-mono text-[10px] tracking-wide text-zinc-500">
                      {[stationName, hostDisplayName].filter(Boolean).join(" · ")}
                    </span>
                    {eraBadge && !stationMetaTag && (
                      <span
                        className="shrink-0 rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold tabular-nums text-accent"
                        title={`Era locked to ${eraBadge.label}`}
                      >
                        {eraBadge.shortLabel}
                      </span>
                    )}
                    {onOpenLinerNotes && (
                      <button
                        type="button"
                        onClick={onOpenLinerNotes}
                        className="flex shrink-0 items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-accent transition-colors hover:bg-accent/20"
                        aria-label={`Open liner notes for ${displayTitle}`}
                        title={`Liner notes: ${displayTitle}`}
                      >
                        <Disc3 className="h-2.5 w-2.5" aria-hidden="true" />
                        Liner Notes
                      </button>
                    )}
                    {onShareStation && (
                      <button
                        type="button"
                        onClick={onShareStation}
                        className="flex shrink-0 items-center gap-1 rounded-md border border-white/[0.08] bg-[#121215]/70 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-zinc-400 transition-colors hover:border-accent/40 hover:text-accent"
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
            <div className="mx-4 flex shrink-0 items-center gap-3 sm:gap-4">
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
                className="hidden items-center gap-1.5 rounded-md border border-white/[0.08] bg-[#121215]/70 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-zinc-400 transition-colors hover:border-accent/50 hover:text-accent lg:flex"
                aria-label={`Visualizer style: ${VISUALIZER_MODE_LABELS[visualizerMode]}. Activate to change.`}
              >
                <AudioLines className="h-3 w-3" aria-hidden="true" />
                {VISUALIZER_MODE_LABELS[visualizerMode]}
              </button>
            </div>

            {/* Right: volume + drive mode */}
            <div className="flex flex-1 shrink-0 items-center justify-end gap-3">
              <div className="flex items-center gap-2">
                <Volume2 className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={volumePercent}
                  onChange={(e) => {
                    const newVolume = Number(e.target.value) / 100;
                    console.log("[TELEMETRY: UI Volume]", newVolume);
                    onVolumeChange(newVolume);
                  }}
                  className="volume-range h-1.5 w-20 rounded-lg accent-accent md:w-24"
                  aria-label="Volume"
                />
              </div>
              <WebPlayer />
            </div>
          </div>

          {/*
            Station Finder tabs + Tune Station toggle. The matrix drawer expands
            inline beneath this row (and under the primary search bar on home).
          */}
          {(stationFinderTabs || onToggleTuner) && (
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              {stationFinderTabs}
              {onToggleTuner && (
                <button
                  type="button"
                  onClick={onToggleTuner}
                  aria-pressed={tunerOpen}
                  aria-expanded={tunerOpen}
                  aria-controls="station-tuner-drawer"
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-wider transition-all ${
                    tunerOpen
                      ? "border-accent bg-accent/15 text-accent shadow-[0_0_14px_var(--brand-accent-glow)]"
                      : "border-white/[0.08] bg-[#121215] text-zinc-400 hover:border-white/[0.16] hover:text-zinc-200"
                  }`}
                >
                  <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
                  Tune Station
                </button>
              )}
            </div>
          )}

          {tunerOpen && stationTuner && (
            <div id="station-tuner-drawer" className="mt-1">
              {stationTuner}
            </div>
          )}

          {/*
            Audio engine slot stays mounted for every viewport so the YouTube host
            is never torn down by a resize between the compact deck and md+.
          */}
          {children && <div className="mt-1">{children}</div>}
        </div>
      </header>

      {/*
        Memory + DJ controls sit below the sticky chrome so mobile pinned height
        stays under ~130px (brand + transport). Desktop still sees them first.
      */}
      {memorySlot && (
        <div className="relative border-b border-white/[0.06] bg-[#09090b]/92">
          {memorySlot}
        </div>
      )}

      {showHostBar && hostTuning && onOpenHostSettings && onBreakNow && onSkipDj && (
        <div className="relative mx-auto max-w-6xl px-3 py-1.5 sm:px-4 sm:py-2">
          <HostControlsBar
            personaName={hostDisplayName}
            tuning={hostTuning}
            onOpenSettings={onOpenHostSettings}
            settingsOpen={hostSettingsOpen}
            status={orchestratorStatus}
            onBreakNow={onBreakNow}
            onSkipDj={onSkipDj}
            canTriggerBreak={canTriggerBreak}
            hasCurrentTrack={!idle}
            onViewPlaylist={onViewPlaylist}
            onTeleprompter={onTeleprompter}
            teleprompterOpen={teleprompterOpen}
            onBroadcastLog={onBroadcastLog}
          />
        </div>
      )}

      <MobilePlayerSheet
        open={mobileSheetOpen}
        onOpenChange={setMobileSheetOpen}
        showMiniBar={false}
        accentColor={accentColor}
        title={displayTitle}
        artist={displayArtist}
        album={albumTitle}
        albumArt={displayArt}
        idle={idle}
        stationName={stationName}
        personaName={hostDisplayName}
        stationMetaTag={stationMetaTag}
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

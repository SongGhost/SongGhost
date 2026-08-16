"use client";

import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import {
  AudioLines,
  BookOpen,
  ChevronUp,
  Pause,
  Play,
  Radio,
  SkipForward,
  Volume2,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import ArtworkImage from "@/components/common/ArtworkImage";
import MusicSourceHeader, {
  DevTierBadge,
} from "@/components/header/Header";
import BrandHeader from "@/components/layout/Header";
import {
  HostControlsBar,
  resolveHostDisplayName,
} from "@/components/player/HostBar";
import MobilePlayerSheet from "@/components/player/MobilePlayerSheet";
import TrackMetadata from "@/components/player/TrackMetadata";
import { DriveModeToggle, useActiveTrack } from "@/components/player/WebPlayer";
import { consoleActionBtnClass } from "@/components/QuickConnectors";
import TransportControls from "@/components/TransportControls";
import AudioVisualizer from "@/components/visualizer/AudioVisualizer";
import VUMeter from "@/components/VUMeter";
import { useTier } from "@/context/TierContext";
import { useUserPreferences } from "@/context/UserPreferencesContext";
import type { OrchestratorStatus } from "@/lib/player/webOrchestrator";
import type { DjTuningSettings } from "@/types/dj";
import type { AlbumContext, EraLock } from "@/types/station";
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
  /** Decade the active station is locked to (kept for callers; deck chrome no longer shows era pills) */
  eraLock?: EraLock;
  /** The record behind an `album_deep_dive` station — sleeve title fallback */
  albumContext?: AlbumContext | null;
  /** Opens the liner notes drawer for the active track (album-art hover) */
  onOpenLinerNotes?: () => void;
  /** @deprecated Share control moved to header — prop retained for call-site compatibility */
  onShareStation?: () => void;
  /** Host Studio bar — single DJ settings entry point */
  hostTuning?: DjTuningSettings;
  onOpenHostSettings?: () => void;
  hostSettingsOpen?: boolean;
  /**
   * Model 3 Host Retention — locked badge + Reset on the Host Studio pill.
   */
  isHostLocked?: boolean;
  onResetHostLock?: () => void;
  orchestratorStatus?: OrchestratorStatus;
  onBreakNow?: () => void;
  onSkipDj?: () => void;
  canTriggerBreak?: boolean;
  /**
   * Spotify/Apple companion owns Break Now / DJ Standby. When false on Free
   * (YouTube-only) the Standby control stays visible but inactive with a tooltip.
   */
  companionActive?: boolean;
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
   * Station Finder mode tabs (Song Radio / Artist Mix / …) when rendered in the deck.
   */
  stationFinderTabs?: ReactNode;
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
  isPlaying,
  onPlayPause,
  onPrev,
  onNext,
  volume,
  onVolumeChange,
  visualizerMode,
  onCycleVisualizer,
  djBreakActive = false,
  albumContext = null,
  onOpenLinerNotes,
  hostTuning,
  onOpenHostSettings,
  hostSettingsOpen = false,
  isHostLocked = false,
  onResetHostLock,
  orchestratorStatus = "STANDBY",
  onBreakNow,
  onSkipDj,
  canTriggerBreak = false,
  companionActive = false,
  onViewPlaylist,
  onTeleprompter,
  teleprompterOpen = false,
  onBroadcastLog,
  trackActions,
  memorySlot,
  stationFinderTabs,
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
  const volumePercent = Math.round(volume * 100);
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
      <DevTierBadge />
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
                <ArtworkImage
                  src={displayArt}
                  alt={`${displayTitle} album art`}
                  width={40}
                  height={40}
                  className="h-10 w-10 object-cover"
                  fallbackIcon={<Radio className="h-4 w-4 text-zinc-600" aria-hidden="true" />}
                />
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
            {/* Left: cover art + clean title / artist·album */}
            <div className="flex min-w-0 max-w-[300px] flex-1 items-center gap-3 lg:max-w-[380px]">
              {onOpenLinerNotes ? (
                <button
                  type="button"
                  onClick={onOpenLinerNotes}
                  className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-900 shadow-md shadow-black/40"
                  aria-label={`Read liner notes for ${displayTitle}`}
                  title="Read Liner Notes"
                >
                  <ArtworkImage
                    src={displayArt}
                    alt={`${displayTitle} album art`}
                    width={64}
                    height={64}
                    className="h-16 w-16 object-cover"
                    fallbackIcon={<Radio className="h-5 w-5 text-zinc-600" aria-hidden="true" />}
                  />
                  <span className="absolute inset-0 flex cursor-pointer items-center justify-center bg-black/70 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                    <BookOpen className="h-5 w-5 text-cyan-400" aria-hidden="true" />
                  </span>
                </button>
              ) : (
                <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-800 bg-slate-900 shadow-md shadow-black/40">
                  <ArtworkImage
                    src={displayArt}
                    alt={`${displayTitle} album art`}
                    width={64}
                    height={64}
                    className="h-16 w-16 object-cover"
                    fallbackIcon={<Radio className="h-5 w-5 text-zinc-600" aria-hidden="true" />}
                  />
                </div>
              )}
              <div key={trackMetaKey} className="min-w-0 flex-1">
                <TrackMetadata
                  title={displayTitle}
                  artist={displayArtist}
                  album={albumTitle}
                  className="min-w-0"
                />
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
              <DriveModeToggle />
            </div>
          </div>

          {stationFinderTabs && (
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              {stationFinderTabs}
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

      {/* Host Studio pill (left) + Broadcast Deck actions (right) */}
      {showHostBar && hostTuning && onOpenHostSettings && onBreakNow && onSkipDj && (
        <div className="relative mx-auto max-w-6xl px-3 py-1.5 sm:px-4 sm:py-2">
          <HostControlsBar
            personaName={hostDisplayName}
            tuning={hostTuning}
            onOpenSettings={onOpenHostSettings}
            settingsOpen={hostSettingsOpen}
            isHostLocked={isHostLocked}
            onResetHostLock={onResetHostLock}
            status={orchestratorStatus}
            onBreakNow={onBreakNow}
            onSkipDj={onSkipDj}
            canTriggerBreak={canTriggerBreak}
            companionActive={companionActive}
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

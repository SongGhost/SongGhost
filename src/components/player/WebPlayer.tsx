"use client";

import {
  ChevronDown,
  Clock,
  ListMusic,
  Mic2,
  MonitorSmartphone,
  Radio,
  ScrollText,
} from "lucide-react";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import TrackMetadata from "@/components/player/TrackMetadata";
import {
  getCurrentTrackState,
  startSilentAudioAnchor,
  subscribeCurrentTrackState,
  type ActiveTrackState,
  type OrchestratorStatus,
} from "@/lib/player/webOrchestrator";
import {
  DJ_KNOWLEDGE_LABELS,
  DJ_PACE_LABELS,
  type DjTuningSettings,
} from "@/types/dj";

/**
 * Call synchronously inside the Play / Launch Station click handler so Android
 * Chrome keeps the tab's media session (and Web Audio) alive in the background.
 */
export function primeSilentAudioAnchor(): void {
  startSilentAudioAnchor();
}

/** Live orchestrator now-playing snapshot (null when idle). */
export function useActiveTrack(): ActiveTrackState | null {
  return useSyncExternalStore(
    subscribeCurrentTrackState,
    getCurrentTrackState,
    () => null,
  );
}

export type NowPlayingHeaderProps = {
  /** Fallback title when no orchestrator track is stamped yet. */
  title?: string;
  /** Fallback artist/subtitle when no orchestrator track is stamped yet. */
  artist?: string;
  /** Fallback album art URL. */
  albumArt?: string;
  /** Optional album line for the subtitle. */
  album?: string | null;
  /** Thumbnail edge length in px (default 48). */
  artSize?: number;
  className?: string;
};

/**
 * Header now-playing chrome bound to orchestrator `currentTrack`.
 * Falls back to idle copy until a queue opener or SDK event stamps metadata.
 */
export function NowPlayingHeader({
  title,
  artist,
  albumArt,
  album = null,
  artSize = 48,
  className = "",
}: NowPlayingHeaderProps) {
  const currentTrack = useActiveTrack();
  const displayTitle = currentTrack
    ? currentTrack.title
    : title?.trim() || "Ready to Tune In";
  const displayArtist = currentTrack
    ? currentTrack.artist
    : artist?.trim() || "Select a station or search...";
  const displayArt =
    (currentTrack?.albumArtUrl || albumArt || "").trim();
  const displayAlbum = currentTrack?.album || album;
  const hasArt = Boolean(displayArt);

  return (
    <div className={`flex min-w-0 items-center gap-3 ${className}`.trim()}>
      <div
        className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/[0.08] bg-[#121215]"
        style={{ width: artSize, height: artSize }}
      >
        {hasArt ? (
          <Image
            src={displayArt}
            alt={`${displayTitle} album art`}
            width={artSize}
            height={artSize}
            className="object-cover"
            style={{ width: artSize, height: artSize }}
            unoptimized
          />
        ) : (
          <Radio
            className={artSize <= 40 ? "h-4 w-4 text-zinc-600" : "h-5 w-5 text-zinc-600"}
            aria-hidden="true"
          />
        )}
      </div>
      <TrackMetadata
        title={displayTitle}
        artist={displayArtist}
        album={displayAlbum}
        className="flex-1"
      />
    </div>
  );
}

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
};

/** Shared across ControlDeck + MobilePlayerSheet mounts so only one Wake Lock is held. */
let driveModeEnabled = false;
let wakeLockSentinel: WakeLockSentinelLike | null = null;
const driveModeListeners = new Set<() => void>();

function subscribeDriveMode(listener: () => void): () => void {
  driveModeListeners.add(listener);
  return () => {
    driveModeListeners.delete(listener);
  };
}

function getDriveModeSnapshot(): boolean {
  return driveModeEnabled;
}

function getDriveModeServerSnapshot(): boolean {
  return false;
}

function emitDriveMode(): void {
  for (const listener of driveModeListeners) listener();
}

async function releaseSharedWakeLock(): Promise<void> {
  const lock = wakeLockSentinel;
  wakeLockSentinel = null;
  if (!lock || lock.released) return;
  try {
    await lock.release();
  } catch (err) {
    console.warn("[SongGhost] Wake Lock release failed", err);
  }
}

async function requestSharedWakeLock(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
    return false;
  }

  try {
    const wakeLockApi = (
      navigator as Navigator & {
        wakeLock: {
          request: (type: "screen") => Promise<WakeLockSentinelLike>;
        };
      }
    ).wakeLock;
    const sentinel = await wakeLockApi.request("screen");
    wakeLockSentinel = sentinel;
    sentinel.addEventListener("release", () => {
      if (wakeLockSentinel === sentinel) {
        wakeLockSentinel = null;
      }
    });
    return true;
  } catch (err) {
    console.warn("[SongGhost] Wake Lock request failed", err);
    return false;
  }
}

async function setDriveMode(enabled: boolean): Promise<void> {
  driveModeEnabled = enabled;
  emitDriveMode();

  if (!enabled) {
    await releaseSharedWakeLock();
    return;
  }

  const ok = await requestSharedWakeLock();
  if (!ok) {
    driveModeEnabled = false;
    emitDriveMode();
  }
}

/**
 * Drive Mode / Keep Awake control for car mounts and long listening sessions.
 * Requests a screen Wake Lock while ON so the device does not dim or sleep.
 */
export function DriveModeToggle() {
  const driveMode = useSyncExternalStore(
    subscribeDriveMode,
    getDriveModeSnapshot,
    getDriveModeServerSnapshot,
  );
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      setSupported(false);
    }
  }, []);

  useEffect(() => {
    if (!driveMode) return;

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && driveModeEnabled) {
        void requestSharedWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [driveMode]);

  const toggleDriveMode = useCallback(() => {
    void setDriveMode(!driveModeEnabled);
  }, []);

  return (
    <button
      type="button"
      onClick={toggleDriveMode}
      disabled={!supported && !driveMode}
      aria-pressed={driveMode}
      aria-label={
        driveMode
          ? "Drive Mode on — tap to allow screen sleep"
          : "Drive Mode / Keep Awake — prevent screen sleep"
      }
      title={
        supported
          ? driveMode
            ? "Drive Mode on"
            : "Drive Mode / Keep Awake"
          : "Wake Lock not supported on this device"
      }
      className={[
        "flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-2 font-mono text-[10px] font-semibold uppercase tracking-widest transition-colors",
        driveMode
          ? "border-amber-500/50 bg-amber-500/15 text-amber-300"
          : "border-white/[0.08] bg-[#121215]/70 text-zinc-400 hover:border-amber-500/40 hover:text-amber-400",
        !supported && !driveMode ? "cursor-not-allowed opacity-50" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <MonitorSmartphone className="h-3 w-3" aria-hidden="true" />
      {driveMode ? "Drive On" : "Drive Mode"}
    </button>
  );
}

/** @deprecated Prefer {@link DriveModeToggle} — default export kept for existing mounts. */
export default function WebPlayer() {
  return <DriveModeToggle />;
}

export type HostControlsBarProps = {
  personaName: string;
  tuning: DjTuningSettings;
  onOpenSettings: () => void;
  settingsOpen?: boolean;
  status: OrchestratorStatus;
  onBreakNow: () => void;
  onSkipDj: () => void;
  canTriggerBreak?: boolean;
  /**
   * When false (no song loaded / session idle), Break Now and Skip DJ stay
   * disabled. The host badge remains interactive so settings can be opened
   * before tuning in.
   */
  hasCurrentTrack?: boolean;
  /** Opens the live session playlist queue modal. */
  onViewPlaylist?: () => void;
  /** Toggles the Script Teleprompter panel. */
  onTeleprompter?: () => void;
  teleprompterOpen?: boolean;
  /** Opens the Broadcast Log / history drawer. */
  onBroadcastLog?: () => void;
  /** Extra controls on the right (e.g. Drive Mode). */
  trailing?: ReactNode;
  className?: string;
};

function isDjTalking(status: OrchestratorStatus): boolean {
  return (
    status === "ON_AIR" ||
    status === "DUCKING" ||
    status === "RAMPING_UP"
  );
}

/**
 * Consolidated DJ Host Controls — persona badge, status pill, Break/Skip,
 * and utility shortcuts. Opens {@link HostSettingsModal} via the badge.
 *
 * Desktop: single compact horizontal toolbar.
 * Mobile: collapsed single-row banner that expands on tap.
 */
export function HostControlsBar({
  personaName,
  tuning,
  onOpenSettings,
  settingsOpen = false,
  status,
  onBreakNow,
  onSkipDj,
  canTriggerBreak = true,
  hasCurrentTrack = true,
  onViewPlaylist,
  onTeleprompter,
  teleprompterOpen = false,
  onBroadcastLog,
  trailing,
  className = "",
}: HostControlsBarProps) {
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const silent = tuning.pace === "silent";
  const talking = isDjTalking(status);
  const skipEnabled =
    hasCurrentTrack &&
    (status === "ON_AIR" || status === "PREFETCHING" || talking);
  const breakEnabled = hasCurrentTrack && canTriggerBreak;
  const breakBusy = talking || status === "PREFETCHING";

  const summary = silent
    ? `${personaName.toUpperCase()} • SILENT`
    : `${personaName.toUpperCase()} • ${DJ_PACE_LABELS[tuning.pace]} • ${DJ_KNOWLEDGE_LABELS[tuning.knowledge]}`;

  const statusPill = talking
    ? {
        label: "[ 🗣️ DJ TALKING ]",
        className:
          "border-amber-500/55 bg-amber-500/20 text-amber-200 shadow-[0_0_14px_rgba(245,158,11,0.45)]",
      }
    : status === "PREFETCHING"
      ? {
          label: "[ 🎤 DJ FETCHING ]",
          className: "border-amber-500/40 bg-amber-500/10 text-amber-300",
        }
      : {
          label: "[ 🎤 DJ STANDBY ]",
          className: "border-white/10 bg-zinc-950/60 text-zinc-400",
        };

  const touchBtn =
    "inline-flex min-h-9 sm:min-h-10 items-center justify-center rounded-lg px-2.5 sm:px-3 font-mono text-[10px] font-bold uppercase tracking-wider transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40";

  const utilityLink = (active = false) =>
    `inline-flex min-h-9 sm:min-h-10 items-center gap-1 rounded-lg px-2 font-sans text-xs transition-colors ${
      active ? "text-amber-400" : "text-zinc-400 hover:text-amber-400"
    }`;

  const renderHostBadge = () => (
    <button
      type="button"
      onClick={onOpenSettings}
      className="inline-flex min-h-9 sm:min-h-10 min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-1.5 text-left transition-colors hover:border-amber-500/60 hover:bg-amber-500/15"
      aria-haspopup="dialog"
      aria-expanded={settingsOpen}
      aria-label="Open Host Settings"
      title="Host Settings"
    >
      <Mic2 className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />
      <span className="truncate font-mono text-[10px] font-semibold uppercase tracking-wider text-amber-200">
        [ 🎙️ {summary} ]
      </span>
    </button>
  );

  const renderStatusBadge = () => (
    <span
      className={`inline-flex min-h-9 sm:min-h-10 shrink-0 items-center rounded-md border px-2 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${statusPill.className}`}
      role="status"
      aria-live="polite"
    >
      {statusPill.label}
    </span>
  );

  const renderActionButtons = () => (
    <>
      <button
        type="button"
        onClick={onBreakNow}
        disabled={!breakEnabled || breakBusy}
        className={`${touchBtn} border border-amber-500/45 bg-amber-500/15 text-amber-300 hover:border-amber-500/70 hover:bg-amber-500/25`}
        title={
          hasCurrentTrack
            ? "Force a host break on the current track"
            : "Tune in to a station before requesting a break"
        }
      >
        [ 🎤 BREAK NOW ]
      </button>
      <button
        type="button"
        onClick={onSkipDj}
        disabled={!skipEnabled}
        className={`${touchBtn} border border-white/[0.08] bg-zinc-950/80 text-zinc-300 hover:border-amber-500/35 hover:text-amber-300`}
        title={
          hasCurrentTrack
            ? "Mute / skip the active DJ break and resume music"
            : "No active DJ break while idle"
        }
      >
        [ 🔇 SKIP DJ ]
      </button>
      {onBroadcastLog && (
        <button
          type="button"
          onClick={onBroadcastLog}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono text-zinc-400 hover:text-amber-500 transition-colors rounded-md bg-zinc-900/60 border border-zinc-800"
          title="Broadcast Log"
        >
          <Clock className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Broadcast Log</span>
        </button>
      )}
      {onViewPlaylist && (
        <button
          type="button"
          onClick={onViewPlaylist}
          className={`${utilityLink()} shrink-0`}
          title="View Playlist"
        >
          <ListMusic className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only sm:not-sr-only sm:inline">Playlist</span>
        </button>
      )}
      {onTeleprompter && (
        <button
          type="button"
          onClick={onTeleprompter}
          aria-pressed={teleprompterOpen}
          className={`${utilityLink(teleprompterOpen)} shrink-0`}
          title="Teleprompter"
        >
          <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only sm:not-sr-only sm:inline">Teleprompter</span>
        </button>
      )}
      {trailing}
    </>
  );

  return (
    <div
      className={[
        "rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#121215] px-4 py-2.5 backdrop-blur-md",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role="group"
      aria-label="DJ Host Controls"
    >
      {/* Mobile: compact collapsible banner */}
      <div className="sm:hidden">
        <div className="flex w-full items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
            {renderHostBadge()}
            {renderStatusBadge()}
          </div>
          <button
            type="button"
            onClick={() => setMobileExpanded((open) => !open)}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/[0.08] text-zinc-400"
            aria-expanded={mobileExpanded}
            aria-controls="dj-host-controls-mobile"
            aria-label={mobileExpanded ? "Collapse DJ controls" : "Expand DJ controls"}
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${
                mobileExpanded ? "rotate-180" : ""
              }`}
              aria-hidden="true"
            />
          </button>
        </div>
        {mobileExpanded && (
          <div
            id="dj-host-controls-mobile"
            className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5"
          >
            {renderActionButtons()}
          </div>
        )}
      </div>

      {/* Desktop / tablet: single compact horizontal toolbar */}
      <div className="hidden items-center justify-between gap-3 sm:flex">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          {renderHostBadge()}
          {renderStatusBadge()}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {renderActionButtons()}
        </div>
      </div>
    </div>
  );
}

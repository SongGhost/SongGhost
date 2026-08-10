"use client";

import {
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
  spotifyUriForQueueTrack,
  startSilentAudioAnchor,
  subscribeCurrentTrackState,
  type ActiveTrackState,
  type OrchestratorStatus,
} from "@/lib/player/webOrchestrator";
import {
  getSpotifyActiveDeviceId,
  isNoActiveDeviceResult,
  transferPlaybackToLocalDevice,
  type SpotifyPlaybackResult,
} from "@/lib/player/spotifyRemote";
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

export type HandlePlayPauseOptions = {
  isPlaying: boolean;
  /** Hydration-aware Spotify resume (orchestrator `resume` / `togglePlay`). */
  resume: () => Promise<SpotifyPlaybackResult>;
  pause: () => Promise<SpotifyPlaybackResult>;
  /**
   * Explicit URI play used when bare resume has no SDK playback context
   * (restored track after reboot / refresh).
   */
  playTrack: (uri: string) => Promise<unknown>;
  /** Optional override; defaults to shared now-playing / restored metadata. */
  restoredTrackUri?: string | null;
};

/**
 * Resolve a Spotify URI from the shared now-playing snapshot stamped by the
 * queue / SDK after a page reboot.
 */
export function resolveRestoredTrackUri(
  override?: string | null,
): string | null {
  const trimmed = override?.trim();
  if (trimmed?.startsWith("spotify:track:")) return trimmed;
  if (trimmed) {
    const fromOverride = spotifyUriForQueueTrack({ id: trimmed, spotifyId: trimmed });
    if (fromOverride) return fromOverride;
  }

  const current = getCurrentTrackState();
  if (!current?.id) return null;
  return spotifyUriForQueueTrack({ id: current.id, spotifyId: current.id });
}

/**
 * Transport Play / Pause with Spotify session hydration.
 *
 * After a page refresh the Web Playback SDK often has a device_id but no active
 * track context, so `resume()` fails silently. This helper retries with
 * `transferPlayback` + `playTrack(restoredUri)` and logs swallowed rejections.
 */
export async function handlePlayPause(
  options: HandlePlayPauseOptions,
): Promise<void> {
  const { isPlaying, resume, pause, playTrack } = options;

  try {
    if (isPlaying) {
      const paused = await pause();
      if (paused !== true) {
        console.warn("[WebPlayer] pause() did not confirm:", paused);
      }
      return;
    }

    let result: SpotifyPlaybackResult = false;
    try {
      result = await resume();
    } catch (error) {
      console.warn(
        "[WebPlayer] resume() rejected — will transfer + playTrack",
        error,
      );
      result = false;
    }

    if (result === true) return;

    console.warn(
      "[WebPlayer] resume failed or no playback context — transfer + playTrack",
      result,
    );

    const deviceId = getSpotifyActiveDeviceId()?.trim() || "";
    if (deviceId) {
      try {
        const transferred = await transferPlaybackToLocalDevice(deviceId, false);
        if (transferred !== true && !isNoActiveDeviceResult(transferred)) {
          console.warn(
            "[WebPlayer] transferPlayback did not confirm:",
            transferred,
          );
        } else if (isNoActiveDeviceResult(transferred)) {
          console.warn(
            "[WebPlayer] transferPlayback — no active device:",
            transferred,
          );
        }
      } catch (error) {
        console.warn("[WebPlayer] transferPlayback rejected:", error);
      }
    } else {
      console.warn(
        "[WebPlayer] No Spotify device_id available for transferPlayback retry",
      );
    }

    const uri = resolveRestoredTrackUri(options.restoredTrackUri);
    if (!uri) {
      console.warn(
        "[WebPlayer] No restored track URI available after resume failure",
      );
      return;
    }

    try {
      await playTrack(uri);
    } catch (error) {
      console.error(
        "[WebPlayer] playTrack(restored) rejected after transfer retry:",
        error,
      );
    }
  } catch (error) {
    console.error("[WebPlayer] handlePlayPause swallowed SDK rejection:", error);
  }
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
  /**
   * Genre / Liner Notes / share pills. Rendered in a wrap row under the
   * truncated title+artist so badges never clip against transport controls.
   */
  badges?: ReactNode;
};

/**
 * Header now-playing chrome bound to orchestrator `currentTrack`.
 * Falls back to idle copy until a queue opener or SDK event stamps metadata.
 *
 * Layout invariants (deck badge row):
 * - Outer track column uses `min-w-0 flex-1` so title/artist can shrink.
 * - Title + artist strings truncate inside {@link TrackMetadata}.
 * - Optional `badges` render in a wrap row with `shrink-0` so pills (genre,
 *   Liner Notes) are never clipped by transport controls.
 */
export function NowPlayingHeader({
  title,
  artist,
  albumArt,
  album = null,
  artSize = 48,
  className = "",
  badges,
}: NowPlayingHeaderProps) {
  const currentTrack = useActiveTrack();
  // Bind directly to the shared now-playing emit; props are idle fallbacks only.
  const displayTitle =
    currentTrack?.title?.trim() || title?.trim() || "Ready to Tune In";
  const displayArtist =
    currentTrack?.artist?.trim() ||
    artist?.trim() ||
    "Select a station or search...";
  const displayArt = (currentTrack?.albumArtUrl || albumArt || "").trim();
  const displayAlbum = currentTrack?.album || album;
  const hasArt = Boolean(displayArt);
  const trackMetaKey =
    currentTrack?.id?.trim() ||
    [displayTitle, displayArtist].filter(Boolean).join("\0") ||
    "idle";

  return (
    <div
      key={trackMetaKey}
      className={`flex min-w-0 items-center gap-3 ${className}`.trim()}
    >
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
      <div className="min-w-0 flex-1">
        <TrackMetadata
          title={displayTitle}
          artist={displayArtist}
          album={displayAlbum}
          className="min-w-0"
        />
        {badges ? (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 shrink-0">
            {badges}
          </div>
        ) : null}
      </div>
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
          ? "border-accent/50 bg-accent/15 text-accent"
          : "border-white/[0.08] bg-[#121215]/70 text-zinc-400 hover:border-accent/40 hover:text-accent",
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

const HOST_PRESET_BADGE_CLASS =
  "bg-accent/10 border border-accent/40 text-accent font-mono text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5 cursor-pointer hover:bg-accent/20 transition-colors";

const STATUS_BADGE_CLASS =
  "bg-zinc-900 border border-zinc-800 text-zinc-400 font-mono text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5";

const PRIMARY_ACTION_CLASS =
  "bg-zinc-900 border border-zinc-700 hover:border-accent/50 text-zinc-200 hover:text-accent font-mono text-xs font-medium px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-700 disabled:hover:text-zinc-200";

const UTILITY_BUTTON_CLASS =
  "bg-zinc-900/60 border border-zinc-800/80 hover:border-zinc-700 text-zinc-400 hover:text-white font-mono text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors cursor-pointer";

/**
 * Consolidated DJ Host Controls — persona badge, status pill, Break/Skip,
 * and utility shortcuts. Opens {@link HostSettingsModal} via the badge.
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

  const statusLabel = talking
    ? "DJ TALKING"
    : status === "PREFETCHING"
      ? "DJ FETCHING"
      : "DJ STANDBY";

  const statusBadgeClass = talking
    ? "bg-accent/10 border border-accent/40 text-accent font-mono text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5"
    : status === "PREFETCHING"
      ? "bg-accent/10 border border-accent/30 text-accent font-mono text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5"
      : STATUS_BADGE_CLASS;

  return (
    <div
      className={[
        "flex flex-wrap items-center gap-2 py-2 px-3 bg-[#121215]/80 border border-zinc-800/60 rounded-lg",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role="group"
      aria-label="DJ Host Controls"
    >
      <button
        type="button"
        onClick={onOpenSettings}
        className={`${HOST_PRESET_BADGE_CLASS} min-w-0 max-w-full`}
        aria-haspopup="dialog"
        aria-expanded={settingsOpen}
        aria-label="Open Host Settings"
        title="Host Settings"
      >
        <Mic2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate uppercase tracking-wider">{summary}</span>
      </button>

      <span className={statusBadgeClass} role="status" aria-live="polite">
        {statusLabel}
      </span>

      <button
        type="button"
        onClick={onBreakNow}
        disabled={!breakEnabled || breakBusy}
        className={PRIMARY_ACTION_CLASS}
        title={
          hasCurrentTrack
            ? "Force a host break on the current track"
            : "Tune in to a station before requesting a break"
        }
      >
        BREAK NOW
      </button>

      <button
        type="button"
        onClick={onSkipDj}
        disabled={!skipEnabled}
        className={PRIMARY_ACTION_CLASS}
        title={
          hasCurrentTrack
            ? "Mute / skip the active DJ break and resume music"
            : "No active DJ break while idle"
        }
      >
        SKIP DJ
      </button>

      {onBroadcastLog && (
        <button
          type="button"
          onClick={onBroadcastLog}
          className={UTILITY_BUTTON_CLASS}
          title="Broadcast Log"
        >
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Broadcast Log</span>
        </button>
      )}

      {onViewPlaylist && (
        <button
          type="button"
          onClick={onViewPlaylist}
          className={UTILITY_BUTTON_CLASS}
          title="View Playlist"
        >
          <ListMusic className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Playlist</span>
        </button>
      )}

      {onTeleprompter && (
        <button
          type="button"
          onClick={onTeleprompter}
          aria-pressed={teleprompterOpen}
          className={`${UTILITY_BUTTON_CLASS}${
            teleprompterOpen ? " border-zinc-700 text-white" : ""
          }`}
          title="Teleprompter"
        >
          <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Teleprompter</span>
        </button>
      )}

      {trailing}
    </div>
  );
}

"use client";

import {
  FileText,
  History,
  ListMusic,
  Lock,
  Mic2,
  MicOff,
  MonitorSmartphone,
  Radio,
  SkipForward,
  Zap,
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
import { Tooltip } from "@/components/ui/Tooltip";
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
   * Whether a Spotify/Apple companion stream is connected. Gates Break Now /
   * DJ Standby affordances on Free (YouTube-only) sessions.
   */
  companionActive?: boolean;
  /**
   * When true, Free-tier monthly break quota is exhausted — Break Now shows a
   * lock and remains clickable so the upgrade modal can open.
   */
  breakQuotaLocked?: boolean;
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

/** Shared Broadcast Deck control chrome — Live Actions + View Drawers. */
const DECK_BUTTON_CLASS =
  "h-9 px-3.5 rounded-md text-xs font-medium tracking-wider uppercase flex items-center gap-1.5 transition-colors bg-zinc-900 border border-zinc-700 text-zinc-200 hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-700 disabled:hover:text-zinc-200";

const HOST_STUDIO_PILL_CLASS =
  "min-w-0 max-w-full h-9 px-3.5 rounded-md flex items-center gap-2 border border-cyan-500/50 bg-cyan-950/30 text-cyan-100 hover:bg-cyan-900/50 hover:border-cyan-400 transition-colors cursor-pointer";

const HOST_STUDIO_TIP =
  "Host Studio — Click to change DJ persona, vocal energy, or custom directives.";
const DJ_STANDBY_TIP =
  "DJ Standby — Pause host breaks temporarily while keeping music playing.";
const BREAK_NOW_TIP =
  "Trigger Break Now — Force an immediate DJ break over the active track.";
const SKIP_DJ_TIP =
  "Skip DJ Speech — Cancel active DJ voice and return to 100% music volume.";
const BROADCAST_LOG_TIP =
  "Broadcast Log — View spoken script history and broadcast telemetry.";
const PLAYLIST_TIP =
  "Station Queue — View, reorder, or edit upcoming tracks.";
const TELEPROMPTER_TIP =
  "Live Teleprompter — Follow along with live scrolling speech text.";

/** Title-case Tuning Console labels for the Host Studio rules line. */
function formatHostRuleLabel(label: string): string {
  return label.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Consolidated DJ Host Controls — Host Studio hero pill + Broadcast Deck.
 * Opens {@link HostSettingsModal} via the cyan Host Studio pill.
 */
const COMPANION_REQUIRED_STANDBY_TIP = "Companion required for DJ Standby";

export function HostControlsBar({
  personaName,
  tuning,
  onOpenSettings,
  settingsOpen = false,
  status,
  onBreakNow,
  onSkipDj,
  canTriggerBreak = true,
  companionActive = true,
  breakQuotaLocked = false,
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
  const breakEnabled =
    breakQuotaLocked || (hasCurrentTrack && canTriggerBreak);
  const breakBusy = !breakQuotaLocked && (talking || status === "PREFETCHING");
  const standbyArmed = companionActive && hasCurrentTrack && !silent;
  const companionRequiredTip =
    !companionActive && hasCurrentTrack ? COMPANION_REQUIRED_STANDBY_TIP : null;

  // `personaName` is resolved upstream (ControlDeck) from preferredVoice /
  // activePersona so Free-tier picks like Onyx update this pill immediately.
  const hostRules = silent
    ? "Silent"
    : `${formatHostRuleLabel(DJ_PACE_LABELS[tuning.pace])} • ${formatHostRuleLabel(DJ_KNOWLEDGE_LABELS[tuning.knowledge])}`;

  const standbyStateLabel = talking
    ? "DJ Talking"
    : status === "PREFETCHING"
      ? "DJ Fetching"
      : "DJ Standby";

  const standbyButtonClass = talking
    ? `${DECK_BUTTON_CLASS} border-accent/40 bg-accent/10 text-accent shadow-[0_0_12px_var(--brand-accent-glow)]`
    : status === "PREFETCHING"
      ? `${DECK_BUTTON_CLASS} border-accent/30 bg-accent/10 text-accent`
      : standbyArmed
        ? `${DECK_BUTTON_CLASS} border-accent/25 bg-accent/5 text-accent/90`
        : `${DECK_BUTTON_CLASS} border-zinc-800/70 bg-zinc-950/80 text-zinc-600 opacity-70`;

  const standbyTip = companionRequiredTip ?? DJ_STANDBY_TIP;
  const breakTip = breakQuotaLocked
    ? "Monthly free DJ breaks used up — upgrade to Pro for unlimited breaks"
    : companionRequiredTip ?? BREAK_NOW_TIP;
  const skipTip = hasCurrentTrack ? SKIP_DJ_TIP : "No active DJ break while idle";

  const showViewDrawers = Boolean(
    onBroadcastLog || onViewPlaylist || onTeleprompter,
  );

  return (
    <div
      className={[
        "flex flex-wrap items-center justify-between gap-2 py-2 px-3 bg-[#121215]/80 border border-zinc-800/60 rounded-lg",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role="group"
      aria-label="DJ Host Controls"
    >
      {/* Left zone — Host Studio hero pill */}
      <Tooltip content={HOST_STUDIO_TIP} delayDuration={200} className="min-w-0">
        <button
          type="button"
          onClick={onOpenSettings}
          className={HOST_STUDIO_PILL_CLASS}
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          aria-label={`Host Studio — ${personaName}, ${hostRules}. Open settings.`}
        >
          <Mic2 className="h-3.5 w-3.5 shrink-0 text-cyan-300" aria-hidden="true" />
          <span className="truncate text-xs font-semibold tracking-wide text-cyan-50">
            {personaName}
          </span>
          <span className="hidden min-w-0 truncate text-[11px] font-medium tracking-wide text-cyan-200/70 sm:inline">
            {hostRules}
          </span>
          <span className="shrink-0 text-sm leading-none" aria-hidden="true">
            ⚙️
          </span>
          <span className="shrink-0 text-xs leading-none text-cyan-300/80" aria-hidden="true">
            ▾
          </span>
        </button>
      </Tooltip>

      {/* Right zone — Broadcast Deck */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Tooltip content={standbyTip} delayDuration={200}>
            <span
              className={standbyButtonClass}
              role="status"
              aria-live="polite"
              aria-label={standbyStateLabel}
              aria-disabled={!standbyArmed && !talking && status !== "PREFETCHING"}
            >
              <MicOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>DJ Standby</span>
            </span>
          </Tooltip>

          <Tooltip content={breakTip} delayDuration={200}>
            <button
              type="button"
              onClick={onBreakNow}
              disabled={!breakEnabled || breakBusy}
              className={DECK_BUTTON_CLASS}
              aria-label={
                breakQuotaLocked
                  ? "Break Now locked — monthly free limit reached"
                  : companionRequiredTip
                    ? companionRequiredTip
                    : "Break Now"
              }
            >
              {breakQuotaLocked ? (
                <Lock className="h-3.5 w-3.5 shrink-0 text-accent/80" aria-hidden="true" />
              ) : (
                <Zap className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
              <span>Break Now</span>
            </button>
          </Tooltip>

          <Tooltip content={skipTip} delayDuration={200}>
            <button
              type="button"
              onClick={onSkipDj}
              disabled={!skipEnabled}
              className={DECK_BUTTON_CLASS}
              aria-label="Skip DJ"
            >
              <SkipForward className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Skip DJ</span>
            </button>
          </Tooltip>
        </div>

        {showViewDrawers && (
          <>
            <div
              className="border-r border-slate-700/60 h-5 my-auto mx-1"
              aria-hidden="true"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              {onBroadcastLog && (
                <Tooltip content={BROADCAST_LOG_TIP} delayDuration={200}>
                  <button
                    type="button"
                    onClick={onBroadcastLog}
                    className={DECK_BUTTON_CLASS}
                    aria-label="Broadcast Log"
                  >
                    <History className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>Broadcast Log</span>
                  </button>
                </Tooltip>
              )}

              {onViewPlaylist && (
                <Tooltip content={PLAYLIST_TIP} delayDuration={200}>
                  <button
                    type="button"
                    onClick={onViewPlaylist}
                    className={DECK_BUTTON_CLASS}
                    aria-label="Playlist"
                  >
                    <ListMusic className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>Playlist</span>
                  </button>
                </Tooltip>
              )}

              {onTeleprompter && (
                <Tooltip content={TELEPROMPTER_TIP} delayDuration={200}>
                  <button
                    type="button"
                    onClick={onTeleprompter}
                    aria-pressed={teleprompterOpen}
                    className={`${DECK_BUTTON_CLASS}${
                      teleprompterOpen ? " border-zinc-500 text-white" : ""
                    }`}
                    aria-label="Teleprompter"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>Teleprompter</span>
                  </button>
                </Tooltip>
              )}
            </div>
          </>
        )}

        {trailing}
      </div>
    </div>
  );
}

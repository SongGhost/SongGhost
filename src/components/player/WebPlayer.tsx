"use client";

import {
  ChevronDown,
  FileText,
  History,
  ListMusic,
  Lock,
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
  useRef,
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
} from "@/lib/audio/legacy/webOrchestrator";
import {
  getSpotifyActiveDeviceId,
  isNoActiveDeviceResult,
  transferPlaybackToLocalDevice,
  type SpotifyPlaybackResult,
} from "@/lib/audio/legacy/spotifyRemote";
import {
  COMMENTARY_FORMAT_LABELS,
  DJ_PACE_LABELS,
  resolveCommentaryFormat,
  type CommentaryFormat,
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

/** Enable / disable Drive Mode (shared wake lock + overlay flag). */
export async function setDriveMode(enabled: boolean): Promise<void> {
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

/** Live Drive Mode flag for overlays and transport chrome. */
export function useDriveMode(): boolean {
  return useSyncExternalStore(
    subscribeDriveMode,
    getDriveModeSnapshot,
    getDriveModeServerSnapshot,
  );
}

/**
 * Drive Mode / Keep Awake control for car mounts and long listening sessions.
 * Requests a screen Wake Lock while ON so the device does not dim or sleep.
 */
export function DriveModeToggle() {
  const driveMode = useDriveMode();
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
  /**
   * Preformatted Host Studio summary (`Natural Pace • Director's Cut`).
   * Injected by `HostBar` from live `commentaryFormat` prefs so the pill
   * updates the instant Lore & Commentary changes in Host Settings.
   */
  hostRules?: string;
  /** Fallback lore label when `hostRules` is omitted. */
  commentaryFormat?: CommentaryFormat;
  onOpenSettings: () => void;
  settingsOpen?: boolean;
  status?: OrchestratorStatus;
  onBreakNow?: () => void;
  onSkipDj?: () => void;
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
  /**
   * Model 3 Host Retention — when true the badge shows Host Locked chrome
   * and the inline Reset control.
   */
  isHostLocked?: boolean;
  /** Clears the host lock and auto-matches the active station's default host. */
  onResetHostLock?: () => void;
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
  "h-9 px-3.5 rounded-md font-sans text-xs font-medium uppercase tracking-wider flex items-center gap-1.5 transition-colors bg-zinc-900 border border-zinc-700 text-zinc-200 hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-700 disabled:hover:text-zinc-200";

/** Icon-only sibling of {@link DECK_BUTTON_CLASS} for md+ drawer triggers. */
const DECK_ICON_BUTTON_CLASS =
  "h-9 w-9 px-0 justify-center rounded-md font-sans text-xs font-medium uppercase tracking-wider flex items-center transition-colors bg-zinc-900 border border-zinc-700 text-zinc-200 hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-zinc-700 disabled:hover:text-zinc-200";

const HOST_STUDIO_PILL_AUTO_CLASS =
  "min-w-0 flex-1 h-9 px-3.5 rounded-md font-sans text-xs font-medium uppercase tracking-wider flex items-center gap-2 border border-slate-800 bg-slate-900/80 text-slate-300 hover:border-slate-700 transition-colors";

const HOST_STUDIO_PILL_LOCKED_CLASS =
  "min-w-0 flex-1 h-9 px-3.5 rounded-md font-sans text-xs font-medium uppercase tracking-wider flex items-center gap-2 border border-cyan-500/50 bg-cyan-950/40 text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.15)] transition-colors";

const HOST_STUDIO_TIP_AUTO =
  "Auto-matched to station genre. Click to lock custom host or settings.";
const HOST_STUDIO_TIP_LOCKED =
  "Host locked across all stations. Click (Reset) to return to station auto-matching.";
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
const HOST_CONTROLS_TIP =
  "Host Controls — Broadcast Log, Playlist, and Teleprompter.";

/** Pace • commentary summary when `HostBar` has not injected `hostRules`. */
function formatHostRulesFallback(
  pace: DjTuningSettings["pace"],
  commentaryFormat: CommentaryFormat | undefined,
): string {
  if (pace === "silent") return DJ_PACE_LABELS.silent;
  return `${DJ_PACE_LABELS[pace]} • ${COMMENTARY_FORMAT_LABELS[resolveCommentaryFormat(commentaryFormat)]}`;
}

/**
 * Consolidated DJ Host Controls — Host Studio hero pill + Broadcast Deck.
 * Opens {@link HostSettingsModal} via the Host Studio pill.
 */
const COMPANION_REQUIRED_STANDBY_TIP = "Companion required for DJ Standby";

export type HostLiveActionsProps = {
  status?: OrchestratorStatus;
  onBreakNow: () => void;
  onSkipDj: () => void;
  canTriggerBreak?: boolean;
  companionActive?: boolean;
  breakQuotaLocked?: boolean;
  hasCurrentTrack?: boolean;
  /** Silent pace hides armed Standby chrome — Host Studio pace. */
  silentPace?: boolean;
  isHostLocked?: boolean;
};

/**
 * Manual DJ overrides — Break Now, Skip DJ, DJ Standby status.
 * Rendered inside Host Studio (Live Actions), not on the transport dock.
 */
export function HostLiveActions({
  status = "STANDBY",
  onBreakNow,
  onSkipDj,
  canTriggerBreak = true,
  companionActive = true,
  breakQuotaLocked = false,
  hasCurrentTrack = true,
  silentPace = false,
  isHostLocked = false,
}: HostLiveActionsProps) {
  const talking = isDjTalking(status);
  const skipEnabled =
    hasCurrentTrack &&
    (status === "ON_AIR" || status === "PREFETCHING" || talking);
  const breakEnabled =
    breakQuotaLocked || (hasCurrentTrack && canTriggerBreak);
  const breakBusy = !breakQuotaLocked && (talking || status === "PREFETCHING");
  const standbyArmed = companionActive && hasCurrentTrack && !silentPace;
  const companionRequiredTip =
    !companionActive && hasCurrentTrack ? COMPANION_REQUIRED_STANDBY_TIP : null;

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

  return (
    <div className="flex flex-col gap-2">
      {isHostLocked ? (
        <p className="font-mono text-[10px] uppercase tracking-widest text-cyan-400/90">
          Host Locked
        </p>
      ) : null}
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
    </div>
  );
}

export function HostControlsBar({
  personaName,
  tuning,
  hostRules: hostRulesProp,
  commentaryFormat,
  onOpenSettings,
  settingsOpen = false,
  onViewPlaylist,
  onTeleprompter,
  teleprompterOpen = false,
  onBroadcastLog,
  isHostLocked = false,
  onResetHostLock,
  trailing,
  className = "",
}: HostControlsBarProps) {
  // `personaName` is resolved upstream (ControlDeck) from preferredVoice /
  // activePersona so Free-tier picks like Onyx update this pill immediately.
  const hostRules =
    hostRulesProp
    ?? formatHostRulesFallback(tuning.pace, commentaryFormat);

  const showViewDrawers = Boolean(
    onBroadcastLog || onViewPlaylist || onTeleprompter,
  );

  const [studioDrawersOpen, setStudioDrawersOpen] = useState(false);
  const studioDrawersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!studioDrawersOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!studioDrawersRef.current?.contains(event.target as Node)) {
        setStudioDrawersOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setStudioDrawersOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [studioDrawersOpen]);

  const runDrawerAction = useCallback((action?: () => void) => {
    action?.();
    setStudioDrawersOpen(false);
  }, []);

  const hostStudioTip = isHostLocked
    ? HOST_STUDIO_TIP_LOCKED
    : HOST_STUDIO_TIP_AUTO;
  const hostStudioPillClass = isHostLocked
    ? HOST_STUDIO_PILL_LOCKED_CLASS
    : HOST_STUDIO_PILL_AUTO_CLASS;
  const hostDisplayName = personaName.trim() || "Host";

  return (
    <div
      className={[
        "flex flex-row flex-nowrap items-center justify-between gap-2 py-1 px-0 sm:px-1",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role="group"
      aria-label="DJ Host Controls"
    >
      {/* Left zone — Host Studio retention badge */}
      <Tooltip content={hostStudioTip} delayDuration={200} className="min-w-0 flex-1">
        <div className={hostStudioPillClass} role="group" aria-label="Host Studio">
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
            aria-label={
              isHostLocked
                ? `Host Studio — ${hostDisplayName}, Host Locked, ${hostRules}. Open settings.`
                : `Host Studio — ${hostDisplayName}, Auto-Matched, ${hostRules}. Open settings.`
            }
          >
            <span className="shrink-0 text-sm leading-none" aria-hidden="true">
              {isHostLocked ? "🔒" : "🎙️"}
            </span>
            <span className="truncate tracking-wide">
              {hostDisplayName}
            </span>
            <span className="hidden min-w-0 truncate tracking-wide sm:inline">
              • {isHostLocked ? "Host Locked" : "Auto-Matched"}
            </span>
          </button>
          {isHostLocked && onResetHostLock ? (
            <button
              type="button"
              onClick={onResetHostLock}
              className="shrink-0 rounded px-1 font-sans text-xs font-medium uppercase tracking-wider text-cyan-200 underline-offset-2 hover:underline"
              aria-label="Reset host lock and auto-match to the active station"
              title="Reset host lock"
            >
              (Reset)
            </button>
          ) : null}
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex shrink-0 items-center gap-1.5"
            aria-hidden="true"
            tabIndex={-1}
          >
            <span className="hidden min-w-0 truncate tracking-wide md:inline">
              | {hostRules}
            </span>
            <span className="leading-none" aria-hidden="true">
              ⚙️
            </span>
            <span className="leading-none opacity-80" aria-hidden="true">
              ▾
            </span>
          </button>
        </div>
      </Tooltip>

      {/* Right zone — Broadcast Deck drawers */}
      <div className="flex flex-row flex-nowrap shrink-0 items-center gap-1.5">
        {showViewDrawers && (
          <>
            {/* < 768px: collapse Broadcast Log / Playlist / Teleprompter */}
            <div className="relative md:hidden" ref={studioDrawersRef}>
              <Tooltip content={HOST_CONTROLS_TIP} delayDuration={200}>
                <button
                  type="button"
                  onClick={() => setStudioDrawersOpen((open) => !open)}
                  className={DECK_BUTTON_CLASS}
                  aria-haspopup="menu"
                  aria-expanded={studioDrawersOpen}
                  aria-label="Host Controls"
                >
                  <span aria-hidden="true">📑</span>
                  <span>Host Controls</span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 shrink-0 transition-transform ${
                      studioDrawersOpen ? "rotate-180" : ""
                    }`}
                    aria-hidden="true"
                  />
                </button>
              </Tooltip>
              {studioDrawersOpen ? (
                <div
                  role="menu"
                  aria-label="Host Controls"
                  className="absolute right-0 z-40 mt-1 min-w-[11rem] overflow-hidden rounded-md border border-zinc-700 bg-zinc-950/95 py-1 shadow-xl backdrop-blur-md"
                >
                  {onBroadcastLog ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => runDrawerAction(onBroadcastLog)}
                      className="flex w-full items-center gap-2 px-3 py-2 font-sans text-xs font-medium uppercase tracking-wider text-zinc-200 hover:bg-zinc-900 hover:text-accent"
                    >
                      <History className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      Broadcast Log
                    </button>
                  ) : null}
                  {onViewPlaylist ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => runDrawerAction(onViewPlaylist)}
                      className="flex w-full items-center gap-2 px-3 py-2 font-sans text-xs font-medium uppercase tracking-wider text-zinc-200 hover:bg-zinc-900 hover:text-accent"
                    >
                      <ListMusic className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      Playlist
                    </button>
                  ) : null}
                  {onTeleprompter ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => runDrawerAction(onTeleprompter)}
                      className={`flex w-full items-center gap-2 px-3 py-2 font-sans text-xs font-medium uppercase tracking-wider hover:bg-zinc-900 hover:text-accent ${
                        teleprompterOpen ? "text-white" : "text-zinc-200"
                      }`}
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      Teleprompter
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* md+: icon-only drawers — labels live in Tooltip + aria-label */}
            <div className="hidden flex-wrap items-center gap-1.5 md:flex">
              {onBroadcastLog && (
                <Tooltip content={BROADCAST_LOG_TIP} delayDuration={200}>
                  <button
                    type="button"
                    onClick={onBroadcastLog}
                    className={DECK_ICON_BUTTON_CLASS}
                    aria-label="Broadcast Log"
                  >
                    <History className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  </button>
                </Tooltip>
              )}

              {onViewPlaylist && (
                <Tooltip content={PLAYLIST_TIP} delayDuration={200}>
                  <button
                    type="button"
                    onClick={onViewPlaylist}
                    className={DECK_ICON_BUTTON_CLASS}
                    aria-label="Playlist"
                  >
                    <ListMusic className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  </button>
                </Tooltip>
              )}

              {onTeleprompter && (
                <Tooltip content={TELEPROMPTER_TIP} delayDuration={200}>
                  <button
                    type="button"
                    onClick={onTeleprompter}
                    aria-pressed={teleprompterOpen}
                    className={`${DECK_ICON_BUTTON_CLASS}${
                      teleprompterOpen ? " border-zinc-500 text-white" : ""
                    }`}
                    aria-label="Teleprompter"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
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

"use client";

import {
  History,
  ListMusic,
  Mic2,
  MonitorSmartphone,
  ScrollText,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { OrchestratorStatus } from "@/lib/player/webOrchestrator";
import {
  DJ_KNOWLEDGE_LABELS,
  DJ_PACE_LABELS,
  type DjTuningSettings,
} from "@/types/dj";

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
  onViewPlaylist,
  onTeleprompter,
  teleprompterOpen = false,
  onBroadcastLog,
  trailing,
  className = "",
}: HostControlsBarProps) {
  const silent = tuning.pace === "silent";
  const talking = isDjTalking(status);
  const skipEnabled = status === "ON_AIR" || status === "PREFETCHING" || talking;
  const breakBusy =
    talking || status === "PREFETCHING";

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
    "inline-flex min-h-11 items-center justify-center rounded-lg px-3 font-mono text-[10px] font-bold uppercase tracking-wider transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40";

  const utilityLink = (active = false) =>
    `inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 font-sans text-xs transition-colors ${
      active ? "text-amber-400" : "text-zinc-400 hover:text-amber-400"
    }`;

  return (
    <div
      className={[
        "flex flex-col gap-2.5 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#121215] px-3 py-2.5 backdrop-blur-md",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role="group"
      aria-label="DJ Host Controls"
    >
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between lg:gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex min-h-11 min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-left transition-colors hover:border-amber-500/60 hover:bg-amber-500/15"
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

          <span
            className={`inline-flex min-h-11 shrink-0 items-center rounded-md border px-2.5 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider ${statusPill.className}`}
            role="status"
            aria-live="polite"
          >
            {statusPill.label}
          </span>
        </div>

        <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
          <button
            type="button"
            onClick={onBreakNow}
            disabled={!canTriggerBreak || breakBusy}
            className={`${touchBtn} flex-1 border border-amber-500/45 bg-amber-500/15 text-amber-300 hover:border-amber-500/70 hover:bg-amber-500/25 sm:flex-none`}
            title="Force a host break on the current track"
          >
            [ 🎤 BREAK NOW ]
          </button>
          <button
            type="button"
            onClick={onSkipDj}
            disabled={!skipEnabled}
            className={`${touchBtn} flex-1 border border-white/[0.08] bg-zinc-950/80 text-zinc-300 hover:border-amber-500/35 hover:text-amber-300 sm:flex-none`}
            title="Mute / skip the active DJ break and resume music"
          >
            [ 🔇 SKIP DJ ]
          </button>
          {trailing}
        </div>
      </div>

      {(onViewPlaylist || onTeleprompter || onBroadcastLog) && (
        <div className="flex flex-wrap items-center gap-1 border-t border-white/[0.06] pt-2">
          {onViewPlaylist && (
            <button
              type="button"
              onClick={onViewPlaylist}
              className={utilityLink()}
            >
              <ListMusic className="h-3.5 w-3.5" aria-hidden="true" />
              View Playlist
            </button>
          )}
          {onTeleprompter && (
            <button
              type="button"
              onClick={onTeleprompter}
              aria-pressed={teleprompterOpen}
              className={utilityLink(teleprompterOpen)}
            >
              <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
              Teleprompter
            </button>
          )}
          {onBroadcastLog && (
            <button
              type="button"
              onClick={onBroadcastLog}
              className={utilityLink()}
            >
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              Broadcast Log
            </button>
          )}
        </div>
      )}
    </div>
  );
}

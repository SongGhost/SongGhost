"use client";

import { MonitorSmartphone } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

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
export default function WebPlayer() {
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
        "flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-widest transition-colors",
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

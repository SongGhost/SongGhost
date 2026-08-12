"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** Default DJ TTS / voice-break gain (0–1). Used only when nothing is stored. */
export const DEFAULT_DJ_VOLUME = 0.85;

/** Canonical localStorage key for the Host Settings DJ Voice Volume slider. */
export const DJ_VOLUME_STORAGE_KEY = "songghost_dj_volume";

/**
 * Legacy / typo alias — still read on boot so older sessions keep their level.
 * Writes always go to {@link DJ_VOLUME_STORAGE_KEY}.
 */
const LEGACY_DJ_VOLUME_STORAGE_KEYS = ["songhost_dj_volume"] as const;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function clampDjVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DJ_VOLUME;
  return Math.min(1, Math.max(0, value));
}

/**
 * Read the persisted DJ voice multiplier.
 * Returns {@link DEFAULT_DJ_VOLUME} only when no stored value exists.
 */
export function loadDjVolume(): number {
  if (!isBrowser()) return DEFAULT_DJ_VOLUME;

  const keys = [DJ_VOLUME_STORAGE_KEY, ...LEGACY_DJ_VOLUME_STORAGE_KEYS];
  for (const key of keys) {
    const raw =
      sessionStorage.getItem(key) ?? localStorage.getItem(key);
    if (raw == null) continue;
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) continue;
    return clampDjVolume(parsed);
  }

  return DEFAULT_DJ_VOLUME;
}

/** Persist immediately to localStorage + sessionStorage (canonical key only). */
export function persistDjVolume(volume: number): void {
  if (!isBrowser()) return;
  const next = String(clampDjVolume(volume));
  localStorage.setItem(DJ_VOLUME_STORAGE_KEY, next);
  sessionStorage.setItem(DJ_VOLUME_STORAGE_KEY, next);
}

export type UseDjVolumeResult = {
  /** Companion DJ voice gain (0–1). */
  djVolume: number;
  /** Clamp, update session state, and persist immediately. */
  setDjVolume: (volume: number) => void;
  /** True after the first client read from storage (avoids default flash races). */
  djVolumeReady: boolean;
};

/**
 * Durable DJ Voice Volume state for Host Settings / MusicSource / orchestrator.
 * Hydrates from localStorage on mount and never reverts to 0.85 unless storage
 * is empty. Station switches must not call {@link setDjVolume} with a default.
 */
export function useDjVolume(): UseDjVolumeResult {
  const [djVolume, setDjVolumeState] = useState(DEFAULT_DJ_VOLUME);
  const [djVolumeReady, setDjVolumeReady] = useState(false);
  const hydratedRef = useRef(false);

  // useLayoutEffect: restore before paint so the Host Settings slider and
  // orchestrator sync do not briefly show / apply the 85% default.
  useLayoutEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    setDjVolumeState(loadDjVolume());
    setDjVolumeReady(true);
  }, []);

  const setDjVolume = useCallback((volume: number) => {
    const next = clampDjVolume(volume);
    setDjVolumeState(next);
    persistDjVolume(next);
  }, []);

  return { djVolume, setDjVolume, djVolumeReady };
}

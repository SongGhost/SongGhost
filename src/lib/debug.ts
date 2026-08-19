declare global {
  interface Window {
    __SONGHOST_DEBUG__?: boolean;
  }
}

/**
 * Runtime debug gate for high-frequency console telemetry.
 *
 * Enable with `window.__SONGHOST_DEBUG__ = true` or
 * `localStorage.setItem("songghost_debug", "1")`.
 */
export function isSongGhostDebug(): boolean {
  if (typeof window === "undefined") return false;
  if (window.__SONGHOST_DEBUG__ === true) return true;
  try {
    return window.localStorage.getItem("songghost_debug") === "1";
  } catch {
    return false;
  }
}

/**
 * Volume / mix-bus telemetry for production debugging.
 *
 * Set `NEXT_PUBLIC_ENABLE_AUDIO_TELEMETRY=true` on Vercel (or locally) to
 * capture `[SongHost VOL]` / poll logs on a deployment URL without flipping
 * the general debug flag.
 */
export function isAudioTelemetryEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_ENABLE_AUDIO_TELEMETRY === "true") return true;
  return isSongGhostDebug();
}

/** `console.log` only when {@link isSongGhostDebug} is true. */
export function debugLog(tag: string, payload?: unknown): void {
  if (!isSongGhostDebug()) return;
  if (payload === undefined) {
    console.log(tag);
    return;
  }
  console.log(tag, payload);
}

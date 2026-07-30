/** Survives React Strict Mode remounts and hook re-inits. */
let gestureUnlockPending = false;

/** Minimal silent WAV — primes the browser audio policy on user gesture. */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

let silentAudio: HTMLAudioElement | null = null;

export function markAudioUnlockRequested(): void {
  gestureUnlockPending = true;
}

export function isAudioUnlockPending(): boolean {
  return gestureUnlockPending;
}

export function clearAudioUnlockRequest(): void {
  gestureUnlockPending = false;
}

/**
 * Call synchronously inside a user-gesture handler (click, keydown, etc.).
 * Plays a silent clip to unlock the browser's audio policy for this tab.
 */
export function primeAudioOnGesture(): void {
  gestureUnlockPending = true;
  if (typeof window === "undefined") return;
  try {
    if (!silentAudio) {
      silentAudio = new Audio(SILENT_WAV);
      silentAudio.preload = "auto";
    }
    silentAudio.volume = 0.001;
    void silentAudio.play().catch(() => {});
  } catch {
    // Ignore — best-effort priming
  }
}

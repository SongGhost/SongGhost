/** Survives React Strict Mode remounts and hook re-inits. */
let gestureUnlockPending = false;

export function markAudioUnlockRequested(): void {
  gestureUnlockPending = true;
}

export function isAudioUnlockPending(): boolean {
  return gestureUnlockPending;
}

export function clearAudioUnlockRequest(): void {
  gestureUnlockPending = false;
}

/**
 * Statutory non-interactive skip cap: 6 listener skips per rolling 60 minutes.
 * Exhaustion refuses the skip and leaves the on-air track playing.
 */

export const SKIP_WINDOW_MS = 60 * 60 * 1000;
export const MAX_SKIPS_PER_HOUR = 6;

let skipTimes: number[] = [];
const listeners = new Set<() => void>();

function prune(now: number): void {
  skipTimes = skipTimes.filter((stamp) => now - stamp < SKIP_WINDOW_MS);
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function canSkip(now: number = Date.now()): boolean {
  prune(now);
  return skipTimes.length < MAX_SKIPS_PER_HOUR;
}

/** Record a skip when allowed. Returns false when the hourly cap is exhausted. */
export function recordSkip(now: number = Date.now()): boolean {
  prune(now);
  if (skipTimes.length >= MAX_SKIPS_PER_HOUR) return false;
  skipTimes = [...skipTimes, now];
  notify();
  return true;
}

export function remainingSkips(now: number = Date.now()): number {
  prune(now);
  return Math.max(0, MAX_SKIPS_PER_HOUR - skipTimes.length);
}

export function subscribeSkipLimiter(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test helper — production session airtime never resets this window. */
export function resetSkipLimiter(): void {
  skipTimes = [];
  notify();
}

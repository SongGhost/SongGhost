export type QueueReorderResult<T> = {
  queue: T[];
  currentIndex: number;
};

/**
 * Where the track at `currentIndex` lands after a splice-based move. Playback is
 * anchored to the *object* at `currentIndex`, so dragging any other row has to
 * shift the pointer or the live track would silently change mid-song.
 */
export function anchorCurrentIndex(
  fromIndex: number,
  toIndex: number,
  currentIndex: number,
): number {
  if (fromIndex === currentIndex) return toIndex;
  if (fromIndex < currentIndex && toIndex >= currentIndex) return currentIndex - 1;
  if (fromIndex > currentIndex && toIndex <= currentIndex) return currentIndex + 1;
  return currentIndex;
}

/**
 * Moves one entry within a queue, returning the new array plus the re-anchored
 * current index. Returns `null` for no-ops and out-of-range moves so callers can
 * skip the state update entirely.
 */
export function reorderQueueItems<T>(
  queue: readonly T[],
  fromIndex: number,
  toIndex: number,
  currentIndex: number,
): QueueReorderResult<T> | null {
  const { length } = queue;
  if (length < 2) return null;
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return null;
  if (fromIndex < 0 || fromIndex >= length) return null;

  const target = Math.min(Math.max(toIndex, 0), length - 1);
  if (target === fromIndex) return null;

  const next = [...queue];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(target, 0, moved);

  const anchored = anchorCurrentIndex(fromIndex, target, currentIndex);

  return {
    queue: next,
    currentIndex: Math.min(Math.max(anchored, 0), length - 1),
  };
}

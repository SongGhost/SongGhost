/** In-place Fisher–Yates; returns the same array for chaining. */
export function fisherYatesShuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * Keeps every track through `currentIndex` in place and Fisher–Yates shuffles
 * only the unplayed tail (`slice(currentIndex + 1)`). The on-air track and
 * playback index are unchanged, so music is never interrupted.
 */
export function shuffleRemainingTracks<T>(
  queue: readonly T[],
  currentIndex: number,
): T[] {
  if (!queue.length) return [];

  const index = Number.isInteger(currentIndex)
    ? Math.min(Math.max(0, currentIndex), queue.length - 1)
    : 0;

  const head = queue.slice(0, index + 1);
  const remaining = fisherYatesShuffle(queue.slice(index + 1));
  return [...head, ...remaining];
}

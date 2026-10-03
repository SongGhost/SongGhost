/**
 * A playhead past this point means the song already on air is underway.
 * A second "started playing" signal must not announce that song again.
 *
 * A queue advance can deliver that signal while the clock still shows the
 * previous song's ending. That stale needle is not mid-song for the new track.
 */
export const DJ_BREAK_PLAYHEAD_GUARD_SEC = 15;

/**
 * True only for a repeat signal on the queue slot already admitted.
 * A different slot is a new song: ignore the old needle and let the
 * normal break path run.
 */
export function shouldSkipBreakForLateNeedle(input: {
  playheadSeconds: number;
  /** Slot already given a break decision. Null until the first song of a session. */
  announcedQueueIndex: number | null;
  /** Slot the deck is on now. */
  liveQueueIndex: number;
}): boolean {
  if (!(input.playheadSeconds > DJ_BREAK_PLAYHEAD_GUARD_SEC)) return false;
  if (input.announcedQueueIndex === null) return false;
  return input.announcedQueueIndex === input.liveQueueIndex;
}

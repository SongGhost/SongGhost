/**
 * Dead YouTube (or other) queue videos.
 *
 * A video that never reaches PLAYING is skipped. The station keeps going.
 * Eight unavailable videos in a row is the cap. A video that actually
 * plays resets the count. After the cap, or when the queue has nothing
 * left after this video, playback stops and the listener sees a message.
 * The same dead id is not tried again in that run.
 */

export const MAX_CONSECUTIVE_UNAVAILABLE_SKIPS = 8;

export const SKIPPING_UNAVAILABLE_NOTICE = "Skipping unavailable video";

export const NO_PLAYABLE_VIDEO_NOTICE = "No playable videos left in this station.";

export const UNAVAILABLE_CAP_NOTICE =
  "Too many unavailable videos in a row. Playback is stopped.";

export type UnavailableSkipDecision = {
  /** Move to the next queue row and keep the station on. */
  advance: boolean;
  /** Stop auto-advance. The station does not keep spinning on dead ids. */
  stop: boolean;
  notice: string;
  /** Count after this failure. A later PLAYING track resets it to 0. */
  consecutiveSkips: number;
};

export function decideUnavailableSkip(input: {
  /** Failures already counted before this video. */
  consecutiveSkips: number;
  /** Queue rows that would remain after this video is removed. */
  tracksAfterRemoval: number;
}): UnavailableSkipDecision {
  const consecutiveSkips = input.consecutiveSkips + 1;
  const nothingLeft = input.tracksAfterRemoval <= 0;
  const capHit = consecutiveSkips > MAX_CONSECUTIVE_UNAVAILABLE_SKIPS;

  if (nothingLeft) {
    return {
      advance: false,
      stop: true,
      notice: NO_PLAYABLE_VIDEO_NOTICE,
      consecutiveSkips,
    };
  }
  if (capHit) {
    return {
      advance: false,
      stop: true,
      notice: UNAVAILABLE_CAP_NOTICE,
      consecutiveSkips,
    };
  }
  return {
    advance: true,
    stop: false,
    notice: SKIPPING_UNAVAILABLE_NOTICE,
    consecutiveSkips,
  };
}

/**
 * A video that reaches PLAYING ends the dead streak.
 * The next unavailable skip starts again at 1.
 */
export function noteTrackReachedPlaying(): number {
  return 0;
}

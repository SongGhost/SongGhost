/** YouTube IFrame player states used by the opener gate. */
export const YT_STATE_UNSTARTED = -1;
export const YT_STATE_PLAYING = 1;
export const YT_STATE_PAUSED = 2;
export const YT_STATE_BUFFERING = 3;
export const YT_STATE_CUED = 5;

export type OpenerReadyInput = {
  desiredVideoId: string | null;
  loadedVideoId: string | null;
  playerState: number | null | undefined;
  reportedVideoId?: string | null;
  /** True when the embed exposes getVideoData. */
  videoDataAvailable: boolean;
  durationSeconds?: number | null;
};

/**
 * The opener id is loaded and safe to announce.
 * UNSTARTED and BUFFERING are not ready — the host must wait.
 */
export function openerVideoReady(input: OpenerReadyInput): boolean {
  const desired = input.desiredVideoId?.trim() || "";
  if (!desired || input.loadedVideoId !== desired) return false;

  const state = input.playerState;
  if (
    state == null
    || state === YT_STATE_UNSTARTED
    || state === YT_STATE_BUFFERING
  ) {
    return false;
  }

  const parked =
    state === YT_STATE_CUED
    || state === YT_STATE_PAUSED
    || state === YT_STATE_PLAYING;
  if (!parked) return false;

  const reported = input.reportedVideoId?.trim() || "";
  if (input.videoDataAvailable) {
    return reported === desired;
  }

  return typeof input.durationSeconds === "number" && input.durationSeconds > 0;
}

export type StallDecision = "skip" | "clear";

/**
 * Stall-skip only a video that never became playable.
 * A confirmed opener held for the host is not a dead video.
 */
export function stallSkipWhileOpening(input: {
  launchHoldActive: boolean;
  videoReady: boolean;
  audiblePlaying: boolean;
}): StallDecision {
  if (input.audiblePlaying) return "clear";
  if (input.launchHoldActive && input.videoReady) return "clear";
  return "skip";
}

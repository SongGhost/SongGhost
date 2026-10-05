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

export type StallDecision = "skip" | "clear" | "wait";

/**
 * How long a video may sit in UNSTARTED or BUFFERING before it counts as dead.
 * The happy path reaches CUED / PAUSED / PLAYING well inside this window.
 * Eight seconds was burning song 1, then 2, then 3 while YouTube was still loading.
 */
export const FAIR_LOAD_MS = 20_000;

/**
 * Stall-skip only a video that never became playable after a fair load.
 * UNSTARTED and BUFFERING are still loading. A paused listener is not a dead id.
 * A confirmed opener held for the host is not a dead video.
 */
export function stallSkipWhileOpening(input: {
  launchHoldActive: boolean;
  videoReady: boolean;
  audiblePlaying: boolean;
  listenerPaused?: boolean;
  playerState?: number | null;
  loadAgeMs?: number;
}): StallDecision {
  if (input.listenerPaused) return "clear";
  if (input.audiblePlaying) return "clear";
  if (input.videoReady) return "clear";

  const state = input.playerState;
  const stillLoading =
    state == null
    || state === YT_STATE_UNSTARTED
    || state === YT_STATE_BUFFERING;
  const age = input.loadAgeMs ?? 0;
  if (stillLoading && age < FAIR_LOAD_MS) return "wait";
  if (age >= FAIR_LOAD_MS) return "skip";
  return "wait";
}

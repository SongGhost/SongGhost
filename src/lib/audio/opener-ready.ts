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
 * How long a video may sit before it counts as dead.
 * The happy path reaches CUED / PAUSED / PLAYING well inside this window.
 * Eight seconds was burning song 1, then 2, then 3 while YouTube was still loading.
 * Album-art uploads use the same window — a still picture is not a reason to skip early.
 */
export const FAIR_LOAD_MS = 20_000;

/**
 * Gone, private, or blocked from embedding.
 * Code 5 is an HTML5 complaint. Official Audio / Topic uploads are a still
 * image plus audio, and that complaint fires while the song can still play.
 * Code 153 is a missing embedder identity, not a dead id.
 */
export function youtubeErrorIsTerminal(code: number): boolean {
  return code === 2 || code === 100 || code === 101 || code === 150;
}

/**
 * The song is in the player even though the picture is a still album cover.
 * A moving video is not required. An empty duration with no parked state is
 * still loading, or dead — not this.
 */
export function stillFrameMediaReady(input: {
  desiredVideoId: string | null;
  loadedVideoId: string | null;
  reportedVideoId?: string | null;
  videoDataAvailable: boolean;
  durationSeconds?: number | null;
}): boolean {
  const desired = input.desiredVideoId?.trim() || "";
  if (!desired || input.loadedVideoId !== desired) return false;
  if (typeof input.durationSeconds !== "number" || input.durationSeconds <= 0) {
    return false;
  }
  if (!input.videoDataAvailable) return true;
  const reported = input.reportedVideoId?.trim() || "";
  return reported === desired;
}

/**
 * Stall-skip only a video that never became playable after a fair load.
 * UNSTARTED and BUFFERING are still loading. A paused listener is not a dead id.
 * A confirmed opener held for the host is not a dead video.
 * A still album cover with a real duration is loaded media. It is not success
 * until audio actually starts, and it is not an instant skip.
 */
export function stallSkipWhileOpening(input: {
  launchHoldActive: boolean;
  videoReady: boolean;
  /** Id matches and duration is known. The picture may be a still. */
  mediaPresent?: boolean;
  audiblePlaying: boolean;
  listenerPaused?: boolean;
  playerState?: number | null;
  loadAgeMs?: number;
}): StallDecision {
  if (input.listenerPaused) return "clear";
  if (input.audiblePlaying) return "clear";

  const age = input.loadAgeMs ?? 0;
  const loaded = input.videoReady || input.mediaPresent === true;

  // Held for the host: a loaded still or a parked cue stays. Do not burn it.
  if (input.launchHoldActive && loaded) return "clear";

  // Cover is up, or the cue is parked, but audio has not started.
  // Keep the fair-load clock. Do not freeze here, and do not rush the skip.
  if (!input.launchHoldActive && loaded) {
    if (age >= FAIR_LOAD_MS) return "skip";
    return "wait";
  }

  const state = input.playerState;
  const stillLoading =
    state == null
    || state === YT_STATE_UNSTARTED
    || state === YT_STATE_BUFFERING;
  if (stillLoading && age < FAIR_LOAD_MS) return "wait";
  if (age >= FAIR_LOAD_MS) return "skip";
  return "wait";
}

import { describe, expect, it } from "vitest";
import {
  YT_STATE_BUFFERING,
  YT_STATE_CUED,
  YT_STATE_PAUSED,
  YT_STATE_PLAYING,
  YT_STATE_UNSTARTED,
  openerVideoReady,
  stallSkipWhileOpening,
} from "../opener-ready";

const loaded = {
  desiredVideoId: "abc123",
  loadedVideoId: "abc123",
  videoDataAvailable: true,
  reportedVideoId: "abc123",
  durationSeconds: 180,
};

describe("opener video ready", () => {
  it("waits while the opener is UNSTARTED or BUFFERING", () => {
    expect(openerVideoReady({ ...loaded, playerState: YT_STATE_UNSTARTED })).toBe(false);
    expect(openerVideoReady({ ...loaded, playerState: YT_STATE_BUFFERING })).toBe(false);
  });

  it("is ready once that id is cued, paused, or playing", () => {
    expect(openerVideoReady({ ...loaded, playerState: YT_STATE_CUED })).toBe(true);
    expect(openerVideoReady({ ...loaded, playerState: YT_STATE_PAUSED })).toBe(true);
    expect(openerVideoReady({ ...loaded, playerState: YT_STATE_PLAYING })).toBe(true);
  });

  it("rejects a different video id", () => {
    expect(openerVideoReady({
      ...loaded,
      playerState: YT_STATE_CUED,
      reportedVideoId: "other",
    })).toBe(false);
  });
});

describe("stall skip while opening", () => {
  it("does not skip a confirmed opener that is held for the host", () => {
    expect(stallSkipWhileOpening({
      launchHoldActive: true,
      videoReady: true,
      audiblePlaying: false,
    })).toBe("clear");
  });

  it("skips only after a fair load that never became ready", () => {
    expect(stallSkipWhileOpening({
      launchHoldActive: true,
      videoReady: false,
      audiblePlaying: false,
    })).toBe("skip");
  });

  it("clears once the song is actually playing", () => {
    expect(stallSkipWhileOpening({
      launchHoldActive: false,
      videoReady: true,
      audiblePlaying: true,
    })).toBe("clear");
  });
});

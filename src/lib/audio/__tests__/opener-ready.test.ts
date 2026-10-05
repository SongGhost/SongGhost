import { describe, expect, it } from "vitest";
import {
  FAIR_LOAD_MS,
  YT_STATE_BUFFERING,
  YT_STATE_CUED,
  YT_STATE_PAUSED,
  YT_STATE_PLAYING,
  YT_STATE_UNSTARTED,
  openerVideoReady,
  stallSkipWhileOpening,
  stillFrameMediaReady,
  youtubeErrorIsTerminal,
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

  it("does not skip song 1 while YouTube is still UNSTARTED or BUFFERING", () => {
    expect(stallSkipWhileOpening({
      launchHoldActive: true,
      videoReady: false,
      audiblePlaying: false,
      playerState: YT_STATE_UNSTARTED,
      loadAgeMs: 8_000,
    })).toBe("wait");
    expect(stallSkipWhileOpening({
      launchHoldActive: true,
      videoReady: false,
      audiblePlaying: false,
      playerState: YT_STATE_BUFFERING,
      loadAgeMs: 8_000,
    })).toBe("wait");
  });

  it("skips only after a fair load that never became ready", () => {
    expect(stallSkipWhileOpening({
      launchHoldActive: true,
      videoReady: false,
      audiblePlaying: false,
      playerState: YT_STATE_UNSTARTED,
      loadAgeMs: FAIR_LOAD_MS,
    })).toBe("skip");
  });

  it("does not treat Pause as a dead video", () => {
    expect(stallSkipWhileOpening({
      launchHoldActive: false,
      videoReady: false,
      audiblePlaying: false,
      listenerPaused: true,
      playerState: YT_STATE_PAUSED,
      loadAgeMs: FAIR_LOAD_MS,
    })).toBe("clear");
  });

  it("clears once the song is actually playing", () => {
    expect(stallSkipWhileOpening({
      launchHoldActive: false,
      videoReady: true,
      audiblePlaying: true,
    })).toBe("clear");
  });

  it("does not skip a held album-art track that already has a duration", () => {
    expect(stallSkipWhileOpening({
      launchHoldActive: true,
      videoReady: false,
      mediaPresent: true,
      audiblePlaying: false,
      playerState: YT_STATE_UNSTARTED,
      loadAgeMs: FAIR_LOAD_MS,
    })).toBe("clear");
  });

  it("waits on a still cover that has not started audio, then skips only after a fair load", () => {
    expect(stallSkipWhileOpening({
      launchHoldActive: false,
      videoReady: true,
      mediaPresent: true,
      audiblePlaying: false,
      playerState: YT_STATE_CUED,
      loadAgeMs: 8_000,
    })).toBe("wait");
    expect(stallSkipWhileOpening({
      launchHoldActive: false,
      videoReady: true,
      mediaPresent: true,
      audiblePlaying: false,
      playerState: YT_STATE_CUED,
      loadAgeMs: FAIR_LOAD_MS,
    })).toBe("skip");
  });

  it("keeps a playing album-art track even though the picture is still", () => {
    expect(stallSkipWhileOpening({
      launchHoldActive: false,
      videoReady: true,
      mediaPresent: true,
      audiblePlaying: true,
      playerState: YT_STATE_PLAYING,
      loadAgeMs: FAIR_LOAD_MS,
    })).toBe("clear");
  });
});

describe("still frame versus a dead embed", () => {
  it("treats a matching id with a real duration as playable media", () => {
    expect(stillFrameMediaReady({
      desiredVideoId: "abc123",
      loadedVideoId: "abc123",
      reportedVideoId: "abc123",
      videoDataAvailable: true,
      durationSeconds: 179,
    })).toBe(true);
    expect(stillFrameMediaReady({
      desiredVideoId: "abc123",
      loadedVideoId: "abc123",
      reportedVideoId: "abc123",
      videoDataAvailable: true,
      durationSeconds: 0,
    })).toBe(false);
  });

  it("treats removed and embed-blocked ids as terminal, and a still-image HTML5 error as not", () => {
    expect(youtubeErrorIsTerminal(100)).toBe(true);
    expect(youtubeErrorIsTerminal(101)).toBe(true);
    expect(youtubeErrorIsTerminal(150)).toBe(true);
    expect(youtubeErrorIsTerminal(2)).toBe(true);
    expect(youtubeErrorIsTerminal(5)).toBe(false);
    expect(youtubeErrorIsTerminal(153)).toBe(false);
  });
});

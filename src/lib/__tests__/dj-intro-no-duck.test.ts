import { describe, expect, it, vi } from "vitest";
import { playDjIntro } from "../dj-intro";
import type { VoiceSpeaker } from "../audio/VoiceNode";

describe("playDjIntro live-dial no-duck", () => {
  it("does not pass a ducking target when duckMusic is omitted", async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const voiceNode: VoiceSpeaker = { play, stop: vi.fn() };

    await playDjIntro({
      songTitle: "Karma Police",
      artistName: "Radiohead",
      voiceNode,
      audioBlob: new Blob(["x"], { type: "audio/mpeg" }),
      script: "Up now is Karma Police by Radiohead.",
    });

    expect(play).toHaveBeenCalledTimes(1);
    expect(play.mock.calls[0]?.[0]?.duckingTarget).toBeUndefined();
    expect(play.mock.calls[0]?.[0]?.ducking).toBeUndefined();
  });
});

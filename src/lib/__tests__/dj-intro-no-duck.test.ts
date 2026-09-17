import { describe, expect, it, vi } from "vitest";
import { playDjIntro } from "../dj-intro";
import type { VoiceSpeaker } from "../audio/VoiceNode";
import type { VolumeController } from "@/types/audio";
import type { DjSegmentPlan } from "@/types/dj";

vi.mock("../dj/earcon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../dj/earcon")>();
  return {
    ...actual,
    playEarconFailClosed: vi.fn().mockResolvedValue(undefined),
    waitCommentaryGap: vi.fn().mockResolvedValue(undefined),
  };
});

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

  it("does not start music itself — clips finish, then onLoreComplete", async () => {
    const play = vi.fn(async (opts: { onRestore?: () => void }) => {
      opts.onRestore?.();
    });
    const voiceNode: VoiceSpeaker = { play, stop: vi.fn() };
    const duckBus: VolumeController = {
      getVolume: vi.fn(() => 1),
      setVolume: vi.fn(),
      rampVolume: vi.fn(() => () => {}),
    };
    const onBreakExit = vi.fn();
    const onLoreComplete = vi.fn();
    const musicPlay = vi.fn();
    const plan: DjSegmentPlan = {
      kind: "song_intro",
      transition: "full_break",
      announceTracks: [{ title: "Karma Police", artist: "Radiohead" }],
      maxDurationSeconds: 5,
      isSessionOpening: false,
    };

    await playDjIntro({
      songTitle: "Karma Police",
      artistName: "Radiohead",
      voiceNode,
      duckBus,
      duckMusic: false,
      loreBlob: new Blob(["lore"], { type: "audio/mpeg" }),
      loreScript: "Lore clip.",
      announcementBlob: new Blob(["announce"], { type: "audio/mpeg" }),
      announcementScript: "That was the fact. Up now, Karma Police.",
      segmentPlan: plan,
      onBreakExit,
      onLoreComplete,
    });

    expect(musicPlay).not.toHaveBeenCalled();
    expect(duckBus.setVolume).not.toHaveBeenCalled();
    expect(duckBus.rampVolume).not.toHaveBeenCalled();
    expect(play).toHaveBeenCalledTimes(2);
    expect(play.mock.calls.every((call) => call[0]?.duckingTarget === undefined)).toBe(
      true,
    );
    expect(onBreakExit).toHaveBeenCalledTimes(1);
    expect(onLoreComplete).toHaveBeenCalledTimes(1);
    expect(onBreakExit.mock.invocationCallOrder[0]).toBeLessThan(
      onLoreComplete.mock.invocationCallOrder[0],
    );
  });
});

import { describe, expect, it, vi } from "vitest";
import type { VoiceSpeaker } from "@/lib/audio/VoiceNode";
import type { DjSegmentPlan } from "@/types/dj";
import { playNewBreak } from "../playNewBreak";

vi.mock("@/lib/dj/earcon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dj/earcon")>();
  return {
    ...actual,
    playEarconFailClosed: vi.fn().mockResolvedValue(undefined),
    waitCommentaryGap: vi.fn().mockResolvedValue(undefined),
  };
});

import { playEarconFailClosed } from "@/lib/dj/earcon";

function plan(kind: DjSegmentPlan["kind"], extra?: Partial<DjSegmentPlan>): DjSegmentPlan {
  return {
    kind,
    transition: "full_break",
    announceTracks: [{ title: "Dreams", artist: "Fleetwood Mac" }],
    maxDurationSeconds: 8,
    isSessionOpening: false,
    ...extra,
  };
}

describe("playNewBreak", () => {
  it("refuses Song 1 so the Classic liner stays in charge", async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const voiceNode: VoiceSpeaker = { play, stop: vi.fn() };
    const result = await playNewBreak({
      songTitle: "Dreams",
      artistName: "Fleetwood Mac",
      voiceNode,
      audioBlob: new Blob(["x"]),
      script: "Should not air.",
      segmentPlan: plan("song_intro", { isSessionOpening: true }),
    });
    expect(result.played).toBe(false);
    expect(play).not.toHaveBeenCalled();
    expect(playEarconFailClosed).not.toHaveBeenCalled();
  });

  it("does not play the lore earcon for a names-only Every Song line", async () => {
    vi.mocked(playEarconFailClosed).mockClear();
    const play = vi.fn().mockResolvedValue(undefined);
    const voiceNode: VoiceSpeaker = { play, stop: vi.fn() };
    const onBreakExit = vi.fn();
    const result = await playNewBreak({
      songTitle: "Dreams",
      artistName: "Fleetwood Mac",
      voiceNode,
      audioBlob: new Blob(["x"]),
      script: "Dreams by Fleetwood Mac.",
      includesRealFact: false,
      segmentPlan: plan("song_intro"),
      canPlay: () => true,
      onBreakExit,
    });
    expect(result.played).toBe(true);
    expect(playEarconFailClosed).not.toHaveBeenCalled();
    expect(play).toHaveBeenCalledTimes(1);
    expect(play.mock.calls[0]?.[0]?.duckingTarget).toBeUndefined();
    expect(onBreakExit).toHaveBeenCalledTimes(1);
  });

  it("plays the lore earcon when the line includes a real fact", async () => {
    vi.mocked(playEarconFailClosed).mockClear();
    const play = vi.fn().mockResolvedValue(undefined);
    const voiceNode: VoiceSpeaker = { play, stop: vi.fn() };
    const result = await playNewBreak({
      songTitle: "Come As You Are",
      artistName: "Nirvana",
      voiceNode,
      audioBlob: new Blob(["x"]),
      script: "Up next, Come As You Are by Nirvana, from the 1991 album Nevermind.",
      includesRealFact: true,
      segmentPlan: plan("artist_trivia", {
        announceTracks: [{ title: "Come As You Are", artist: "Nirvana" }],
      }),
      canPlay: () => true,
    });
    expect(result.played).toBe(true);
    expect(playEarconFailClosed).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(playEarconFailClosed).mock.calls[0]?.[0])).toContain("lore/open");
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("does not play an earcon for a names-only song ID", async () => {
    vi.mocked(playEarconFailClosed).mockClear();
    const play = vi.fn().mockResolvedValue(undefined);
    const voiceNode: VoiceSpeaker = { play, stop: vi.fn() };
    await playNewBreak({
      songTitle: "Dreams",
      artistName: "Fleetwood Mac",
      voiceNode,
      audioBlob: new Blob(["x"]),
      script: "Dreams by Fleetwood Mac.",
      segmentPlan: plan("song_id"),
      canPlay: () => true,
    });
    expect(playEarconFailClosed).not.toHaveBeenCalled();
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("does not speak after the gap has closed", async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const voiceNode: VoiceSpeaker = { play, stop: vi.fn() };
    const result = await playNewBreak({
      songTitle: "Dreams",
      artistName: "Fleetwood Mac",
      voiceNode,
      audioBlob: new Blob(["x"]),
      script: "Dreams by Fleetwood Mac.",
      segmentPlan: plan("artist_trivia"),
      canPlay: () => false,
    });
    expect(result.played).toBe(false);
    expect(play).not.toHaveBeenCalled();
  });
});

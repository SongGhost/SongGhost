import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { VoiceSpeaker } from "@/lib/audio/VoiceNode";
import type { DjSegmentPlan } from "@/types/dj";

vi.mock("@/lib/dj/earcon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dj/earcon")>();
  return {
    ...actual,
    playEarconFailClosed: vi.fn().mockResolvedValue(undefined),
    waitCommentaryGap: vi.fn().mockResolvedValue(undefined),
  };
});

import { playEarconFailClosed } from "@/lib/dj/earcon";
import {
  DJ_BREAK_PLAYHEAD_GUARD_SEC,
  shouldSkipBreakForLateNeedle,
} from "../breakPlayheadGate";
import { createDjSchedulerState, planDjSegment } from "../scheduler";
import { playNewBreak } from "../wordsEngine/playNewBreak";

function voice(): VoiceSpeaker {
  return { play: vi.fn().mockResolvedValue(undefined), stop: vi.fn() };
}

/** Every Song, Pro, Standard commentary. Song 1 is the station liner. */
function everySongSession() {
  const opening = planDjSegment(createDjSchedulerState(), {
    currentTrack: { title: "Like a Virgin", artist: "Madonna" },
    pacingFrequency: 2,
    chatterPacing: "talkative",
    commentaryFormat: "standard",
    isSessionOpening: true,
    isPro: true,
  });
  const song2 = planDjSegment(opening.nextState, {
    currentTrack: { title: "Material Girl", artist: "Madonna" },
    pacingFrequency: 2,
    chatterPacing: "talkative",
    commentaryFormat: "standard",
    isSessionOpening: false,
    isPro: true,
  });
  const song3 = planDjSegment(song2.nextState, {
    currentTrack: { title: "Crazy for You", artist: "Madonna" },
    pacingFrequency: 2,
    chatterPacing: "talkative",
    commentaryFormat: "standard",
    isSessionOpening: false,
    isPro: true,
  });
  return { opening, song2, song3 };
}

async function airAdmittedBreak(
  plan: DjSegmentPlan,
  gate: {
    playheadSeconds: number;
    announcedQueueIndex: number | null;
    liveQueueIndex: number;
  },
) {
  const speaker = voice();
  if (shouldSkipBreakForLateNeedle(gate)) {
    return { admitted: false as const, speaker, result: null };
  }
  const result = await playNewBreak({
    songTitle: plan.announceTracks[0]?.title ?? "Material Girl",
    artistName: plan.announceTracks[0]?.artist ?? "Madonna",
    voiceNode: speaker,
    audioBlob: new Blob(["clip"]),
    script: "One spoken line.",
    segmentPlan: plan,
    canPlay: () => true,
  });
  return { admitted: true as const, speaker, result };
}

describe("late needle versus a new song", () => {
  it("still plays the New break when the queue moves while the clock is past 15 seconds", async () => {
    vi.mocked(playEarconFailClosed).mockClear();
    const { song2 } = everySongSession();
    expect(song2.transition).toBe("full_break");
    expect(song2.plan).toBeTruthy();

    const aired = await airAdmittedBreak(song2.plan!, {
      playheadSeconds: DJ_BREAK_PLAYHEAD_GUARD_SEC + 170,
      announcedQueueIndex: 0,
      liveQueueIndex: 1,
    });

    expect(aired.admitted).toBe(true);
    expect(aired.result?.played).toBe(true);
    expect(playEarconFailClosed).not.toHaveBeenCalled();
    expect(aired.speaker.play).toHaveBeenCalledTimes(1);
  });

  it("does not announce again for the song already on air when the needle is past 15 seconds", async () => {
    vi.mocked(playEarconFailClosed).mockClear();
    const { song2 } = everySongSession();
    const aired = await airAdmittedBreak(song2.plan!, {
      playheadSeconds: DJ_BREAK_PLAYHEAD_GUARD_SEC + 40,
      announcedQueueIndex: 1,
      liveQueueIndex: 1,
    });

    expect(aired.admitted).toBe(false);
    expect(playEarconFailClosed).not.toHaveBeenCalled();
    expect(aired.speaker.play).not.toHaveBeenCalled();
  });

  it("plans one Every Song break, speech and no chime, when the line has no fact", async () => {
    vi.mocked(playEarconFailClosed).mockClear();
    const { opening, song2, song3 } = everySongSession();

    expect(opening.transition).toBe("full_break");
    expect(opening.plan?.isSessionOpening).toBe(true);
    const opener = await playNewBreak({
      songTitle: "Like a Virgin",
      artistName: "Madonna",
      voiceNode: voice(),
      audioBlob: new Blob(["liner"]),
      script: "Station liner.",
      segmentPlan: opening.plan!,
      canPlay: () => true,
    });
    expect(opener.played).toBe(false);
    expect(playEarconFailClosed).not.toHaveBeenCalled();

    for (const followUp of [song2, song3]) {
      vi.mocked(playEarconFailClosed).mockClear();
      expect(followUp.transition).toBe("full_break");
      expect(followUp.plan?.isSessionOpening).not.toBe(true);
      const speaker = voice();
      const result = await playNewBreak({
        songTitle: followUp.plan!.announceTracks[0]?.title ?? "",
        artistName: "Madonna",
        voiceNode: speaker,
        audioBlob: new Blob(["clip"]),
        script: "One spoken line.",
        segmentPlan: followUp.plan!,
        canPlay: () => true,
      });
      expect(result.played).toBe(true);
      expect(playEarconFailClosed).not.toHaveBeenCalled();
      expect(speaker.play).toHaveBeenCalledTimes(1);
    }
  });

  it("still reaches the same break when a playlist chip starts the new song at the top", async () => {
    vi.mocked(playEarconFailClosed).mockClear();
    const { song2 } = everySongSession();
    const aired = await airAdmittedBreak(song2.plan!, {
      playheadSeconds: 0,
      announcedQueueIndex: 0,
      liveQueueIndex: 1,
    });

    expect(shouldSkipBreakForLateNeedle({
      playheadSeconds: 0,
      announcedQueueIndex: 0,
      liveQueueIndex: 1,
    })).toBe(false);
    expect(aired.admitted).toBe(true);
    expect(aired.result?.played).toBe(true);
    expect(playEarconFailClosed).not.toHaveBeenCalled();
    expect(aired.speaker.play).toHaveBeenCalledTimes(1);
  });

  it("plays the lore chime only when the line has a real fact", async () => {
    vi.mocked(playEarconFailClosed).mockClear();
    const { song2 } = everySongSession();
    const speaker = voice();
    const result = await playNewBreak({
      songTitle: "Material Girl",
      artistName: "Madonna",
      voiceNode: speaker,
      audioBlob: new Blob(["clip"]),
      script: "Madonna formed in Michigan. Hear the story. Here's Material Girl.",
      includesRealFact: true,
      segmentPlan: song2.plan!,
      canPlay: () => true,
    });
    expect(result.played).toBe(true);
    expect(playEarconFailClosed).toHaveBeenCalledTimes(1);
    expect(speaker.play).toHaveBeenCalledTimes(1);
  });

  it("wires both player checks to the queue slot, not the raw clock", () => {
    const player = readFileSync(path.resolve("src/components/AudioPlayer.tsx"), "utf8");
    const calls = player.match(/shouldSkipBreakForLateNeedle\(/g) ?? [];
    expect(calls).toHaveLength(2);
    expect(player).not.toContain("currentTimeRef.current > DJ_BREAK_PLAYHEAD_GUARD_SEC");
    expect(player).toContain("announcedQueueIndexRef");
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  curatorFailureNotice,
  curatorYieldState,
  performCuratorClick,
} from "@/lib/curator-handoff";

const PREVIOUS_TITLE = "Hunting High and Low";

type OnAir = {
  isPlaying: boolean;
  queueTitles: string[];
  title: string;
  artist: string;
};

function liveSession(): OnAir {
  return {
    isPlaying: true,
    queueTitles: [PREVIOUS_TITLE],
    title: PREVIOUS_TITLE,
    artist: "a-ha",
  };
}

function applyYield(session: OnAir, prompt: string) {
  const next = curatorYieldState(prompt);
  session.isPlaying = next.isPlaying;
  session.queueTitles = [...next.queue];
  session.title = next.nowPlaying.title;
  session.artist = next.nowPlaying.artist;
}

function applyFailure(session: OnAir, notice: { title: string; detail: string }) {
  session.isPlaying = false;
  session.queueTitles = [];
  session.title = notice.title;
  session.artist = notice.detail;
}

describe("AI prompt click", () => {
  it("takes the previous song off the air before the curator responds", async () => {
    const session = liveSession();
    let fetchReturned = false;
    const pending = performCuratorClick({
      prompt: "late 80s college rock",
      body: { prompt: "late 80s college rock" },
      fetchImpl: () =>
        new Promise((resolve) => {
          expect(session.isPlaying).toBe(false);
          expect(session.queueTitles).toEqual([]);
          expect(session.title).not.toBe(PREVIOUS_TITLE);
          fetchReturned = true;
          resolve(
            new Response(JSON.stringify({ tracks: [] }), {
              status: 422,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }),
      onYield: (prompt) => applyYield(session, prompt),
      onLaunch: () => {
        throw new Error("failed lookup must not launch");
      },
    });

    const outcome = await pending;
    expect(fetchReturned).toBe(true);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) applyFailure(session, outcome.notice);

    expect(session.isPlaying).toBe(false);
    expect(session.queueTitles).not.toContain(PREVIOUS_TITLE);
    expect(session.title).not.toBe(PREVIOUS_TITLE);
    expect(session.artist).not.toBe("a-ha");
  });

  it("does not launch or keep the old track when the prompt fails", async () => {
    const session = liveSession();
    const onLaunch = vi.fn();
    const outcome = await performCuratorClick({
      prompt: "late 80s college rock",
      body: { prompt: "late 80s college rock", previousTitles: [] },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ error: "No real songs fit this prompt. Nothing was invented to fill the list." }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        ),
      onYield: (prompt) => applyYield(session, prompt),
      onLaunch,
    });

    expect(onLaunch).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) applyFailure(session, outcome.notice);

    expect(session.isPlaying).toBe(false);
    expect(session.queueTitles).toEqual([]);
    expect(session.queueTitles).not.toContain(PREVIOUS_TITLE);
    expect(session.title).toBe("Couldn't start late 80s college rock");
    expect(session.artist).not.toBe("a-ha");
    expect(session.artist).not.toBe(PREVIOUS_TITLE);
    expect(curatorFailureNotice("late 80s college rock").detail.toLowerCase()).toContain(
      "nothing is playing",
    );
  });
});

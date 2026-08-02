import { describe, expect, it, vi } from "vitest";
import {
  clampDjPacing,
  createDjSchedulerState,
  DEFAULT_DJ_PACING,
  planDjSegment,
  type SchedulerState,
} from "../scheduler";

const track = (title: string, artist: string) => ({ title, artist });

function advance(
  state: SchedulerState,
  title: string,
  artist: string,
  pacingFrequency: number,
  isSessionOpening = false,
) {
  return planDjSegment(state, {
    currentTrack: track(title, artist),
    pacingFrequency,
    isSessionOpening,
  });
}

describe("planDjSegment", () => {
  it("always returns song_intro full_break on session opening", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);

    const result = advance(createDjSchedulerState(), "Fake Plastic Trees", "Radiohead", 2, true);

    expect(result.transition).toBe("full_break");
    expect(result.plan?.kind).toBe("song_intro");
    expect(result.plan?.transition).toBe("full_break");
    expect(result.plan?.announceTracks[0]?.title).toBe("Fake Plastic Trees");
  });

  it("pacing 2 inserts one silent track between full_break segments", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    let state = createDjSchedulerState();

    let result = advance(state, "Track A", "Artist A", 2, true);
    expect(result.transition).toBe("full_break");
    state = result.nextState;

    result = advance(state, "Track B", "Artist B", 2);
    expect(result.transition).toBe("silent");
    expect(result.plan).toBeNull();
    state = result.nextState;

    result = advance(state, "Track C", "Artist C", 2);
    expect(result.transition).toBe("full_break");
    expect(result.plan).not.toBeNull();
    state = result.nextState;

    result = advance(state, "Track D", "Artist D", 2);
    expect(result.transition).toBe("silent");
  });

  it("pacing 3 inserts two silent tracks between full_break segments", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    let state = createDjSchedulerState();

    let result = advance(state, "Track A", "Artist A", 3, true);
    expect(result.transition).toBe("full_break");
    state = result.nextState;

    result = advance(state, "Track B", "Artist B", 3);
    expect(result.transition).toBe("silent");
    state = result.nextState;

    result = advance(state, "Track C", "Artist C", 3);
    expect(result.transition).toBe("silent");
    state = result.nextState;

    result = advance(state, "Track D", "Artist D", 3);
    expect(result.transition).toBe("full_break");
    state = result.nextState;

    result = advance(state, "Track E", "Artist E", 3);
    expect(result.transition).toBe("silent");
  });

  it("pacing 1 alternates full_break and stinger after the opening break", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    let state = createDjSchedulerState();

    let result = advance(state, "Track A", "Artist A", 1, true);
    expect(result.transition).toBe("full_break");
    expect(result.plan?.kind).toBe("song_intro");
    state = result.nextState;

    result = advance(state, "Track B", "Artist B", 1);
    expect(result.transition).toBe("stinger");
    expect(result.plan?.kind).toBe("stinger");
    state = result.nextState;

    result = advance(state, "Track C", "Artist C", 1);
    expect(result.transition).toBe("full_break");
    state = result.nextState;

    result = advance(state, "Track D", "Artist D", 1);
    expect(result.transition).toBe("stinger");
  });

  it("increments tracksSinceLastBreak on silent tracks and resets it on a break", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    let state = createDjSchedulerState();
    expect(state.tracksSinceLastBreak).toBe(0);

    state = advance(state, "Track A", "Artist A", 3, true).nextState;
    expect(state.tracksSinceLastBreak).toBe(0);

    state = advance(state, "Track B", "Artist B", 3).nextState;
    expect(state.tracksSinceLastBreak).toBe(1);

    state = advance(state, "Track C", "Artist C", 3).nextState;
    expect(state.tracksSinceLastBreak).toBe(2);

    state = advance(state, "Track D", "Artist D", 3).nextState;
    expect(state.tracksSinceLastBreak).toBe(0);
  });

  it("names every silent track once the next full_break lands", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    let state = createDjSchedulerState();
    state = advance(state, "Track A", "Artist A", 3, true).nextState;

    state = advance(state, "Track B", "Artist B", 3).nextState;
    state = advance(state, "Track C", "Artist C", 3).nextState;
    expect(state.pendingTracks.map((t) => t.title)).toEqual(["Track B", "Track C"]);

    const result = advance(state, "Track D", "Artist D", 3);
    expect(result.transition).toBe("full_break");
    expect(result.plan?.announceTracks.map((t) => t.title)).toEqual([
      "Track B",
      "Track C",
      "Track D",
    ]);
    expect(result.nextState.pendingTracks).toEqual([]);
  });

  it("applies a mid-session pacing change on the very next track", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    let state = createDjSchedulerState();

    state = advance(state, "Track A", "Artist A", 3, true).nextState;
    state = advance(state, "Track B", "Artist B", 3).nextState;

    // Listener drops from Relaxed (3) to Medium (2) — one silent track is already spent.
    const result = advance(state, "Track C", "Artist C", 2);
    expect(result.transition).toBe("full_break");
  });

  it("treats out-of-range pacing as the nearest supported value", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    let state = createDjSchedulerState();
    state = advance(state, "Track A", "Artist A", 99, true).nextState;

    // Clamped to 3 — two silent tracks, then a break.
    for (const title of ["Track B", "Track C"]) {
      const result = advance(state, title, "Artist", 99);
      expect(result.transition).toBe("silent");
      state = result.nextState;
    }

    expect(advance(state, "Track D", "Artist D", 99).transition).toBe("full_break");
  });

  it("never emits a plan alongside a silent transition", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    let state = createDjSchedulerState();
    state = advance(state, "Track A", "Artist A", 2, true).nextState;

    const result = advance(state, "Track B", "Artist B", 2);
    expect(result.transition).toBe("silent");
    expect(result.plan).toBeNull();
  });
});

describe("organic break jitter", () => {
  it("lets a break slip one extra track so the gap breathes between 2 and 3", () => {
    // Below the jitter threshold the scheduler holds the break back one more track.
    vi.spyOn(Math, "random").mockReturnValue(0.1);

    let state = createDjSchedulerState();
    state = advance(state, "Track A", "Artist A", 2, true).nextState;

    // Track C would have broken at a fixed pacing of 2 — jitter extends the run.
    for (const title of ["Track B", "Track C"]) {
      const result = advance(state, title, "Artist", 2);
      expect(result.transition).toBe("silent");
      state = result.nextState;
    }

    expect(advance(state, "Track D", "Artist D", 2).transition).toBe("full_break");
  });

  it("never stretches a gap beyond pacing + 1", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    let state = createDjSchedulerState();
    state = advance(state, "Track A", "Artist A", 3, true).nextState;

    for (const title of ["Track B", "Track C", "Track D"]) {
      const result = advance(state, title, "Artist", 3);
      expect(result.transition).toBe("silent");
      state = result.nextState;
    }

    expect(advance(state, "Track E", "Artist E", 3).transition).toBe("full_break");
  });
});

describe("session-scoped style rotation", () => {
  it("hands each voiced break an incrementing rotation index", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    let state = createDjSchedulerState();

    const opening = advance(state, "Track A", "Artist A", 2, true);
    expect(opening.plan?.styleRotationIndex).toBe(0);
    state = opening.nextState;

    state = advance(state, "Track B", "Artist B", 2).nextState;

    const second = advance(state, "Track C", "Artist C", 2);
    expect(second.transition).toBe("full_break");
    expect(second.plan?.styleRotationIndex).toBe(1);
  });

  it("does not advance the rotation on silent tracks", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    let state = createDjSchedulerState();
    state = advance(state, "Track A", "Artist A", 3, true).nextState;
    expect(state.voicedBreakCount).toBe(1);

    state = advance(state, "Track B", "Artist B", 3).nextState;
    state = advance(state, "Track C", "Artist C", 3).nextState;
    expect(state.voicedBreakCount).toBe(1);

    state = advance(state, "Track D", "Artist D", 3).nextState;
    expect(state.voicedBreakCount).toBe(2);
  });

  it("restarts rotation for a new session", () => {
    expect(createDjSchedulerState().voicedBreakCount).toBe(0);
  });
});

describe("local concert events", () => {
  const localEvent = {
    artist: "Radiohead",
    venue: "The Fillmore",
    city: "San Francisco",
    dateLabel: "Friday, March 13",
  };

  function advanceWithEvent(
    state: SchedulerState,
    title: string,
    artist: string,
    pacingFrequency: number,
  ) {
    return planDjSegment(state, {
      currentTrack: track(title, artist),
      pacingFrequency,
      localEvent,
      listenerCity: "San Francisco",
    });
  }

  it("keeps the event on a multi-track recap", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    let state = createDjSchedulerState();
    state = advance(state, "Track A", "Artist A", 3, true).nextState;
    state = advanceWithEvent(state, "Track B", "Radiohead", 3).nextState;
    state = advanceWithEvent(state, "Track C", "Radiohead", 3).nextState;

    const result = advanceWithEvent(state, "Track D", "Radiohead", 3);
    expect(result.plan?.kind).toBe("recap");
    expect(result.plan?.announceTracks).toHaveLength(3);
    expect(result.plan?.localEvent).toEqual(localEvent);
  });

  it("features the show outright far more often than the old 20% roll", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.4);

    const result = advanceWithEvent(createDjSchedulerState(), "Track A", "Radiohead", 1);
    expect(result.plan?.kind).toBe("local_events");
    expect(result.plan?.localEvent).toEqual(localEvent);
  });

  it("still carries the event on breaks that are about something else", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    const result = advanceWithEvent(createDjSchedulerState(), "Track A", "Radiohead", 1);
    expect(result.plan?.kind).toBe("song_intro");
    expect(result.plan?.localEvent).toEqual(localEvent);
  });

  it("buys extra seconds for a break that also has to work in the aside", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    const withEvent = advanceWithEvent(createDjSchedulerState(), "Track A", "Radiohead", 1);
    const withoutEvent = advance(createDjSchedulerState(), "Track A", "Radiohead", 1);

    expect(withEvent.plan?.kind).toBe("song_intro");
    expect(withoutEvent.plan?.kind).toBe("song_intro");
    expect(withEvent.plan?.maxDurationSeconds).toBeGreaterThan(
      withoutEvent.plan?.maxDurationSeconds ?? 0,
    );
  });

  it("never hands a concert mention to a stinger", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    const state: SchedulerState = { ...createDjSchedulerState(), nextIsStinger: true };
    const result = advanceWithEvent(state, "Track A", "Radiohead", 1);

    expect(result.transition).toBe("stinger");
    expect(result.plan?.localEvent).toBeUndefined();
  });

  it("leaves the event off plans when no show was found", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    const result = advance(createDjSchedulerState(), "Track A", "Radiohead", 1);
    expect(result.plan?.localEvent).toBeUndefined();
  });
});

describe("pacing defaults", () => {
  it("defaults to organic background pacing", () => {
    expect(DEFAULT_DJ_PACING).toBe(2);
  });

  it("clamps unusable values into range", () => {
    expect(clampDjPacing(0)).toBe(1);
    expect(clampDjPacing(-4)).toBe(1);
    expect(clampDjPacing(7)).toBe(3);
    expect(clampDjPacing(2.4)).toBe(2);
    expect(clampDjPacing(Number.NaN)).toBe(DEFAULT_DJ_PACING);
  });
});

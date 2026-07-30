import { describe, expect, it, vi } from "vitest";
import {
  createDjSchedulerState,
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
});

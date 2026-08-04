import { describe, expect, it, vi } from "vitest";
import type { ChatterPacing } from "@/types/station";
import {
  createDjSchedulerState,
  DEFAULT_DJ_PACING,
  planDjSegment,
  resolvePacingWindow,
  type SchedulerState,
} from "../scheduler";

function advance(
  state: SchedulerState,
  title: string,
  chatterPacing: ChatterPacing,
  isSessionOpening = false,
) {
  return planDjSegment(state, {
    currentTrack: { title, artist: "Artist" },
    pacingFrequency: DEFAULT_DJ_PACING,
    chatterPacing,
    isSessionOpening,
  });
}

/** Transitions for an opening plus `count` follow-up tracks. */
function runSession(chatterPacing: ChatterPacing, count: number): string[] {
  let state = createDjSchedulerState();
  const opening = advance(state, "Track 0", chatterPacing, true);
  state = opening.nextState;

  const transitions = [opening.transition];
  for (let i = 1; i <= count; i++) {
    const result = advance(state, `Track ${i}`, chatterPacing);
    transitions.push(result.transition);
    state = result.nextState;
  }
  return transitions;
}

describe("resolvePacingWindow", () => {
  it("reproduces the legacy numeric window when no chatter level is given", () => {
    expect(resolvePacingWindow({ currentTrack: { title: "a", artist: "b" }, pacingFrequency: 2 }))
      .toEqual({ muted: false, minGap: 2, maxGap: 3, alternateStinger: false });
  });

  it("keeps the pacing-1 stinger alternation on the legacy path", () => {
    expect(
      resolvePacingWindow({ currentTrack: { title: "a", artist: "b" }, pacingFrequency: 1 })
        .alternateStinger,
    ).toBe(true);
  });

  it("clamps an out-of-range numeric pacing before building the window", () => {
    expect(resolvePacingWindow({ currentTrack: { title: "a", artist: "b" }, pacingFrequency: 99 }))
      .toEqual({ muted: false, minGap: 3, maxGap: 4, alternateStinger: false });
  });

  it("lets a chatter level override the numeric pacing entirely", () => {
    const window = resolvePacingWindow({
      currentTrack: { title: "a", artist: "b" },
      pacingFrequency: 1,
      chatterPacing: "music_focused",
    });
    expect(window).toEqual({ muted: false, minGap: 5, maxGap: 7, alternateStinger: false });
  });
});

describe("talkative pacing", () => {
  it("alternates full breaks and stingers so the host is on every track", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    expect(runSession("talkative", 4)).toEqual([
      "full_break",
      "stinger",
      "full_break",
      "stinger",
      "full_break",
    ]);
  });

  it("never goes silent", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    expect(runSession("talkative", 6)).not.toContain("silent");
  });
});

describe("standard pacing", () => {
  it("holds a break for at least two tracks after the opening", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const transitions = runSession("standard", 3);
    expect(transitions[0]).toBe("full_break");
    expect(transitions[1]).toBe("silent");
    expect(transitions[2]).toBe("full_break");
  });

  it("stretches to four tracks when the jitter roll keeps holding", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const transitions = runSession("standard", 4);
    expect(transitions.slice(1, 4)).toEqual(["silent", "silent", "silent"]);
    expect(transitions[4]).toBe("full_break");
  });

  it("never lets a gap run past four tracks", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const transitions = runSession("standard", 8);
    let run = 0;
    for (const transition of transitions.slice(1)) {
      run = transition === "silent" ? run + 1 : 0;
      expect(run).toBeLessThanOrEqual(4);
    }
  });
});

describe("music_focused pacing", () => {
  it("holds the host until the fifth track after a break", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const transitions = runSession("music_focused", 5);
    expect(transitions.slice(1, 5)).toEqual(["silent", "silent", "silent", "silent"]);
    expect(transitions[5]).toBe("full_break");
  });

  it("forces a break by the seventh track even when jitter keeps holding", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const transitions = runSession("music_focused", 7);
    expect(transitions[7]).toBe("full_break");
  });
});

describe("music_only pacing", () => {
  it("mutes the host on every track, including the session opening", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const transitions = runSession("music_only", 10);
    expect(new Set(transitions)).toEqual(new Set(["silent"]));
  });

  it("never emits a plan while muted", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    let state = createDjSchedulerState();
    for (let i = 0; i < 5; i++) {
      const result = advance(state, `Track ${i}`, "music_only", i === 0);
      expect(result.plan).toBeNull();
      state = result.nextState;
    }
    expect(state.voicedBreakCount).toBe(0);
  });

  it("caps the pending list so a long muted run cannot build an endless recap", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    let state = createDjSchedulerState();
    for (let i = 0; i < 40; i++) {
      state = advance(state, `Track ${i}`, "music_only", i === 0).nextState;
    }
    expect(state.pendingTracks.length).toBeLessThanOrEqual(8);
    expect(state.pendingTracks.at(-1)?.title).toBe("Track 39");
  });

  it("hands the host straight back when the listener unmutes mid-session", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    let state = createDjSchedulerState();
    state = advance(state, "Track A", "music_only", true).nextState;
    state = advance(state, "Track B", "music_only").nextState;

    // Two tracks are already banked against the standard window, so the very
    // next transition is owed a break.
    const result = advance(state, "Track C", "standard");
    expect(result.transition).toBe("full_break");
    expect(result.plan?.kind).toBe("recap");
  });
});

describe("chatter pacing and the opening break", () => {
  it("still guarantees a song_intro sign-on at every audible pacing", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    for (const pacing of ["talkative", "standard", "music_focused"] as const) {
      const result = advance(createDjSchedulerState(), "Opener", pacing, true);
      expect(result.transition).toBe("full_break");
      expect(result.plan?.kind).toBe("song_intro");
      expect(result.plan?.isSessionOpening).toBe(true);
    }
  });

  it("applies a mid-session pacing change on the very next track", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    let state = createDjSchedulerState();
    state = advance(state, "Track A", "music_focused", true).nextState;
    state = advance(state, "Track B", "music_focused").nextState;
    state = advance(state, "Track C", "music_focused").nextState;

    expect(advance(state, "Track D", "standard").transition).toBe("full_break");
  });
});

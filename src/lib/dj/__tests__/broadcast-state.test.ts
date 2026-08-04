import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetDjBroadcastStoreForTests,
  finishDjSegment,
  getDjBroadcastState,
  MAX_TRANSCRIPTS,
  resetDjBroadcast,
  startDjSegment,
  subscribeDjBroadcast,
  type DjSegmentInput,
} from "../broadcast-state";

function segment(overrides: Partial<DjSegmentInput> = {}): DjSegmentInput {
  return {
    kind: "song_intro",
    transition: "full_break",
    script: "You are locked into 107.7. Here comes Nirvana.",
    songTitle: "Smells Like Teen Spirit",
    artistName: "Nirvana",
    stationName: "Grunge Gold",
    personaId: "midnight-marauder",
    ...overrides,
  };
}

describe("dj broadcast store", () => {
  beforeEach(__resetDjBroadcastStoreForTests);

  it("starts empty", () => {
    const state = getDjBroadcastState();
    expect(state.activeSegment).toBeNull();
    expect(state.isSpeaking).toBe(false);
    expect(state.transcripts).toEqual([]);
  });

  it("puts a break on air with its script split into lines", () => {
    startDjSegment(segment());

    const { activeSegment, isSpeaking } = getDjBroadcastState();
    expect(isSpeaking).toBe(true);
    expect(activeSegment?.script).toBe("You are locked into 107.7. Here comes Nirvana.");
    expect(activeSegment?.lines).toEqual(["You are locked into 107.7.", "Here comes Nirvana."]);
    expect(activeSegment?.songTitle).toBe("Smells Like Teen Spirit");
    expect(activeSegment?.startedAt).toBeGreaterThan(0);
  });

  it("trims the script and carries the plan through", () => {
    startDjSegment(segment({ script: "  Station ID.  ", kind: "stinger", transition: "stinger" }));

    const { activeSegment } = getDjBroadcastState();
    expect(activeSegment?.script).toBe("Station ID.");
    expect(activeSegment?.kind).toBe("stinger");
    expect(activeSegment?.transition).toBe("stinger");
  });

  it("files a finished break in the transcript log", () => {
    startDjSegment(segment());
    finishDjSegment();

    const state = getDjBroadcastState();
    expect(state.activeSegment).toBeNull();
    expect(state.isSpeaking).toBe(false);
    expect(state.transcripts).toHaveLength(1);
    expect(state.transcripts[0].endedAt).toBeGreaterThan(0);
    expect(state.transcripts[0].interrupted).toBeUndefined();
  });

  it("still archives a break that was cut short", () => {
    // The script was written and partly aired, which is exactly what a listener
    // scrolling back through the log is looking for.
    startDjSegment(segment());
    finishDjSegment({ interrupted: true });

    const [archived] = getDjBroadcastState().transcripts;
    expect(archived.interrupted).toBe(true);
  });

  it("keeps the newest break first", () => {
    startDjSegment(segment({ script: "First break." }));
    finishDjSegment();
    startDjSegment(segment({ script: "Second break." }));
    finishDjSegment();

    expect(getDjBroadcastState().transcripts.map((s) => s.script)).toEqual([
      "Second break.",
      "First break.",
    ]);
  });

  it("gives every break a distinct id", () => {
    startDjSegment(segment());
    finishDjSegment();
    startDjSegment(segment());

    const state = getDjBroadcastState();
    expect(state.activeSegment?.id).not.toBe(state.transcripts[0].id);
  });

  it("archives an unclosed break when the next one opens", () => {
    // Only one clip can hold the voice channel, so an open segment at this point
    // means its exit path never ran.
    startDjSegment(segment({ script: "Superseded break." }));
    startDjSegment(segment({ script: "Replacement break." }));

    const state = getDjBroadcastState();
    expect(state.activeSegment?.script).toBe("Replacement break.");
    expect(state.transcripts).toHaveLength(1);
    expect(state.transcripts[0].script).toBe("Superseded break.");
    expect(state.transcripts[0].interrupted).toBe(true);
  });

  it("caps the transcript log", () => {
    for (let i = 0; i < MAX_TRANSCRIPTS + 5; i++) {
      startDjSegment(segment({ script: `Break number ${i} here.` }));
      finishDjSegment();
    }

    const { transcripts } = getDjBroadcastState();
    expect(transcripts).toHaveLength(MAX_TRANSCRIPTS);
    expect(transcripts[0].script).toBe(`Break number ${MAX_TRANSCRIPTS + 4} here.`);
  });

  it("clears the log for a new session", () => {
    startDjSegment(segment());
    finishDjSegment();
    resetDjBroadcast();

    expect(getDjBroadcastState().transcripts).toEqual([]);
    expect(getDjBroadcastState().activeSegment).toBeNull();
  });

  it("tolerates finishing when nothing is on air", () => {
    expect(() => finishDjSegment()).not.toThrow();
    expect(getDjBroadcastState().transcripts).toEqual([]);
  });

  it("notifies subscribers and stops on unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDjBroadcast(listener);

    startDjSegment(segment());
    expect(listener).toHaveBeenCalledTimes(1);

    finishDjSegment();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    startDjSegment(segment());
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("returns an identical snapshot when nothing changed", () => {
    // `useSyncExternalStore` compares snapshots by identity, so a no-op that
    // returned a fresh object would re-render every subscriber on every call.
    const before = getDjBroadcastState();
    finishDjSegment();
    resetDjBroadcast();
    expect(getDjBroadcastState()).toBe(before);
  });

  it("replaces the snapshot rather than mutating it", () => {
    const before = getDjBroadcastState();
    startDjSegment(segment());

    expect(getDjBroadcastState()).not.toBe(before);
    expect(before.activeSegment).toBeNull();
    expect(before.transcripts).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  activeCueIndex,
  buildTeleprompterCues,
  DJ_WORDS_PER_MINUTE,
  estimateScriptDurationMs,
  splitScriptLines,
} from "../teleprompter";

describe("splitScriptLines", () => {
  it("splits on sentence boundaries and keeps the punctuation", () => {
    expect(
      splitScriptLines("That was Nirvana on 107.7. Coming up we have ABBA for you."),
    ).toEqual(["That was Nirvana on 107.7.", "Coming up we have ABBA for you."]);
  });

  it("honors authored line breaks", () => {
    expect(splitScriptLines("Good evening out there\nYou are locked into the night shift")).toEqual([
      "Good evening out there",
      "You are locked into the night shift",
    ]);
  });

  it("folds a short fragment into the line before it", () => {
    // A teleprompter that gives "Wild." its own line reads as a stutter.
    expect(splitScriptLines("That was Nirvana. Wild. Up next we have ABBA.")).toEqual([
      "That was Nirvana. Wild.",
      "Up next we have ABBA.",
    ]);
  });

  it("keeps a short opening fragment, having nothing to fold it into", () => {
    expect(splitScriptLines("Alright. Here comes the good stuff.")).toEqual([
      "Alright.",
      "Here comes the good stuff.",
    ]);
  });

  it("splits on question marks and exclamations too", () => {
    expect(splitScriptLines("Can you believe that? What a record! Here comes another.")).toEqual([
      "Can you believe that?",
      "What a record!",
      "Here comes another.",
    ]);
  });

  it("keeps a trailing-off ellipsis inside its sentence", () => {
    // "And now… something softer" is one breath, not two lines.
    expect(splitScriptLines("What a record! And now… something softer for you.")).toEqual([
      "What a record!",
      "And now… something softer for you.",
    ]);
  });

  it("does not split a decimal frequency", () => {
    expect(splitScriptLines("You are on 107.7 FM all night long.")).toEqual([
      "You are on 107.7 FM all night long.",
    ]);
  });

  it("drops blank lines and surrounding whitespace", () => {
    expect(splitScriptLines("  Line one.  \n\n\n  Line two here.  ")).toEqual([
      "Line one.",
      "Line two here.",
    ]);
  });

  it("returns nothing for empty or non-string input", () => {
    expect(splitScriptLines("")).toEqual([]);
    expect(splitScriptLines("   ")).toEqual([]);
    expect(splitScriptLines(undefined as never)).toEqual([]);
  });

  it("caps a runaway script", () => {
    const script = Array.from({ length: 200 }, (_, i) => `Sentence number ${i} here.`).join(" ");
    expect(splitScriptLines(script).length).toBeLessThanOrEqual(40);
  });
});

describe("buildTeleprompterCues", () => {
  it("gives each line a span proportional to how long it takes to say", () => {
    const cues = buildTeleprompterCues(["one two three four five six", "seven eight nine"]);
    expect(cues).toHaveLength(2);

    const first = cues[0].endMs - cues[0].startMs;
    const second = cues[1].endMs - cues[1].startMs;
    // Six words against three, so the first line owns twice the clip.
    expect(first / second).toBeCloseTo(2, 5);
  });

  it("lays cues end to end from zero", () => {
    const cues = buildTeleprompterCues(["a line with words", "another line with words"]);
    expect(cues[0].startMs).toBe(0);
    expect(cues[1].startMs).toBe(cues[0].endMs);
  });

  it("gives a one-word line a readable beat rather than a flicker", () => {
    const [cue] = buildTeleprompterCues(["Alright."]);
    const wordSpan = 60_000 / DJ_WORDS_PER_MINUTE;
    expect(cue.endMs).toBeGreaterThan(wordSpan);
  });

  it("honors a custom delivery rate", () => {
    const slow = buildTeleprompterCues(["one two three four five six seven eight"], {
      wordsPerMinute: 60,
    });
    const fast = buildTeleprompterCues(["one two three four five six seven eight"], {
      wordsPerMinute: 240,
    });
    expect(slow[0].endMs).toBeGreaterThan(fast[0].endMs);
  });

  it("ignores a nonsensical rate rather than dividing by zero", () => {
    const cues = buildTeleprompterCues(["one two three four"], { wordsPerMinute: 0 });
    expect(Number.isFinite(cues[0].endMs)).toBe(true);
    expect(cues[0].endMs).toBeGreaterThan(0);
  });

  it("returns nothing for an empty script", () => {
    expect(buildTeleprompterCues([])).toEqual([]);
    expect(buildTeleprompterCues(["", "   "])).toEqual([]);
  });
});

describe("activeCueIndex", () => {
  const cues = buildTeleprompterCues([
    "first line with several words",
    "second line with several words",
    "third line with several words",
  ]);

  it("starts on the first line", () => {
    expect(activeCueIndex(cues, 0)).toBe(0);
    expect(activeCueIndex(cues, -50)).toBe(0);
  });

  it("advances as the break plays", () => {
    expect(activeCueIndex(cues, cues[0].endMs - 1)).toBe(0);
    expect(activeCueIndex(cues, cues[0].endMs)).toBe(1);
    expect(activeCueIndex(cues, cues[1].endMs)).toBe(2);
  });

  it("holds the last line once the estimate runs out", () => {
    // The estimate is derived from text, so a slower read must not blank the
    // panel out from under the host mid-sentence.
    expect(activeCueIndex(cues, cues[2].endMs + 60_000)).toBe(2);
  });

  it("reports no line for an empty script", () => {
    expect(activeCueIndex([], 1000)).toBe(-1);
  });
});

describe("estimateScriptDurationMs", () => {
  it("measures the whole script", () => {
    const lines = ["one two three four", "five six seven eight"];
    expect(estimateScriptDurationMs(lines)).toBe(buildTeleprompterCues(lines)[1].endMs);
  });

  it("is zero for an empty script", () => {
    expect(estimateScriptDurationMs([])).toBe(0);
  });
});

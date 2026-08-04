/**
 * Teleprompter line splitting and cue timing.
 *
 * The TTS backends return an opaque audio buffer with no word timings, so the
 * on-screen script cannot be synchronized against the speech itself. Cues are
 * therefore derived from the text: each line is weighted by how long it takes to
 * *say*, and the reading head advances off wall-clock elapsed time since the
 * clip started.
 *
 * That approximation is only ever used to decide which line glows. A drifted
 * head highlights a neighbouring line; it can never desynchronize audio,
 * because nothing here feeds back into playback.
 */

/**
 * Delivery rate for a radio host reading a written break. Slower than
 * conversational speech — the breaks are punchy, so they land closer to
 * announcer pace than chat pace.
 */
export const DJ_WORDS_PER_MINUTE = 165;

/** Floor on a cue's span, so a two-word stinger line still gets a readable beat. */
const MIN_CUE_MS = 700;

/**
 * Lines shorter than this are folded into the line before them. TTS output is
 * full of "Yeah." and "Alright." fragments, and a teleprompter that gives each
 * one its own line reads as a stutter.
 */
const MIN_STANDALONE_WORDS = 3;

/** Ceiling on cue count, so a runaway script cannot build an unbounded list. */
const MAX_LINES = 40;

export type TeleprompterCue = {
  text: string;
  /** Offset from the start of the clip at which this line takes the reading head. */
  startMs: number;
  endMs: number;
};

function countWords(text: string): number {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

/**
 * Breaks a script into teleprompter lines.
 *
 * Authored line breaks win, since a script that already carries them meant
 * them. Anything still long is split on sentence boundaries, which is where a
 * host naturally draws breath.
 */
export function splitScriptLines(script: string): string[] {
  if (typeof script !== "string") return [];

  const paragraphs = script
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    // Split after . ! ? when followed by whitespace, which keeps the
    // punctuation on the line it belongs to. An ellipsis is deliberately not a
    // terminator: in written DJ copy it is a trailing-off inside a sentence
    // ("And now… something softer"), so breaking there splits one breath in two.
    const sentences = paragraph
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);

    for (const sentence of sentences) {
      const previous = lines[lines.length - 1];
      if (previous && countWords(sentence) < MIN_STANDALONE_WORDS) {
        lines[lines.length - 1] = `${previous} ${sentence}`;
        continue;
      }
      lines.push(sentence);
    }
  }

  return lines.slice(0, MAX_LINES);
}

/**
 * Assigns each line the slice of the break it is spoken in.
 *
 * Spans are proportional to word count rather than uniform: a one-line sign-off
 * and a three-clause aside do not take the same time to say, and splitting the
 * clip evenly would leave the head a full line adrift by the end.
 */
export function buildTeleprompterCues(
  lines: readonly string[],
  options?: { wordsPerMinute?: number },
): TeleprompterCue[] {
  const wpm =
    options?.wordsPerMinute && options.wordsPerMinute > 0
      ? options.wordsPerMinute
      : DJ_WORDS_PER_MINUTE;
  const msPerWord = 60_000 / wpm;

  const cues: TeleprompterCue[] = [];
  let cursor = 0;

  for (const line of lines) {
    const text = line.trim();
    if (!text) continue;

    const span = Math.max(MIN_CUE_MS, countWords(text) * msPerWord);
    cues.push({ text, startMs: cursor, endMs: cursor + span });
    cursor += span;
  }

  return cues;
}

/**
 * Index of the line holding the reading head at `elapsedMs`.
 *
 * The final line keeps the head once the cues run out, so a clip that runs
 * longer than the estimate ends on the sign-off rather than on nothing. Returns
 * -1 only for an empty script.
 */
export function activeCueIndex(cues: readonly TeleprompterCue[], elapsedMs: number): number {
  if (cues.length === 0) return -1;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;

  for (let index = 0; index < cues.length; index++) {
    if (elapsedMs < cues[index].endMs) return index;
  }

  return cues.length - 1;
}

/** Estimated spoken duration of a whole script, used for progress readouts. */
export function estimateScriptDurationMs(
  lines: readonly string[],
  options?: { wordsPerMinute?: number },
): number {
  const cues = buildTeleprompterCues(lines, options);
  return cues.length ? cues[cues.length - 1].endMs : 0;
}

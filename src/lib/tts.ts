/**
 * Shared TTS script prep for ElevenLabs / OpenAI synthesis.
 *
 * Keeps terminal punctuation intact and adds a short trailing pause so the
 * synthesizer does not clip natural voice decay at the end of a break.
 */

/** Target trailing silence after spoken audio (ms). */
export const TTS_TRAILING_SILENCE_MS = 400;

/**
 * ElevenLabs pause tag (~400ms). Appended only to the synthesis payload —
 * never shown on the teleprompter / stored transcript.
 */
export const TTS_TRAILING_BREAK_TAG = `<break time="0.4s" />`;

/** Ensure the script ends with a complete sentence terminator. */
export function ensureTerminalPunctuation(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  // Already terminated (incl. ellipsis / unicode ellipsis).
  if (/[.!?…]$/.test(trimmed) || /\.\.\.$/.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}.`;
}

/** Drop any prior ElevenLabs pause tags before re-normalizing the script. */
function stripBreakTags(text: string): string {
  return text.replace(/\s*<break\b[^>]*\/?>\s*/gi, " ").replace(/\s{2,}/g, " ").trim();
}

/**
 * Prepare copy for the TTS engine.
 *
 * - Always enforces terminal `.` / `!` / `?`.
 * - For ElevenLabs, appends a trailing `<break>` so the rendered buffer
 *   includes ~400ms of silence after the last phoneme.
 */
export function prepareTtsSynthesisText(
  text: string,
  provider: "elevenlabs" | "openai" = "elevenlabs",
): string {
  const punctuated = ensureTerminalPunctuation(stripBreakTags(text));
  if (!punctuated) return punctuated;

  if (provider === "elevenlabs") {
    return `${punctuated} ${TTS_TRAILING_BREAK_TAG}`;
  }

  // OpenAI has no SSML break tags — a trailing ellipsis cues a soft release.
  if (punctuated.endsWith("...") || punctuated.endsWith("…")) {
    return punctuated;
  }
  // Avoid "Hello...." when punctuation was just added — replace the terminator.
  if (/[.!?]$/.test(punctuated)) {
    return `${punctuated.slice(0, -1)}...`;
  }
  return `${punctuated}...`;
}

/**
 * Shared TTS script prep for ElevenLabs / OpenAI synthesis.
 *
 * Keeps terminal punctuation intact, handles LLM-injected SSML `<break>` tags
 * per provider capability, and adds a short trailing pause so the synthesizer
 * does not clip natural voice decay at the end of a break.
 */

/** Target trailing silence after spoken audio (ms). */
export const TTS_TRAILING_SILENCE_MS = 400;

/**
 * ElevenLabs pause tag (~400ms). Appended only to the synthesis payload —
 * never shown on the teleprompter / stored transcript.
 */
export const TTS_TRAILING_BREAK_TAG = `<break time="0.4s" />`;

/** Match SSML / ElevenLabs break tags (self-closing or open/close). */
const SSML_BREAK_TAG_RE = /\s*<break\b[^>]*\/?>\s*/gi;

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

/**
 * Strip SSML / ElevenLabs `<break>` markup for providers that cannot accept it
 * (OpenAI `tts-1` reads tags as spoken text if left in).
 */
export function stripSsmlBreakTags(text: string): string {
  return text.replace(SSML_BREAK_TAG_RE, " ").replace(/\s{2,}/g, " ").trim();
}

/**
 * Convert SSML pause tags into ellipsis so OpenAI still gets a soft pacing cue
 * without raw markup in the synthesis payload.
 */
export function ssmlBreaksToEllipsis(text: string): string {
  return text
    .replace(SSML_BREAK_TAG_RE, "... ")
    .replace(/\.{4,}/g, "...")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Drop only trailing break tags so we can re-append a single terminal pause. */
function stripTrailingBreakTags(text: string): string {
  return text.replace(/(\s*<break\b[^>]*\/?>\s*)+$/gi, "").trim();
}

/**
 * Prepare copy for the TTS engine.
 *
 * - Always enforces terminal `.` / `!` / `?`.
 * - ElevenLabs: **preserves** inline SSML `<break>` tags from extended commentary
 *   formats, then appends a trailing `<break>` for voice decay.
 * - OpenAI `tts-1`: does not accept raw SSML — break tags are converted to
 *   ellipsis pacing cues, then a soft trailing ellipsis is applied.
 */
export function prepareTtsSynthesisText(
  text: string,
  provider: "elevenlabs" | "openai" = "elevenlabs",
): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  if (provider === "openai") {
    const softened = ssmlBreaksToEllipsis(trimmed);
    const punctuated = ensureTerminalPunctuation(softened);
    if (!punctuated) return punctuated;
    if (punctuated.endsWith("...") || punctuated.endsWith("…")) {
      return punctuated;
    }
    if (/[.!?]$/.test(punctuated)) {
      return `${punctuated.slice(0, -1)}...`;
    }
    return `${punctuated}...`;
  }

  // ElevenLabs: keep mid-script SSML breaks; normalize a single trailing pause.
  const withoutTrailing = stripTrailingBreakTags(trimmed);
  const punctuated = ensureTerminalPunctuation(withoutTrailing);
  if (!punctuated) return punctuated;
  return `${punctuated} ${TTS_TRAILING_BREAK_TAG}`;
}

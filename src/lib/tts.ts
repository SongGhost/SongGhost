/**
 * Shared TTS script prep for ElevenLabs / OpenAI synthesis.
 *
 * Keeps terminal punctuation intact, converts LLM-injected SSML into natural
 * pacing cues (providers must never receive raw XML tags), and adds a soft
 * trailing pause so the synthesizer does not clip natural voice decay.
 *
 * OpenAI live-dial synthesis uses `gpt-4o-mini-tts`. Delivery `instructions`
 * are a separate API field (not part of `input`) and are not handled here.
 */

/** Live-dial OpenAI TTS model — supports all 13 voices + `instructions`. */
export const OPENAI_TTS_MODEL = "gpt-4o-mini-tts" as const;

/** `gpt-4o-mini-tts` input limit. Reject rather than truncate. */
export const OPENAI_TTS_MAX_INPUT_CHARS = 2000;

export function assertOpenAiTtsInputLength(text: string): void {
  if (text.length > OPENAI_TTS_MAX_INPUT_CHARS) {
    throw new Error(
      `OpenAI TTS input exceeds ${OPENAI_TTS_MAX_INPUT_CHARS} characters (got ${text.length}). Shorten the script and retry.`,
    );
  }
}

export function isOpenAiTtsInputTooLongError(error: unknown): error is Error {
  return (
    error instanceof Error
    && error.message.startsWith("OpenAI TTS input exceeds")
  );
}

/** Target trailing silence after spoken audio (ms). */
export const TTS_TRAILING_SILENCE_MS = 400;

/**
 * Legacy ElevenLabs pause tag (~400ms). Kept for callers/tests that still
 * reference the constant — synthesis payloads no longer append raw SSML.
 */
export const TTS_TRAILING_BREAK_TAG = `<break time="0.4s" />`;

/** Match SSML / ElevenLabs break tags (self-closing or open/close). */
const SSML_BREAK_TAG_RE = /\s*<break\b[^>]*\/?>\s*/gi;

/** Any remaining SSML / XML markup (e.g. `<say-as>`, `<emphasis>`). */
const SSML_OR_XML_TAG_RE = /<\/?[a-zA-Z][^>]*>/g;

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
 * (OpenAI `gpt-4o-mini-tts` reads tags as spoken text if left in).
 */
export function stripSsmlBreakTags(text: string): string {
  return text.replace(SSML_BREAK_TAG_RE, " ").replace(/\s{2,}/g, " ").trim();
}

/**
 * Convert SSML pause tags into ellipsis so TTS still gets a soft pacing cue
 * without raw markup in the synthesis payload.
 */
export function ssmlBreaksToEllipsis(text: string): string {
  return text
    .replace(SSML_BREAK_TAG_RE, "... ")
    .replace(/\.{4,}/g, "...")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Strip all SSML / XML tags from script text.
 * `<break time="..."/>` becomes an ellipsis pacing cue; other tags are removed.
 */
export function stripAllSsmlTags(text: string): string {
  return text
    .replace(SSML_BREAK_TAG_RE, " ... ")
    .replace(SSML_OR_XML_TAG_RE, " ")
    .replace(/\.{4,}/g, "...")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Drop only trailing break tags so we can re-append a single terminal pause. */
function stripTrailingBreakTags(text: string): string {
  return text.replace(/(\s*<break\b[^>]*\/?>\s*)+$/gi, "").trim();
}

/**
 * Soft trailing ellipsis so voice decay is not clipped (no raw SSML).
 */
function withTrailingEllipsisPause(text: string): string {
  if (!text) return text;
  if (text.endsWith("...") || text.endsWith("…")) {
    return text;
  }
  if (/[.!?]$/.test(text)) {
    return `${text.slice(0, -1)}...`;
  }
  return `${text}...`;
}

/**
 * Prepare copy for the TTS engine.
 *
 * - Always enforces terminal `.` / `!` / `?`.
 * - Both ElevenLabs and OpenAI `gpt-4o-mini-tts`: strip all SSML / XML tags;
 *   convert `<break>` pauses into ellipsis pacing cues; append a soft trailing
 *   ellipsis. Raw markup must never reach either provider.
 */
export function prepareTtsSynthesisText(
  text: string,
  _provider: "elevenlabs" | "openai" = "elevenlabs",
): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  // Drop a trailing SSML pause first so stripAllSsmlTags does not leave a
  // dangling ellipsis before we add our own terminal cue.
  const withoutTrailing = stripTrailingBreakTags(trimmed);
  const cleaned = stripAllSsmlTags(withoutTrailing);
  const punctuated = ensureTerminalPunctuation(cleaned);
  if (!punctuated) return punctuated;
  return withTrailingEllipsisPause(punctuated);
}

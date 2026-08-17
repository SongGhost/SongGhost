import { ensureTerminalPunctuation } from "@/lib/tts";

const BANNED_OPENER_PATTERNS = [
  /^fun fact[:\s]/i,
  /^did you know[:\s.]/i,
  /^here'?s a fun fact[:\s]/i,
  /^here'?s an interesting fact[:\s]/i,
  /^speaking of[:\s.]/i,
  /^welcome back listeners[:\s]/i,
  /^welcome back[,\s]/i,
];

/**
 * Emoji / pictograph sequences that TTS engines attempt to name aloud
 * ("red heart", "fire") and must never reach the synthesizer.
 */
const EMOJI_PATTERN =
  /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu;

export type FormatScriptForTtsOptions = {
  /**
   * Mode A (decoded clip ≤ 15s) — insert pauses only at true sentence
   * boundaries. Skips per-clause ellipsis injection that inflates duration.
   */
  compactPauses?: boolean;
};

/** Strip stage directions, markdown, emojis, and orphan punctuation before TTS. */
export function sanitizeDjScript(text: string): string {
  return text
    .replace(/\*[^*]+\*/g, "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\([^)]+\)/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/_/g, "")
    .replace(/\*/g, "")
    .replace(EMOJI_PATTERN, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,;:.!?])/g, "$1")
    .replace(/[,;:]+$/g, "")
    .replace(/[—–\-]+$/g, "")
    .replace(/^[\s*#_]+/, "")
    .replace(/[\s*#_]+$/, "")
    .trim();
}

/** Enforce TTS-friendly punctuation and sentence length after generation. */
export function formatScriptForTts(
  text: string,
  options?: FormatScriptForTtsOptions,
): string {
  let script = text.trim();

  for (const pattern of BANNED_OPENER_PATTERNS) {
    if (pattern.test(script)) {
      script = script.replace(pattern, "").trim();
      script = script.charAt(0).toUpperCase() + script.slice(1);
    }
  }

  script = script.replace(/\s+-\s+/g, " — ");

  if (options?.compactPauses) {
    // Mode A: TTS already pauses at .!? — do not expand duration with
    // per-clause ellipses or comma-split chunks joined by " ... ".
    script = script.replace(/\s*\.\.\.\s*/g, ". ");
    script = script.replace(/[.!?]{2,}/g, (m) => m[0]);
    script = script.replace(/\s{2,}/g, " ").trim();
    return ensureTerminalPunctuation(script);
  }

  script = script.replace(/([.!?])\s+(?=[A-Z"])/g, "$1 ... ");

  const sentences = script.split(/\s*\.\.\.\s*|\.\s+/).filter(Boolean);
  const formatted = sentences.flatMap((sentence) => splitLongSentence(sentence.trim()));

  // Splitting on periods drops terminators — restore a complete sentence end
  // so TTS does not clip mid-release on an open phrase.
  return ensureTerminalPunctuation(
    formatted.join(" ... ").replace(/\s{2,}/g, " ").trim(),
  );
}

function splitLongSentence(sentence: string): string[] {
  const words = sentence.split(/\s+/);
  if (words.length <= 12) return [sentence];

  const chunks: string[] = [];
  let current: string[] = [];

  for (const word of words) {
    current.push(word);
    if (current.length >= 10 && word.endsWith(",")) {
      chunks.push(current.join(" ").replace(/,$/, ""));
      current = [];
    } else if (current.length >= 12) {
      chunks.push(current.join(" "));
      current = [];
    }
  }

  if (current.length > 0) chunks.push(current.join(" "));
  return chunks;
}

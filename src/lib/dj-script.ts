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

/** Strip stage directions, asterisks, brackets, and parenthetical notes before TTS. */
export function sanitizeDjScript(text: string): string {
  return text
    .replace(/\*[^*]+\*/g, "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\([^)]+\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Enforce TTS-friendly punctuation and sentence length after generation. */
export function formatScriptForTts(text: string): string {
  let script = text.trim();

  for (const pattern of BANNED_OPENER_PATTERNS) {
    if (pattern.test(script)) {
      script = script.replace(pattern, "").trim();
      script = script.charAt(0).toUpperCase() + script.slice(1);
    }
  }

  script = script.replace(/\s+-\s+/g, " — ");
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

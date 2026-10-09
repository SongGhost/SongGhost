/**
 * The gate for a spoken line.
 * A name, a year, or a number that is not in the source pack fails.
 * A credit has to keep the role the source gave it.
 * Warmth is allowed. Sentence shape and a compliment list are not checked.
 */

import { titleForSpeech } from "@/lib/dj/trackSpeech";
import type { SheetClaim } from "./claims";
import type { FactPack, SourcePassage } from "./types";

const COMMON = new Set([
  "a", "an", "and", "as", "at", "back", "be", "because", "been", "before", "but", "by",
  "can", "come", "comes", "coming", "could", "did", "do", "does", "don't", "down",
  "for", "from", "get", "gets", "go", "going", "got", "had", "has", "have", "he",
  "her", "here", "here's", "hey", "him", "his", "how", "i", "i'm", "if", "in", "into",
  "is", "isn't", "it", "it's", "its", "just", "keep", "know", "let", "let's", "like",
  "made", "make", "me", "more", "my", "not", "now", "of", "on", "one", "or", "our",
  "out", "she", "so", "still", "than", "that", "that's", "the", "their", "them",
  "then", "there", "there's", "these", "they", "this", "to", "too", "up", "us",
  "was", "we", "we're", "were", "what", "when", "where", "which", "while", "who",
  "why", "will", "with", "you", "you're", "your", "yeah", "yes", "yet",
  "about", "after", "again", "album", "already", "also", "another", "around", "band",
  "became", "before", "behind", "between", "both", "brought", "called", "came",
  "chorus", "cut",   "during", "each", "ear", "early", "end", "enjoy", "enough", "even", "ever",
  "every", "experience", "feel", "feels", "felt", "few", "first", "full", "gets", "give", "gives",
  "gone", "good", "great", "hard", "hear", "heard", "hearing", "heart", "hit", "hold",
  "holds", "home", "huge", "kind", "last",   "later", "leave", "left", "line", "listen",
  "little", "long", "look", "love", "loved", "loves", "loud", "maybe", "means",
  "might", "most", "much", "music", "name", "named", "never", "new", "next", "night",
  "nothing", "off", "old", "once", "only", "open", "originally", "other", "over", "own", "part",
  "people", "place", "play", "played", "playing", "puts", "quiet", "real", "really",
  "record", "recorded", "recording", "release", "released", "right", "room", "same",
  "say", "says", "second", "session", "sessions", "short", "side", "simply", "sing",
  "sings", "sit", "sits", "something", "song", "songs", "sound", "sounds", "start",
  "started", "stay", "stick", "still", "story", "studio", "take", "takes", "thing",
  "things", "think", "through", "time", "today", "together", "told", "took", "track",
  "true", "turn", "turns", "two", "under", "until", "version", "voice", "want", "way",
  "well", "went", "whole", "without", "word", "words", "work", "worked", "world",
  "worth", "would", "written", "wrote", "year", "years",
]);

export const STORY_WORDS: Record<FactPack["depth"], { minWords: number; maxWords: number }> = {
  standard: { minWords: 40, maxWords: 70 },
  roots_branches: { minWords: 70, maxWords: 120 },
  time_capsule: { minWords: 70, maxWords: 120 },
  directors_cut: { minWords: 120, maxWords: 180 },
};

type CreditRole = "composer" | "lyricist" | "writer" | "producer" | "engineer" | "arranger";

function wordCount(script: string): number {
  return script.trim().split(/\s+/).filter(Boolean).length;
}

function normalizeToken(raw: string): string {
  return raw
    .replace(/[’‘]/g, "'")
    .replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, "")
    .toLowerCase();
}

/** "U.S." is the same place as "United States" when that place is in the source. */
function placeAbbreviationOk(key: string, blob: string): boolean {
  const lower = blob.toLowerCase();
  const bare = key.replace(/\./g, "");
  if (bare === "us" || key === "u.s") {
    return lower.includes("united states") || /\bu\.s\.?\b/.test(lower);
  }
  if (bare === "uk" || key === "u.k") {
    return lower.includes("united kingdom") || /\bu\.k\.?\b/.test(lower);
  }
  return false;
}

/** "B" in "R&B" is part of the source, not a new name. */
function initialismOk(key: string, blob: string): boolean {
  if (!/^[a-z]$/.test(key)) return false;
  const lower = blob.toLowerCase();
  return lower.includes(`${key}&`) || lower.includes(`&${key}`);
}

function packBlob(pack: FactPack): string {
  const passages = (pack.passages ?? []).map((passage) => `${passage.title} ${passage.text} ${passage.sourceName}`);
  const claims = (pack.sheet ?? []).map((claim) =>
    [claim.claim, ...claim.names, ...claim.places, ...claim.numbers, ...claim.years.map(String)].join(" "),
  );
  return [
    pack.now.title,
    pack.now.artist,
    pack.now.album,
    pack.previous?.title,
    pack.previous?.artist,
    pack.stationName,
    pack.tease?.claim,
    ...(pack.tease?.names ?? []),
    ...(pack.tease?.places ?? []),
    ...pack.nuggets.map((nugget) => nugget.sentence),
    ...passages,
    ...claims,
  ].filter(Boolean).join(" ");
}

function allowedTokens(pack: FactPack): Set<string> {
  const allowed = new Set<string>(COMMON);
  for (const piece of packBlob(pack).split(/[\s/]+/)) {
    const key = normalizeToken(piece);
    if (!key) continue;
    allowed.add(key);
    allowed.add(key.replace(/'/g, ""));
    for (const part of key.split("-")) {
      if (part) allowed.add(part);
    }
  }
  return allowed;
}

function yearsIn(text: string): string[] {
  return text.match(/\b(?:1[89]|20)\d{2}\b/g) ?? [];
}

function numbersIn(text: string): string[] {
  return text.match(/\b\d+(?:\.\d+)?\b/g) ?? [];
}

function roleOfClaim(claim: string): { role: CreditRole; qualifier: string } | null {
  const qualifier = /\bassistant\b/i.test(claim)
    ? "assistant"
    : /\bexecutive\b/i.test(claim)
      ? "executive"
      : /\badditional\b/i.test(claim)
        ? "additional"
        : /\bassociate\b/i.test(claim)
          ? "associate"
          : /\bco-/.test(claim)
            ? "co"
            : "";
  if (/\blyric/i.test(claim)) return { role: "lyricist", qualifier };
  if (/\bcomposed\b|\bcomposer\b/i.test(claim)) return { role: "composer", qualifier };
  if (/\barranged\b|\barranger\b/i.test(claim)) return { role: "arranger", qualifier };
  if (/\bengineer/i.test(claim)) return { role: "engineer", qualifier };
  if (/\bproduc/i.test(claim)) return { role: "producer", qualifier };
  if (/\bwrote\b|\bwritten by\b|\bwriter\b/i.test(claim)) return { role: "writer", qualifier };
  return null;
}

function creditRoles(pack: FactPack): Map<string, Array<{ role: CreditRole; qualifier: string }>> {
  const map = new Map<string, Array<{ role: CreditRole; qualifier: string }>>();
  for (const claim of pack.sheet ?? []) {
    const found = roleOfClaim(claim.claim);
    if (!found) continue;
    for (const name of claim.names) {
      const key = name.toLowerCase();
      const list = map.get(key) ?? [];
      list.push(found);
      map.set(key, list);
    }
  }
  return map;
}

function scriptRole(sentence: string, name: string): { role: CreditRole; qualifier: string } | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const near = new RegExp(`(?:${escaped}.{0,48}|.{0,48}${escaped})`, "i");
  const window = sentence.match(near)?.[0] ?? "";
  if (!window) return null;
  return roleOfClaim(window);
}

function roleFits(
  spoken: { role: CreditRole; qualifier: string },
  known: Array<{ role: CreditRole; qualifier: string }>,
): boolean {
  const same = known.filter((row) => row.role === spoken.role || (spoken.role === "writer" && (row.role === "composer" || row.role === "lyricist" || row.role === "writer")));
  if (spoken.role === "composer" && known.some((row) => row.role === "lyricist") && !known.some((row) => row.role === "composer" || row.role === "writer")) {
    return false;
  }
  if (spoken.role === "lyricist" && known.some((row) => row.role === "composer") && !known.some((row) => row.role === "lyricist" || row.role === "writer")) {
    return false;
  }
  if (same.length === 0) return spoken.role === "writer";
  if (!spoken.qualifier && same.some((row) => row.qualifier === "assistant" || row.qualifier === "additional" || row.qualifier === "executive")) {
    const full = same.some((row) => !row.qualifier || row.qualifier === "co");
    if (!full) return false;
  }
  return true;
}

function capitalizedWords(script: string): string[] {
  const words: string[] = [];
  for (const sentence of script.split(/(?<=[.!?])\s+/)) {
    const tokens = sentence.match(/[A-Za-z][A-Za-z0-9'’\-.]*/g) ?? [];
    tokens.forEach((token, index) => {
      const bare = token.replace(/[.’']+$/g, "");
      if (!bare) return;
      const internalCap = /[A-Z].*[A-Z]/.test(bare);
      const starts = index === 0;
      const next = tokens[index + 1] ?? "";
      const nextIsName = /^[A-Z]/.test(next.replace(/^[^A-Za-z]+/, ""));
      if (starts && !internalCap && !nextIsName) return;
      if (starts && !internalCap && /ly$/i.test(bare)) return;
      if (!/[A-Z]/.test(bare[0] ?? "") && !internalCap) return;
      words.push(bare);
    });
  }
  return words;
}

export function storyRange(pack: Pick<FactPack, "depth" | "passages" | "nuggets" | "sessionOpening">): { minWords: number; maxWords: number } {
  if (pack.sessionOpening) return { minWords: 8, maxWords: 32 };
  const hasSource = (pack.passages?.length ?? 0) > 0 || pack.nuggets.length > 0;
  if (!hasSource) return { minWords: 0, maxWords: 24 };
  return STORY_WORDS[pack.depth];
}

/** Why this line cannot air. An empty list means it can. */
export function sourceLineFailures(script: string, pack: FactPack): string[] {
  const text = script.replace(/\s+/g, " ").trim();
  const reasons: string[] = [];
  if (!text) return ["The line was empty."];
  const range = storyRange(pack);
  const count = wordCount(text);
  if (!pack.sessionOpening && count > range.maxWords + 20) {
    reasons.push(`That is ${count} words. Keep it to about ${range.maxWords}.`);
  }
  const allowed = allowedTokens(pack);
  const blob = packBlob(pack);
  const allowedYears = new Set(yearsIn(blob));
  for (const year of yearsIn(text)) {
    if (!allowedYears.has(year)) reasons.push(`The year ${year} is not in the source.`);
  }
  const allowedNumbers = new Set(numbersIn(blob));
  for (const number of numbersIn(text)) {
    if (/^(?:19|20)\d{2}$/.test(number)) continue;
    if (!allowedNumbers.has(number)) reasons.push(`The number ${number} is not in the source.`);
  }
  for (const word of capitalizedWords(text)) {
    const key = normalizeToken(word);
    if (!key || COMMON.has(key)) continue;
    const stem = key.replace(/'s$/, "");
    if (allowed.has(key) || allowed.has(stem) || placeAbbreviationOk(key, blob) || initialismOk(key, blob)) continue;
    reasons.push(`The name ${word} is not in the source.`);
  }
  const roles = creditRoles(pack);
  const names = [...roles.keys()];
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    for (const name of names) {
      if (!sentence.toLowerCase().includes(name)) continue;
      const spoken = scriptRole(sentence, name);
      if (!spoken) continue;
      const known = roles.get(name) ?? [];
      if (!roleFits(spoken, known)) {
        const locked = known.map((row) => [row.qualifier, row.role].filter(Boolean).join(" ")).join(", ");
        reasons.push(`${name} is ${locked} in the source. Keep that role.`);
      }
    }
  }
  const title = titleForSpeech(pack.now.title).toLowerCase();
  const artist = pack.now.artist.trim().toLowerCase();
  const lower = text.toLowerCase();
  if (!pack.sessionOpening && title && artist && !lower.includes(title) && !lower.includes(artist)) {
    reasons.push("Name the song or the artist.");
  }
  return reasons;
}

export function sourceLineOk(script: string, pack: FactPack): boolean {
  return sourceLineFailures(script, pack).length === 0;
}

export function passageQuotes(passages: readonly SourcePassage[] | undefined): string {
  return (passages ?? [])
    .map((passage) => `${passage.sourceName} (${passage.url})\n${passage.text}`)
    .join("\n\n")
    .slice(0, 6000);
}

export function citedPassages(
  script: string,
  passages: readonly SourcePassage[] | undefined,
): Array<{ name: string; url: string; claim: string }> {
  const words = new Set(
    script.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 4 && !COMMON.has(word)),
  );
  const ranked = (passages ?? [])
    .map((passage) => {
      const overlap = passage.text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => words.has(word)).length;
      return { passage, overlap };
    })
    .filter((row) => row.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap);
  const chosen = ranked.length > 0 ? ranked : (passages ?? []).slice(0, 1).map((passage) => ({ passage, overlap: 0 }));
  return chosen.slice(0, 3).map(({ passage }) => ({
    name: passage.sourceName,
    url: passage.url,
    claim: passage.text.split(/(?<=[.!?])\s+/)[0]?.slice(0, 240) ?? passage.title,
  }));
}

export function claimSupportsLine(claim: SheetClaim, script: string): boolean {
  const lower = script.toLowerCase();
  return claim.names.some((name) => name.length > 2 && lower.includes(name.toLowerCase()))
    || claim.places.some((place) => place.length > 2 && lower.includes(place.toLowerCase()));
}

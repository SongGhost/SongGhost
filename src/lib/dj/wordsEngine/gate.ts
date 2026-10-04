/**
 * Reject a New script that invents a proper noun, runs past the depth cap,
 * or names the wrong song as what's next.
 * Ordinary rephrasing is allowed. A word does not have to appear in the draft.
 */

import { formatTrackByline } from "@/lib/dj/trackSpeech";
import type { FactNugget, FactPack } from "./types";

const GLUE = new Set([
  "a", "an", "and", "at", "back", "by", "came", "for", "from", "heard", "here",
  "hold", "in", "is", "it", "its", "just", "listen", "moment", "next", "now", "of",
  "on", "one", "onto", "out", "produced", "recorded", "that", "the", "this",
  "to", "up", "was", "with", "worth", "you", "your", "ear",
]);

/** Everyday speech. Capitalized words outside this set and outside the pack are treated as invented names. */
const COMMON = new Set([
  ...GLUE,
  "about", "after", "again", "already", "also", "always", "another", "any", "around",
  "artist", "back", "band", "be", "because", "been", "before", "being", "between",
  "both", "brings", "but", "called", "can", "can't", "clean", "clearly", "close",
  "closes", "come", "coming", "could", "cut", "did", "do", "does", "don't", "down",
  "dry", "each", "earlier", "easy", "either", "end", "ends", "even", "every",
  "everyone", "everything", "feel", "feels", "felt", "few", "first", "folks",
  "get", "gets", "getting", "go", "goes", "going", "gonna", "good", "got", "great",
  "had", "hard", "has", "have", "he", "hear", "hearing", "her", "here's", "herself",
  "hey", "him", "himself", "his", "hit", "hits", "how", "human", "i", "i'm", "if",
  "into", "isn't", "it's", "itself", "keep", "keeps", "kept", "know", "known",
  "knows", "last", "later", "leave", "leaves", "left", "let", "let's", "like",
  "line", "listed", "little", "long", "made", "make", "many", "maybe", "minute",
  "more", "most", "much", "my", "myself", "name", "named", "names", "never", "new",
  "no", "not", "nothing", "off", "oh", "old", "once", "only", "open", "opens",
  "or", "other", "our", "ourselves", "over", "own", "place", "plain", "play",
  "played", "playing", "puts", "quietly", "real", "really", "record", "release",
  "released", "remember", "right", "room", "runs", "same", "say", "second", "she",
  "short", "side", "simply", "so", "softly", "some", "somebody", "something",
  "somewhere", "song", "songs", "soon", "sound", "sounds", "start", "starts",
  "stay", "stays", "still", "such", "take", "takes", "than", "that's", "their",
  "them", "themselves", "then", "there", "there's", "these", "they", "they're",
  "thing", "thought", "through", "time", "times", "title", "today", "together",
  "tonight", "too", "track", "true", "twice", "under", "until", "us", "very",
  "via", "voice", "way", "we", "we're", "well", "went", "what", "when", "where",
  "which", "while", "who", "why", "will", "without", "won't", "yeah", "year",
  "yes", "yet", "you're", "your",
]);

const PROFANITY = /\b(?:fuck|fucking|shit|bitch|asshole)\b/i;

const PERSONA_STICKERS = /\b(?:listen for this|worth your ear|hold onto this)\b/i;

export function wordCeiling(pack: Pick<FactPack, "depth" | "shape" | "nuggets" | "recapLines">): number {
  if (pack.shape === "song_id" || pack.shape === "stinger") return 18;
  if (pack.shape === "recap") return Math.max(24, 12 + pack.recapLines.length * 10);
  if (pack.shape === "teaser") return 36;
  const count = pack.nuggets.length;
  if (count === 0 || pack.depth === "standard") return 32;
  if (pack.depth === "roots_branches") return 48;
  if (pack.depth === "time_capsule") return 36 + 18 * count;
  return Math.min(120, 36 + 22 * count);
}

export function wordCount(script: string): number {
  return script.trim().split(/\s+/).filter(Boolean).length;
}

function normalizeToken(raw: string): string {
  return raw.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, "").toLowerCase();
}

function packTokens(pack: FactPack): Set<string> {
  const blob = [
    pack.now.title,
    pack.now.artist,
    pack.previous?.title,
    pack.previous?.artist,
    pack.pastNugget?.sentence,
    pack.stationName,
    ...pack.recapLines,
    ...pack.nuggets.map((nugget) => nugget.sentence),
  ]
    .filter(Boolean)
    .join(" ");

  const allowed = new Set<string>(COMMON);
  for (const piece of blob.split(/[\s/]+/)) {
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

function yearsIn(script: string): string[] {
  return script.match(/\b(?:1[5-9]\d{2}|20\d{2})\b/g) ?? [];
}

function looksLikeProperNoun(raw: string): boolean {
  const word = raw.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
  if (!word) return false;
  const first = word[0] ?? "";
  return first === first.toUpperCase() && first !== first.toLowerCase();
}

function namesUpcoming(script: string, pack: FactPack): boolean {
  if (pack.shape === "stinger" || pack.shape === "recap") return true;
  const title = pack.now.title.trim().toLowerCase();
  if (!title) return true;
  return script.toLowerCase().includes(title);
}

function upNextNamesUpcoming(script: string, pack: FactPack): boolean {
  const lower = script.toLowerCase();
  const marker = "up next";
  const idx = lower.indexOf(marker);
  if (idx < 0) return true;
  const upcoming = pack.now.title.trim().toLowerCase();
  if (!upcoming) return true;
  const clause = lower.slice(idx + marker.length).split(/[.!?]/)[0] ?? "";
  return clause.includes(upcoming);
}

function distinctiveTokens(nugget: FactNugget, names: Set<string>): string[] {
  return nugget.sentence
    .split(/[\s/]+/)
    .map(normalizeToken)
    .filter((token) => token.length > 2 && !names.has(token) && !GLUE.has(token));
}

function nameTokens(pack: FactPack): Set<string> {
  return new Set(
    `${pack.now.title} ${pack.now.artist}`.split(/[\s/]+/).map(normalizeToken).filter(Boolean),
  );
}

/** Nugget ids whose distinctive words actually appear in the spoken line. */
export function nuggetIdsUsedInScript(script: string, pack: FactPack): string[] {
  const lower = script.toLowerCase();
  const names = nameTokens(pack);
  const ids: string[] = [];
  for (const nugget of pack.nuggets) {
    const distinctive = distinctiveTokens(nugget, names);
    if (distinctive.length === 0) continue;
    if (distinctive.some((token) => lower.includes(token))) ids.push(nugget.id);
  }
  return ids;
}

function nuggetsUsed(script: string, pack: FactPack): number {
  return nuggetIdsUsedInScript(script, pack).length;
}

/**
 * The whole line is only "Title by Artist."
 * Names-only IDs, recaps, and catch-up handoffs are allowed to use that phrase.
 */
export function isCannedTitleByArtist(script: string, pack: FactPack): boolean {
  if (pack.nuggets.length > 0) return false;
  if (pack.shape !== "lore" && pack.shape !== "teaser" && pack.shape !== "catchup") return false;
  const text = script.replace(/\s+/g, " ").trim().replace(/[.!?]+$/g, "").toLowerCase();
  const byline = formatTrackByline(pack.now).replace(/[.!?]+$/g, "").toLowerCase();
  return Boolean(byline) && text === byline;
}

const MOOD_WITHOUT_FACT = /\b(?:soaring|dive into|essence of)\b/i;
const SOURCED_FACT_MARKER = /\b(?:19|20)\d{2}\b|\b(?:album|recorded|produced|studio|credited)\b/i;

/** Mood words the host may not state as facts unless that word is already in the pack. */
const SOFT_MOOD_WORDS = [
  "haunting",
  "melancholy",
  "dreamy",
  "soulful",
  "anthemic",
  "brooding",
  "ethereal",
  "bittersweet",
  "heartbreaking",
  "soaring",
] as const;

const SOFT_CLAIM_PHRASES = [
  "guest vocalist",
  "guest vocalists",
  "guest vocals",
  "guest vocal",
  "featured vocalist",
  "featured vocalists",
  "featured vocals",
  "backing vocalist",
  "backing vocalists",
  "dive into",
  "essence of",
] as const;

function packSpeechBlob(pack: FactPack): string {
  return [
    pack.now.title,
    pack.now.artist,
    pack.previous?.title,
    pack.previous?.artist,
    pack.pastNugget?.sentence,
    pack.stationName,
    ...pack.recapLines,
    ...pack.nuggets.map((nugget) => nugget.sentence),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * A concrete claim that is not in the pack: a guest vocalist, a mood stated
 * as a fact, or a label/brand the pack does not name.
 * Warmth words that are not in this list may still wrap a listed fact.
 */
export function hasSoftClaimAbsentFromPack(script: string, pack: FactPack): boolean {
  const blob = packSpeechBlob(pack);
  const lower = script.toLowerCase();
  for (const phrase of SOFT_CLAIM_PHRASES) {
    if (lower.includes(phrase) && !blob.includes(phrase)) return true;
  }
  for (const word of SOFT_MOOD_WORDS) {
    const pattern = new RegExp(`\\b${word}\\b`, "i");
    if (pattern.test(script) && !pattern.test(blob)) return true;
  }
  const label = lower.match(/\b(?:on|via|from)\s+(?:the\s+)?([a-z0-9][\w'.-]*)\s+label\b/);
  const brand = label?.[1]?.toLowerCase();
  if (brand && !blob.includes(brand)) return true;
  return false;
}

/**
 * "That was / up next" plus mood words, and no pack fact in the line.
 * Color wrapped around a sourced fact is allowed.
 */
export function isMoodColorWithoutFact(script: string, pack: FactPack): boolean {
  if (nuggetsUsed(script, pack) > 0) return false;
  return MOOD_WITHOUT_FACT.test(script);
}

/**
 * A mood line with no year, album, studio, or credit in the words themselves.
 * Used when the earcon decision does not have the fact pack.
 */
export function isUngroundedMoodLine(script: string): boolean {
  if (!MOOD_WITHOUT_FACT.test(script)) return false;
  return !SOURCED_FACT_MARKER.test(script);
}

function depthOwesAFact(pack: FactPack): boolean {
  if (pack.sessionOpening) return false;
  if (pack.nuggets.length === 0) return false;
  if (pack.shape === "song_id" || pack.shape === "stinger" || pack.shape === "recap") return false;
  return pack.depth === "directors_cut"
    || pack.depth === "roots_branches"
    || pack.depth === "time_capsule";
}

function namesUpcomingArtist(script: string, pack: FactPack): boolean {
  if (pack.shape === "stinger" || pack.shape === "recap") return true;
  const artist = pack.now.artist.trim().toLowerCase();
  if (!artist) return true;
  return script.toLowerCase().includes(artist);
}

/**
 * An empty pack may only say who this song is.
 * A scene, a decade, a genre tag, or mood filler is not allowed in that line.
 */
function identityLineStaysHuman(script: string, pack: FactPack): boolean {
  if (pack.nuggets.length > 0) return true;
  if (pack.shape === "song_id" || pack.shape === "stinger" || pack.shape === "recap") return true;
  const allowed = packTokens(pack);
  for (const raw of script.split(/\s+/)) {
    const key = normalizeToken(raw);
    if (!key) continue;
    if (allowed.has(key) || allowed.has(key.replace(/'/g, ""))) continue;
    return false;
  }
  return true;
}

function claimsMissingReleaseYear(script: string, pack: FactPack): boolean {
  if (pack.allowedYears.length > 0) return false;
  return /\b(?:came out|released) in\b/i.test(script);
}

export function scriptPassesGate(script: string, pack: FactPack): boolean {
  const text = script.replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (/\byou just heard\b/i.test(text)) return false;
  if (!pack.songOneExit && /\bthat was\b/i.test(text)) return false;
  if (isCannedTitleByArtist(text, pack)) return false;
  if (/\bfiled under\b/i.test(text)) return false;
  if (!identityLineStaysHuman(text, pack)) return false;
  if (claimsMissingReleaseYear(text, pack)) return false;
  if (wordCount(text) > wordCeiling(pack)) return false;
  if (!pack.allowExplicit && PROFANITY.test(text)) return false;
  if (PERSONA_STICKERS.test(text)) return false;
  if (!namesUpcoming(text, pack)) return false;
  if (!namesUpcomingArtist(text, pack)) return false;
  if (!upNextNamesUpcoming(text, pack)) return false;
  if (isMoodColorWithoutFact(text, pack)) return false;
  if (hasSoftClaimAbsentFromPack(text, pack)) return false;
  if (depthOwesAFact(pack) && nuggetsUsed(text, pack) < 1) return false;
  if (nuggetsUsed(text, pack) > pack.maxNuggets) return false;

  const allowedYears = new Set(pack.allowedYears.map(String));
  for (const year of yearsIn(text)) {
    if (!allowedYears.has(year)) return false;
  }

  const allowed = packTokens(pack);
  for (const raw of text.split(/\s+/)) {
    const key = normalizeToken(raw);
    if (!key) continue;
    if (allowed.has(key) || allowed.has(key.replace(/'/g, ""))) continue;
    if (/\d/.test(key)) continue;
    if (looksLikeProperNoun(raw)) return false;
  }
  return true;
}

/**
 * Reject a New script that invents a proper noun, runs past the depth cap,
 * or names the wrong song as what's next.
 * Ordinary rephrasing is allowed. A word does not have to appear in the draft.
 */

import { formatTrackByline } from "@/lib/dj/trackSpeech";
import type { SheetClaim } from "./claims";
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
  "surprise",
  "stay", "stays", "still", "such", "take", "takes", "than", "that's", "their",
  "them", "themselves", "then", "there", "there's", "these", "they", "they're",
  "thing", "thought", "through", "time", "times", "title", "today", "together",
  "tonight", "too", "track", "true", "twice", "under", "until", "us", "very",
  "arrangement", "bold", "credited", "detail", "earns", "earned", "fair", "formed",
  "forward", "history", "holds", "lands", "lineage", "matters", "member", "members",
  "misses", "mix", "notice", "noticed", "player", "players", "producer", "promise",
  "restraint", "sharp", "story", "thin", "tight", "unearned", "upcoming", "vocal",
  "vocals", "want", "works",
  "via", "voice", "way", "we", "we're", "well", "went", "what", "when", "where",
  "which", "while", "who", "why", "will", "without", "won't", "yeah", "year",
  "yes", "yet", "you're", "your",
]);

const PROFANITY = /\b(?:fuck|fucking|shit|bitch|asshole)\b/i;

const PERSONA_STICKERS = /\b(?:listen for this|worth your ear|hold onto this)\b/i;

export function wordCeiling(pack: Pick<FactPack, "depth" | "shape" | "nuggets" | "recapLines"> & { length?: FactPack["length"] }): number {
  if (pack.shape === "song_id" || pack.shape === "stinger") return 18;
  if (pack.length?.maxWords) return pack.length.maxWords;
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
  return raw
    .replace(/[’‘]/g, "'")
    .replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, "")
    .toLowerCase();
}

function tokenAllowed(key: string, allowed: Set<string>): boolean {
  const stem = key.replace(/'s$/, "");
  return allowed.has(key) || allowed.has(stem) || allowed.has(key.replace(/'/g, ""));
}

function claimWords(claim: SheetClaim | undefined): string[] {
  if (!claim) return [];
  return [
    claim.claim,
    ...claim.names,
    ...claim.places,
    ...claim.instruments,
    ...claim.years.map(String),
    ...claim.numbers,
  ];
}

function sheetText(pack: FactPack): string[] {
  return [
    ...(pack.sheet ?? []).flatMap((claim) => claimWords(claim)),
    ...(pack.nextSheet ?? []).flatMap((claim) => claimWords(claim)),
    ...claimWords(pack.tease),
    ...claimWords(pack.payoff),
  ].filter((line) => Boolean(line));
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
    ...sheetText(pack),
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

/** Chart ranks and instrument brands are claims. Glue may not smuggle them. */
const UNSOURCED_CLAIM = [
  /\b(?:number one|no\.?\s*1|billboard|hot 100|topped the charts?|went (?:gold|platinum))\b/i,
  /\b(?:les paul|stratocaster|telecaster|marshall|moog|mellotron|rhodes|fender|gibson)\b/i,
];

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
    ...sheetText(pack),
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
  for (const pattern of UNSOURCED_CLAIM) {
    const found = lower.match(pattern);
    const claim = found?.[0]?.toLowerCase();
    if (claim && !blob.includes(claim)) return true;
  }
  return false;
}

/**
 * "Recorded at Paris", "produced by someone", or "in Seattle"
 * when that place or person is not written in the pack.
 */
function assertsFactMissingFromPack(script: string, pack: FactPack): boolean {
  const blob = packSpeechBlob(pack);
  const patterns = [
    /\b(?:recorded|cut|taped|tracked)\s+(?:at|in)\s+([^.,;!?]+)/gi,
    /\b(?:produced|engineered|mixed|written|composed|sung|played)\s+by\s+([^.,;!?]+)/gi,
    /\b(?:in|from)\s+((?:[A-Z][A-Za-z\u00C0-\u024F'’-]+)(?:\s+[A-Z][A-Za-z\u00C0-\u024F'’-]+)*)/g,
  ];
  for (const pattern of patterns) {
    for (const match of script.matchAll(pattern)) {
      const core = (match[1] ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
        .replace(/^(?:the|a|an)\s+/, "")
        .replace(/[.!?]+$/g, "");
      if (core && !blob.includes(core)) return true;
    }
  }
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
    if (tokenAllowed(key, allowed)) continue;
    return false;
  }
  return true;
}

function claimsMissingReleaseYear(script: string, pack: FactPack): boolean {
  if (pack.allowedYears.length > 0) return false;
  return /\b(?:came out|released) in\b/i.test(script);
}

const BANNED_WORDS = [
  /\bhaunting\b/i,
  /\bsoundscape\b/i,
  /\biconic\b/i,
  /\bgroundbreaking\b/i,
  /\btimeless\b/i,
  /\bjourney\b/i,
  /\bvibes\b/i,
  /\bdive into\b/i,
  /\bdive in\b/i,
  /\bstay tuned\b/i,
  /\bstick around\b/i,
];

const INSTRUMENT_SCAN = /\b(guitar|bass|drums|piano|vocals|violin|saxophone|trumpet|keyboards|keyboard|organ|percussion|cello|banjo|harmonica)\b/gi;

function craftRequired(pack: FactPack): boolean {
  if (pack.sessionOpening) return false;
  if (pack.shape === "song_id" || pack.shape === "stinger" || pack.shape === "recap" || pack.shape === "catchup") {
    return false;
  }
  if (pack.depth === "standard") return false;
  if ((pack.length?.minWords ?? 0) <= 0) return false;
  return true;
}

function sentencesOf(script: string): string[] {
  return script.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
}

function threeBeatsHold(script: string, pack: FactPack): boolean {
  if (!craftRequired(pack)) return true;
  if (/\b(?:fun fact|did you know)\b/i.test(script)) return false;
  const sentences = sentencesOf(script);
  const need = (pack.length?.minWords ?? 0) >= 75 ? 3 : 2;
  if (sentences.length < need) return false;
  const last = sentences[sentences.length - 1]?.toLowerCase() ?? "";
  const title = pack.now.title.trim().toLowerCase();
  const titleInLast = Boolean(title) && last.includes(title);
  const teaseInLast = Boolean(pack.tease) && claimCovered(last, pack.tease, pack);
  if (title && !titleInLast && !teaseInLast) return false;
  if (title && !script.toLowerCase().includes(title)) return false;
  const first = sentences[0] ?? "";
  if (/^(?:this one is|fun fact|did you know)\b/i.test(first)) return false;
  return true;
}

function personaMoveHolds(script: string, pack: FactPack): boolean {
  if (!craftRequired(pack)) return true;
  if (pack.personaId === "warm-companion") {
    const ear = /\b(?:notice|hear the|hear how|when it|comes in|opens with|listen for)\b/i.test(script);
    const people = (pack.sheet ?? []).filter((claim) => claim.topic === "members");
    const named = people.length === 0 || people.some((claim) =>
      claim.names.some((name) => name && script.toLowerCase().includes(name.toLowerCase())),
    );
    return ear && named;
  }
  if (pack.personaId === "sarcastic-critic") {
    const judgment = /\b(?:works|doesn't work|does not work|bold|earns|thin|lands|misses|holds|restraint|earned|unearned|fair|sharp)\b/i.test(script);
    const craft = /\b(?:guitar|bass|drums|piano|vocal|produced|recorded|engineered|mix|arrangement|studio)\b/i.test(script);
    return judgment && craft;
  }
  if (pack.personaId === "the-musicologist") {
    return /\b(?:recorded|produced|formed|before|after|lineage|member|credited|album|left in|in \d{4})\b/i.test(script);
  }
  return true;
}

function bannedWordSlips(script: string, pack: FactPack): boolean {
  const blob = packSpeechBlob(pack);
  for (const pattern of BANNED_WORDS) {
    const found = script.match(pattern);
    if (found && !blob.includes(found[0].toLowerCase())) return true;
  }
  return false;
}

function instrumentSlips(script: string, pack: FactPack): boolean {
  const blob = packSpeechBlob(pack);
  for (const match of script.matchAll(INSTRUMENT_SCAN)) {
    const word = match[0].toLowerCase();
    if (!blob.includes(word)) return true;
  }
  return false;
}

function numberSlips(script: string, pack: FactPack): boolean {
  const allowed = new Set<string>(pack.allowedYears.map(String));
  const claims = [...(pack.sheet ?? []), ...(pack.nextSheet ?? [])];
  for (const claim of claims) {
    for (const year of claim.years) allowed.add(String(year));
    for (const number of claim.numbers) allowed.add(number);
  }
  for (const match of `${pack.now.title} ${pack.now.artist}`.matchAll(/\d+/g)) {
    allowed.add(match[0]);
  }
  for (const match of script.matchAll(/\b(\d+)(?:st|nd|rd|th)?\b/gi)) {
    if (!allowed.has(match[1] ?? "")) return true;
  }
  const released = script.match(/\b(?:released|came out|out)\s+in\s+(\d{4})\b/i);
  if (released && ! (pack.sheet ?? []).some((claim) => claim.topic === "release" && claim.years.map(String).includes(released[1] ?? ""))) {
    return true;
  }
  const track = script.match(/\btracks?\s+(\d{1,2})\b/i);
  if (track && !(pack.sheet ?? []).some((claim) => claim.id === "release:position" && claim.numbers.includes(track[1] ?? ""))) {
    return true;
  }
  return false;
}

/** A comma clause with no name, place, year, or instrument from the sheet is model color. */
function colorClause(script: string, pack: FactPack): boolean {
  const allowed = packTokens(pack);
  for (const sentence of sentencesOf(script)) {
    for (const clause of sentence.split(/[,;]/)) {
      const keys = clause
        .split(/\s+/)
        .map(normalizeToken)
        .filter((token) => token.length > 3 && !COMMON.has(token));
      if (keys.length < 3) continue;
      const grounded = keys.some((token) => tokenAllowed(token, allowed));
      if (!grounded) return true;
    }
  }
  return false;
}

export function claimCovered(script: string, claim: SheetClaim, pack: FactPack): boolean {
  const names = new Set(`${pack.now.title} ${pack.now.artist}`.toLowerCase().split(/[^a-z0-9']+/));
  const tokens = claim.claim
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((token) => token.length > 3 && !names.has(token) && !GLUE.has(token));
  if (tokens.length === 0) return script.toLowerCase().includes(claim.claim.toLowerCase().slice(0, 12));
  const lower = script.toLowerCase();
  return tokens.some((token) => lower.includes(token));
}

function teaseHolds(script: string, pack: FactPack): boolean {
  if (!craftRequired(pack)) return true;
  if (pack.payoff && !claimCovered(script, pack.payoff, pack)) return false;
  if (pack.tease && !claimCovered(script, pack.tease, pack)) return false;
  return true;
}

/** A release year or a track number is not enough when the sheet has a real story. */
export function usesMainFact(script: string, pack: FactPack): boolean {
  const mains = pack.nuggets.filter((nugget) => nugget.topic !== "release");
  if (mains.length === 0) return true;
  const used = new Set(nuggetIdsUsedInScript(script, pack));
  return mains.some((nugget) => used.has(nugget.id));
}

function rootsStaysOnOneFact(script: string, pack: FactPack): boolean {
  if (pack.depth !== "roots_branches" || !craftRequired(pack)) return true;
  const lead = pack.nuggets.find((nugget) => nugget.topic !== "release") ?? pack.nuggets[0];
  if (!lead) return true;
  const leadBlob = `${lead.sentence} ${pack.now.title} ${pack.now.artist} ${pack.tease?.claim ?? ""} ${pack.payoff?.claim ?? ""}`.toLowerCase();
  const lower = script.toLowerCase();
  for (const claim of pack.sheet ?? []) {
    if (claim.id === lead.id) continue;
    const tokens = [...claim.names, ...claim.places, ...claim.years.map(String)]
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((token) => token.length > 3 && !leadBlob.includes(token));
    if (tokens.some((token) => lower.includes(token))) return false;
  }
  return true;
}

function inventedNames(script: string, pack: FactPack): string[] {
  const allowed = packTokens(pack);
  const found: string[] = [];
  for (const raw of script.split(/\s+/)) {
    const key = normalizeToken(raw);
    if (!key) continue;
    if (tokenAllowed(key, allowed)) continue;
    if (/\d/.test(key)) continue;
    if (!looksLikeProperNoun(raw)) continue;
    const clean = raw.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
    if (clean && !found.includes(clean)) found.push(clean);
  }
  return found;
}

export function gateRepair(script: string, pack: FactPack): string {
  const reasons: string[] = [];
  const text = script.replace(/\s+/g, " ").trim();
  if (/\b(?:fun fact|did you know)\b/i.test(text)) reasons.push('Do not say "fun fact" or "did you know".');
  if (!threeBeatsHold(text, pack)) reasons.push(`Write a hook, then the fact, then a last sentence that names "${pack.now.title}" or pays off the next-song promise.`);
  if (!personaMoveHolds(text, pack)) {
    if (pack.personaId === "warm-companion") {
      reasons.push('Include one of these phrases, tied to the fact: "listen for", "notice how", "hear how", or "when it". Do not say "listen for this".');
    } else if (pack.personaId === "sarcastic-critic") {
      reasons.push("Include one fair judgment (works, earns, thin, holds, or lands) tied to a player, an instrument, a producer, or a studio from the sheet.");
    } else if (pack.personaId === "the-musicologist") {
      reasons.push("Include the lineage: a credit, a year, or where this sits, using a fact from the sheet.");
    } else {
      reasons.push("One strong fact, then a clean handoff that names the song.");
    }
  }
  if (!usesMainFact(text, pack)) reasons.push("Use a fact that is not only the release year, album, or track number.");
  const lead = pack.nuggets.find((nugget) => nugget.topic !== "release") ?? pack.nuggets[0];
  const allowedNames = new Set(
    [...(lead?.names ?? []), ...(pack.tease?.names ?? []), ...(pack.payoff?.names ?? []), pack.now.title, pack.now.artist]
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((token) => token.length > 2),
  );
  const extras = (pack.sheet ?? [])
    .flatMap((claim) => claim.names)
    .filter((name) => {
      const token = name.toLowerCase().split(/\s+/).pop() ?? "";
      return token.length > 3 && text.toLowerCase().includes(token) && !allowedNames.has(token);
    });
  if (!rootsStaysOnOneFact(text, pack)) {
    reasons.push(`Do not mention ${[...new Set(extras)].join(", ") || "any other sheet fact"}. Teach only this: ${lead?.sentence ?? "the listed fact"}.`);
  }
  if (nuggetsUsed(text, pack) > pack.maxNuggets) {
    const lead = pack.nuggets.find((nugget) => nugget.topic !== "release") ?? pack.nuggets[0];
    reasons.push(`Too many facts. Teach only: ${lead?.sentence ?? "the listed fact"}.`);
  }
  if (pack.tease && !claimCovered(text, pack.tease, pack)) {
    reasons.push(`Close on this promise about the following song, and keep "${pack.now.title}" in the line: ${pack.tease.claim}`);
  }
  if (!upNextNamesUpcoming(text, pack)) {
    reasons.push(`Do not write "up next" unless that same sentence names "${pack.now.title}". Use "after that" for the following song.`);
  }
  if (pack.payoff && !claimCovered(text, pack.payoff, pack)) reasons.push(`Pay off this promise: ${pack.payoff.claim}`);
  if (bannedWordSlips(text, pack)) reasons.push("Drop the empty hype words.");
  if (colorClause(text, pack)) reasons.push("Drop any clause that does not name a person, place, year, or instrument from the sheet.");
  if (instrumentSlips(text, pack)) reasons.push("Name an instrument only when that instrument is written on the sheet.");
  const invented = inventedNames(text, pack);
  if (invented.length) reasons.push(`Remove these words. They are not on the sheet: ${invented.join(", ")}.`);
  if (numberSlips(text, pack)) reasons.push("A number in the line is not on the sheet. Remove it.");
  if ((pack.length?.minWords ?? 0) > 0 && wordCount(text) < (pack.length?.minWords ?? 0)) {
    reasons.push(`You wrote ${wordCount(text)} words. Write at least ${pack.length?.minWords} and at most ${pack.length?.maxWords}, using only the featured facts. Do not invent a name to fill the space.`);
  }
  if (wordCount(text) > wordCeiling(pack)) reasons.push(`Cut the line to ${wordCeiling(pack)} words or fewer.`);
  return reasons.join(" ") || "Stay inside the sheet and the three beats.";
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
  if (assertsFactMissingFromPack(text, pack)) return false;
  if (depthOwesAFact(pack) && nuggetsUsed(text, pack) < 1) return false;
  if (nuggetsUsed(text, pack) > pack.maxNuggets) return false;
  if (!usesMainFact(text, pack)) return false;
  if (!rootsStaysOnOneFact(text, pack)) return false;
  if (craftRequired(pack) && wordCount(text) < (pack.length?.minWords ?? 0)) return false;
  if (!threeBeatsHold(text, pack)) return false;
  if (!personaMoveHolds(text, pack)) return false;
  if (bannedWordSlips(text, pack)) return false;
  if (colorClause(text, pack)) return false;
  if (instrumentSlips(text, pack)) return false;
  if (numberSlips(text, pack)) return false;
  if (!teaseHolds(text, pack)) return false;

  const allowedYears = new Set(pack.allowedYears.map(String));
  for (const year of yearsIn(text)) {
    if (!allowedYears.has(year)) return false;
  }

  const allowed = packTokens(pack);
  for (const raw of text.split(/\s+/)) {
    const key = normalizeToken(raw);
    if (!key) continue;
    if (tokenAllowed(key, allowed)) continue;
    if (/\d/.test(key)) continue;
    if (looksLikeProperNoun(raw)) return false;
  }
  return true;
}

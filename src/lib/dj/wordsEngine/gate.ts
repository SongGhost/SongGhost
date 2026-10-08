/**
 * Reject a New script that invents a proper noun, runs past the depth cap,
 * or names the wrong song as what's next.
 * Ordinary rephrasing is allowed. A word does not have to appear in the draft.
 */

import { formatTrackByline, splitSentences, titleForSpeech } from "@/lib/dj/trackSpeech";
import type { SheetClaim } from "./claims";
import { ordinalAlbumOf } from "./factPack";
import { BANNED_BREAK_SKELETON, earCue, exampleBreak } from "./prompt";
import type { FactNugget, FactPack } from "./types";
import {
  cannedSongHandoff,
  hasBareFragment,
  hasStandaloneCue,
  hasStockConnector,
  listenForMisses,
  repeatsConnector,
  repeatsSentenceShape,
  restatesFact,
} from "./variety";

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
  "somewhere", "song", "songs", "soon", "sound", "sounds",   "start", "starts", "stick",
  "surprise",
  "stay", "stays", "still", "such", "take", "takes", "than", "that's", "their",
  "them", "themselves", "then", "there", "there's", "these", "they", "they're",
  "thing", "thought", "through", "time", "times", "title", "today", "together",
  "tonight", "too", "track", "true", "twice", "under", "until", "us", "very",
  "arrangement", "bold", "catch", "catalog", "credited", "detail", "earns", "earned", "enters", "fair", "formed",
  "forward", "history", "holds", "lands", "lineage", "matters", "member", "members",
  "misses", "mix", "notice", "noticed", "person", "player", "players", "point", "producer", "promise",
  "restraint", "sharp", "sits", "spot", "stands", "story", "thin", "tight", "unearned", "upcoming", "vocal",
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

function spokenTitle(pack: FactPack): string {
  return titleForSpeech(pack.now.title).trim().toLowerCase();
}

function namesUpcoming(script: string, pack: FactPack): boolean {
  if (pack.shape === "stinger" || pack.shape === "recap") return true;
  const title = spokenTitle(pack);
  if (!title) return true;
  return script.toLowerCase().includes(title);
}

function upNextNamesUpcoming(script: string, pack: FactPack): boolean {
  const upcoming = spokenTitle(pack);
  if (!upcoming) return true;
  const sentence = splitSentences(script).find((line) => /\bup next\b/i.test(line));
  if (!sentence) return true;
  return sentence.toLowerCase().includes(upcoming);
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
  "emotion",
  "themes",
  "melody",
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

/** A few words under the target is still the right length. A one-line fallback is not. */
function meetsMinLength(script: string, pack: FactPack): boolean {
  const min = pack.length?.minWords ?? 0;
  if (min <= 0) return true;
  // Director's Cut aims at 20 seconds. A clean line a few words short still airs.
  // A 13-second line does not.
  const slack = min >= 40 ? 10 : Math.min(12, Math.ceil(min * 0.2));
  return wordCount(script) >= min - slack;
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
];

/** Press-kit glue. Banned even when a real fact is in the line, and even if the sheet used the word. */
const FILLER_WORDS = [
  /\bunique\b/i,
  /\bresonat\w*\b/i,
  /\bshowcas\w*\b/i,
  /\btalents?\b/i,
  /\bdepth\b/i,
  /\bdiscography\b/i,
  /\bdynamic\b/i,
  /\bheritage\b/i,
  /\bintricate\b/i,
  /\bmulti-instrumental\b/i,
  /\bcollaborative effort\b/i,
  /\bvibe\b/i,
  /\bdistinct character\b/i,
  /\bdraws you in\b/i,
  /\bdraw you in\b/i,
  /\bsets? the tone\b/i,
  /\bpersonal experiences?\b/i,
  /\breally feel\b/i,
  /\bsets the mood\b/i,
  /\bset the mood\b/i,
  /\brich sound\b/i,
  /\bsignature sound\b/i,
  /\badds to\b/i,
  /\badding to\b/i,
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
  return splitSentences(script);
}

function threeBeatsHold(script: string, pack: FactPack): boolean {
  if (!craftRequired(pack)) return true;
  if (/\b(?:fun fact|did you know)\b/i.test(script)) return false;
  const sentences = sentencesOf(script);
  const cap = pack.depth === "directors_cut" ? 5 : 4;
  if (sentences.length > cap) return false;
  if (sentences.length < 1) return false;
  const last = sentences[sentences.length - 1] ?? "";
  if (pack.tease && !claimCovered(last, pack.tease, pack)) return false;
  if (spokenTitle(pack) && !script.toLowerCase().includes(spokenTitle(pack))) return false;
  const first = sentences[0] ?? "";
  if (/^(?:this one is|the song is|fun fact|did you know)\b/i.test(first)) return false;
  return true;
}

function personaMoveHolds(script: string, pack: FactPack): boolean {
  if (!craftRequired(pack)) return true;
  if (pack.personaId === "warm-companion") {
    if (BANNED_BREAK_SKELETON.test(script)) return false;
    const lead = pack.nuggets.find((nugget) => nugget.topic !== "release") ?? pack.nuggets[0];
    const cue = lead ? earCue(lead) : null;
    const body = sentencesOf(script).filter((sentence) => !/^\s*after that\b/i.test(sentence)).join(" ");
    if (cue) {
      if (hasStandaloneCue(script)) return false;
      const token = cue.toLowerCase().split(/\s+/)[0] ?? "";
      return token.length > 2 && body.toLowerCase().includes(token);
    }
    if (/\b(?:listen for|notice how|hear the|hear how)\b/i.test(script)) return false;
    const named = (lead?.names ?? []).some((name) => name && script.toLowerCase().includes(name.toLowerCase()));
    const story = /\b(?:story|person|people|wrote|written|formed|left|produced|recorded|guest|name)\b/i.test(script);
    return named || story;
  }
  if (pack.personaId === "sarcastic-critic") {
    const judgment = /\b(?:works|doesn't work|does not work|bold|earns|thin|lands|misses|holds|restraint|earned|unearned|fair|sharp)\b/i.test(script);
    const craft = /\b(?:guitar|bass|drums|piano|vocal|produced|recorded|engineered|mix|arrangement|studio|wrote|written|lyric|lyrics|composed)\b/i.test(script);
    return judgment && craft;
  }
  if (pack.personaId === "the-musicologist") {
    return /\b(?:recorded|produced|formed|before|after|lineage|member|credited|album|left in|in \d{4})\b/i.test(script);
  }
  return true;
}

const THIN_COLOR = /\b(?:unique|remarkable|heritage|evolution|showcas\w*|talents|prowess|versatility|intricate|distinctive|powerful)\b/i;

/**
 * Soft judgment and therapy talk. A true fact next to the line does not excuse them.
 * Allowed only when the sheet itself uses the same words.
 */
const PRESS_KIT = [
  /\bevolution\b/i,
  /\bgrowth\b/i,
  /\bmilestones?\b/i,
  /\bdistinctive\b/i,
  /\bunique sound\b/i,
  /\bdeep emotions?\b/i,
  /\bemotions\b/i,
  /\bemotional\b/i,
  /\brelat(?:e|es|ed|ing) to\b/i,
  /\bcapturing\b/i,
  /\bsets? the stage\b/i,
  /\bshap(?:e|es|ed|ing) (?:the|their|its) (?:song|sound|music)\b/i,
  /\bcollaboration shap(?:e|es|ed|ing)\b/i,
  /\bpersonal touch\b/i,
  /\bexpertise\b/i,
  /\b(?:his|her|their) style\b/i,
  /\bremarkable\b/i,
  /\bprowess\b/i,
  /\bversatility\b/i,
  /\bpowerful\b/i,
  /\bcaptivating\b/i,
  /\bincredible\b/i,
  /\b(?:his|her|their) touch\b/i,
  THIN_COLOR,
];

function sheetUses(hit: string, pack: FactPack): boolean {
  const word = hit.toLowerCase();
  const identity = `${pack.now.title} ${pack.now.artist}`.toLowerCase();
  if (identity.includes(word)) return true;
  return packSpeechBlob(pack).includes(word);
}

/** Press-kit color fails even when the line also states a real fact. */
function pressKitSlips(script: string, pack: FactPack): boolean {
  for (const pattern of PRESS_KIT) {
    const found = script.match(pattern);
    if (!found) continue;
    if (sheetUses(found[0], pack)) continue;
    return true;
  }
  return false;
}

function bannedWordSlips(script: string, pack: FactPack): boolean {
  const blob = packSpeechBlob(pack);
  for (const pattern of BANNED_WORDS) {
    const found = script.match(pattern);
    if (found && !blob.includes(found[0].toLowerCase())) return true;
  }
  return false;
}

/**
 * Press-kit words fail even when the line also states a real fact.
 * A word that is part of the upcoming title or artist is the song's name, not glue.
 */
function fillerSlips(script: string, pack: FactPack): boolean {
  const identity = `${pack.now.title} ${pack.now.artist}`.toLowerCase();
  for (const pattern of FILLER_WORDS) {
    const found = script.match(pattern);
    if (!found) continue;
    if (identity.includes(found[0].toLowerCase())) continue;
    return true;
  }
  return false;
}

const CREDIT_VERB = /\b(?:plays|played|sings|sang|produced|engineered|is credited|credited on|guest appearance|featuring)\b/i;

/**
 * Three instruments, producers, or guests in a row.
 * One player is a fact. A credit roll is not.
 */
export function isCreditRoll(script: string): boolean {
  const sentences = sentencesOf(script);
  let creditRun = 0;
  for (const sentence of sentences) {
    const instruments = new Set(
      [...sentence.matchAll(INSTRUMENT_SCAN)].map((match) => {
        const word = match[0].toLowerCase();
        return word === "keyboard" ? "keyboards" : word;
      }),
    );
    if (instruments.size >= 3) return true;
    if (CREDIT_VERB.test(sentence)) {
      creditRun += 1;
      if (creditRun >= 3) return true;
    } else {
      creditRun = 0;
    }
    const stripped = sentence.replace(/^\s*(?:after that|up next|here comes|here is|and then)[:,]?\s*/i, "");
    const listed = stripped
      .split(/\s*,\s*|\s+\band\b\s+/i)
      .map((part) => part.trim())
      .filter((part) => /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/.test(part));
    if (listed.length >= 3 && /\b(?:produced|guest|featuring|credited|plays|with)\b/i.test(sentence)) {
      return true;
    }
  }
  return false;
}

/**
 * "Credited on" and "is a guest" stay those words.
 * Plays, sings, and "lends a voice" are allowed only when the sheet says them.
 */
function sheetVerbUpgrade(script: string, pack: FactPack): string | null {
  const blob = packSpeechBlob(pack);
  const voiceUpgrade = /\b(?:lends|blends) (?:his|her|their) voice\b/i;
  if (voiceUpgrade.test(script) && !voiceUpgrade.test(blob)) return 'Do not say "lends a voice".';
  if (/\blyricist\b/i.test(script) && !/\blyricist\b/i.test(blob)) return "Do not say lyricist unless the sheet says lyricist.";
  if (/\bfeatured\b/i.test(script) && !/\bfeatured\b/i.test(blob)) return "Do not say featured unless the sheet says featured.";
  if (/\b(?:sings|sang)\b/i.test(script) && !/\b(?:sings|sang|vocal|vocals)\b/i.test(blob)) return "Do not say sings unless the sheet names a vocal.";
  if (/\bplays\b/i.test(script) && !/\bplays\b/i.test(blob) && !/\bcredited\b/i.test(blob)) {
    return "Do not say plays unless the sheet says plays or credits that instrument.";
  }
  const lower = script.toLowerCase();
  for (const nugget of pack.nuggets) {
    if (nugget.topic === "release") continue;
    const sentence = nugget.sentence;
    if (/\bis a guest\b/i.test(sentence) && !/\bguest\b/i.test(lower)) return "Keep the sheet word: guest.";
    if (/\bis credited on\b/i.test(sentence) && voiceUpgrade.test(lower)) return 'Do not say "lends a voice". Say who plays it.';
    if (/\bproduced\b/i.test(sentence) && !/\bproduced\b/i.test(lower)) return "Use the sheet verb: produced.";
    if (/\bformed in\b/i.test(sentence) && !/\bformed\b/i.test(lower)) return "Use the sheet verb: formed.";
    if (/\brecorded at\b/i.test(sentence) && !/\brecorded\b/i.test(lower)) return "Use the sheet verb: recorded.";
    if (/\b(?:wrote|written)\b/i.test(sentence) && !/\b(?:wrote|written|lyric)\b/i.test(lower)) return "Use the sheet verb: wrote.";
  }
  return null;
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
  // Track number stays on the sheet as support. It is not a spoken fact.
  if (/\btracks?\s+\d{1,2}\b/i.test(script)) return true;
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

function staysOnFeaturedFacts(script: string, pack: FactPack): boolean {
  if (!craftRequired(pack)) return true;
  const featured = pack.nuggets.filter((nugget) => nugget.topic !== "release");
  const teach = featured.length ? featured : pack.nuggets;
  if (teach.length === 0) return true;
  const allowed = `${teach.map((nugget) => `${nugget.sentence} ${(nugget.names ?? []).join(" ")}`).join(" ")} ${pack.now.title} ${pack.now.artist} ${pack.tease?.claim ?? ""} ${(pack.tease?.names ?? []).join(" ")} ${pack.payoff?.claim ?? ""}`.toLowerCase();
  const lower = script.toLowerCase();
  for (const claim of pack.sheet ?? []) {
    if (teach.some((nugget) => nugget.id === claim.id)) continue;
    const tokens = [...claim.names, ...claim.places, ...claim.years.map(String)]
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((token) => token.length > 3 && !allowed.includes(token));
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

const ORDINAL_WORD = "first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth";

/** "The number of the album is eighth." / "This is album number ninth." */
export function brokenOrdinal(script: string): boolean {
  return /\b(?:the )?number of the album is\b/i.test(script)
    || /\balbum number\b/i.test(script)
    || /\b(?:this|that) is album number\b/i.test(script);
}

function albumTitles(claims: readonly SheetClaim[]): string[] {
  const titles: string[] = [];
  for (const claim of claims) {
    const named = ordinalAlbumOf(claim.claim);
    if (named) titles.push(named);
    const on = claim.claim.match(/\bis on\s+([^.!?]+)/i);
    if (on?.[1] && (claim.id === "release:album" || claim.topic === "release")) titles.push(on[1].trim());
  }
  return titles;
}

/**
 * "Find is the eighth studio album" when the sheet's title is
 * "I Am Easy to Find". A spoken album name has to be the full title.
 */
export function albumTitleMismatch(script: string, pack: FactPack): boolean {
  const titles = [
    ...(pack.now.album ? [pack.now.album] : []),
    ...albumTitles(pack.sheet ?? []),
    ...albumTitles(pack.nextSheet ?? []),
  ];
  if (titles.length === 0) return false;
  const known = new Set(titles.map((title) => title.toLowerCase()));
  const patterns = [
    new RegExp(`\\b([A-Z][^.]{0,80}?) is the (?:band's |their )?(?:${ORDINAL_WORD}) studio album\\b`, "g"),
    new RegExp(`\\btheir (?:${ORDINAL_WORD}) studio album is ([^.!?]+)`, "gi"),
  ];
  for (const pattern of patterns) {
    for (const match of script.matchAll(pattern)) {
      const spoken = (match[1] ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[,;].*$/, "")
        .replace(/\s+\b(?:which|where|and that)\b.*$/i, "")
        .replace(/\s+with\s+.+$/i, "")
        .replace(/\s+by\s+.+$/i, "")
        .replace(/[.!?]+$/g, "")
        .trim();
      if (!spoken) continue;
      if (!known.has(spoken.toLowerCase())) return true;
    }
  }
  return false;
}

const LABEL_PRAISE = /\b(?:recognized for|known for its|influential roster|acclaimed)\b/i;

/** Two credits in a row with nothing joining them. A promised payoff and the next-song hook are not a stack. */
export function stackedFacts(script: string, pack?: FactPack): boolean {
  let body = script.replace(/\bstick around\b[^.!?]*[.!?]?/gi, " ");
  const payoff = pack?.payoff?.claim?.trim();
  if (payoff) body = body.replace(payoff, " ");
  const sentences = sentencesOf(body).filter((sentence) =>
    /\b(?:is a guest|is the label|plays|produced|came out on|is credited|studio album)\b/i.test(sentence),
  );
  if (sentences.length < 2) return false;
  return !/\b(?:same|who|also|while|where|because)\b/i.test(sentences.join(" "));
}

function teaseClause(script: string): string {
  return script.match(/\b(?:stick around|after that)\b[^.!?]*/i)?.[0] ?? "";
}

/**
 * A tease may use the next song's sheet only.
 * "After that, <fact>" is not a tease.
 */
export function teaseFactForeign(script: string, pack: FactPack): boolean {
  const clause = teaseClause(script);
  if (!clause) return false;
  if (/\bafter that\b/i.test(clause)) return true;
  const nextBlob = [
    ...(pack.nextSheet ?? []).flatMap((claim) => [claim.claim, ...claim.names, ...claim.places]),
    pack.tease?.claim ?? "",
    ...(pack.tease?.names ?? []),
    ...(pack.tease?.places ?? []),
  ].join(" ").toLowerCase();
  if (!nextBlob.trim()) return /\b(?:guest|album|produced|recorded|plays)\b/i.test(clause);
  for (const raw of clause.split(/\s+/)) {
    if (!looksLikeProperNoun(raw)) continue;
    const key = normalizeToken(raw);
    if (!key || key.length < 3 || COMMON.has(key)) continue;
    if (spokenTitle(pack).includes(key) || pack.now.artist.toLowerCase().includes(key)) continue;
    if (!nextBlob.includes(key)) return true;
  }
  return false;
}

export function gateRepair(script: string, pack: FactPack): string {
  const reasons: string[] = [];
  const text = script.replace(/\s+/g, " ").trim();
  if (/\b(?:fun fact|did you know)\b/i.test(text)) reasons.push('Do not say "fun fact" or "did you know".');
  if (BANNED_BREAK_SKELETON.test(text)) {
    reasons.push('Do not say "when the song opens", "so listen for", or "because that is the part to hear".');
  }
  if (!threeBeatsHold(text, pack)) reasons.push(`Write a hook, then the fact, then a last sentence that names "${pack.now.title}" or pays off the next-song promise.`);
  if (!personaMoveHolds(text, pack)) {
    if (pack.personaId === "warm-companion") {
      const lead = pack.nuggets.find((nugget) => nugget.topic !== "release") ?? pack.nuggets[0];
      const cue = lead ? earCue(lead) : null;
      reasons.push(cue
        ? `Weave ${cue} into the fact sentence. Do not write a separate "Hear the" or "Listen for" sentence.`
        : 'This fact is not a sound. Say the person or the story. Do not invent a listen-for.');
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
  if (!staysOnFeaturedFacts(text, pack)) {
    reasons.push(`Do not mention ${[...new Set(extras)].join(", ") || "any other sheet fact"}. Teach only this: ${lead?.sentence ?? "the listed fact"}.`);
  }
  if (nuggetsUsed(text, pack) > pack.maxNuggets) {
    const lead = pack.nuggets.find((nugget) => nugget.topic !== "release") ?? pack.nuggets[0];
    reasons.push(`Too many facts. Teach only: ${lead?.sentence ?? "the listed fact"}.`);
  }
  if (brokenOrdinal(text)) reasons.push("Say the ordinal as a word inside a normal sentence, with the full album title. Do not say album number.");
  if (albumTitleMismatch(text, pack)) reasons.push("Use the full album title from the sheet. Do not shorten it to the last word.");
  if (LABEL_PRAISE.test(text)) reasons.push('Do not praise a label. Do not say "recognized for", "known for its", "influential roster", or "acclaimed".');
  if (stackedFacts(text, pack)) reasons.push("Two facts have to be the same person or the same place. Connect them, or say only one.");
  if (teaseFactForeign(text, pack)) reasons.push(pack.tease ? `The last sentence has to be this hook about the next song only: ${pack.tease.claim}` : "Do not tease a fact that is not on the next song.");
  if (pack.tease && !claimCovered(text, pack.tease, pack)) {
    reasons.push(`Close on this hook about the following song, and keep "${titleForSpeech(pack.now.title)}" in the line: ${pack.tease.claim}`);
  }
  if (pack.payoff && restatesFact(text, pack.payoff)) {
    reasons.push(`Do not say this again. The previous break already told it: ${pack.payoff.claim} Teach the new fact.`);
  }
  if (hasStockConnector(text)) {
    reasons.push('Do not say "That\'s the part worth knowing", "That\'s the record this song is on", "That\'s where they got started", or "which is where you\'ll find this track".');
  }
  if (hasBareFragment(text, pack)) {
    reasons.push("Do not make a sentence that is only the artist, only the title, or only Title by Artist.");
  }
  if (listenForMisses(text, pack)) {
    reasons.push("Listen for is only a sound on this sheet: an instrument, a voice, or part of the arrangement. Do not listen for a place, a studio, a label, a year, an album, or the word instrument.");
  }
  if (repeatsConnector(text, pack)) {
    reasons.push("That connector was already used on this station. Say the fact in a new sentence.");
  }
  if (cannedSongHandoff(text)) {
    reasons.push('Do not write "The song is" and then the title "from" the artist. End on the fact, or name the song a different way.');
  }
  if (hasStandaloneCue(text)) {
    reasons.push('Do not write "Hear the" or "Listen for" as its own sentence. Weave the cue into the fact.');
  }
  if (/\bis credited on\b/i.test(text)) {
    reasons.push('Do not say "is credited on". Say who plays it, in a normal sentence.');
  }
  if (repeatsSentenceShape(text, pack)) {
    reasons.push("That sentence shape was already used on this station. Say this fact in a different shape.");
  }
  if (!upNextNamesUpcoming(text, pack)) {
    reasons.push(`Do not write "up next" unless that same sentence names "${titleForSpeech(pack.now.title)}".`);
  }
  if (bannedWordSlips(text, pack) || fillerSlips(text, pack) || pressKitSlips(text, pack)) {
    const sample = exampleBreak(pack);
    if (sample) {
      return `Output this script and nothing else. Do not add a word: ${sample}`;
    }
    reasons.push("Drop the press-kit line. Do not say evolution, growth, milestone, distinctive, unique sound, deep emotions, relate to, capturing, set the stage, shapes the song, collaboration shapes, unique, resonates, showcasing, talents, depth, or journey. Name the guest, studio, lyric credit, album number, label, or producer already on the sheet.");
  }
  if (isCreditRoll(text)) reasons.push("Do not list three instruments, producers, or guests. Choose one.");
  const verbProblem = sheetVerbUpgrade(text, pack);
  if (verbProblem) reasons.push(verbProblem);
  if (instrumentSlips(text, pack)) reasons.push("Name an instrument only when that instrument is written on the sheet.");
  const invented = inventedNames(text, pack);
  if (invented.length) reasons.push(`Remove these words. They are not on the sheet: ${invented.join(", ")}.`);
  if (numberSlips(text, pack)) reasons.push("A number in the line is not on the sheet. Remove it.");
  if (!meetsMinLength(text, pack)) {
    reasons.push(`You wrote ${wordCount(text)} words. Write at least ${pack.length?.minWords} and at most ${pack.length?.maxWords}. Say the featured fact in plain speech. Do not add a mood, a label, a compliment, or "because that is the part to hear".`);
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
  if (BANNED_BREAK_SKELETON.test(text)) return false;
  if (!namesUpcoming(text, pack)) return false;
  if (!namesUpcomingArtist(text, pack)) return false;
  if (!upNextNamesUpcoming(text, pack)) return false;
  if (isMoodColorWithoutFact(text, pack)) return false;
  if (hasSoftClaimAbsentFromPack(text, pack)) return false;
  if (assertsFactMissingFromPack(text, pack)) return false;
  if (depthOwesAFact(pack) && nuggetsUsed(text, pack) < 1) return false;
  if (nuggetsUsed(text, pack) > pack.maxNuggets) return false;
  if (!usesMainFact(text, pack)) return false;
  if (!staysOnFeaturedFacts(text, pack)) return false;
  if (craftRequired(pack) && !meetsMinLength(text, pack)) return false;
  if (!threeBeatsHold(text, pack)) return false;
  if (!personaMoveHolds(text, pack)) return false;
  if (bannedWordSlips(text, pack)) return false;
  if (fillerSlips(text, pack)) return false;
  if (pressKitSlips(text, pack)) return false;
  if (LABEL_PRAISE.test(text)) return false;
  if (brokenOrdinal(text)) return false;
  if (albumTitleMismatch(text, pack)) return false;
  if (stackedFacts(text, pack)) return false;
  if (teaseFactForeign(text, pack)) return false;
  if (isCreditRoll(text)) return false;
  if (sheetVerbUpgrade(text, pack)) return false;
  if (instrumentSlips(text, pack)) return false;
  if (numberSlips(text, pack)) return false;
  if (!teaseHolds(text, pack)) return false;
  if (hasStockConnector(text)) return false;
  if (hasBareFragment(text, pack)) return false;
  if (listenForMisses(text, pack)) return false;
  if (repeatsConnector(text, pack)) return false;
  if (cannedSongHandoff(text)) return false;
  if (hasStandaloneCue(text)) return false;
  if (/\bis credited on\b/i.test(text)) return false;
  if (repeatsSentenceShape(text, pack)) return false;
  if (pack.payoff && restatesFact(text, pack.payoff)) return false;

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

/**
 * One short claim, in our words, with the names and the source attached.
 * Wikipedia paragraphs are mined for a fact and then thrown away.
 */

import { splitSentences } from "@/lib/dj/trackSpeech";

export type FactTopic =
  | "members"
  | "origin"
  | "album_story"
  | "song_story"
  | "band_said"
  | "connections"
  | "reception"
  | "release";

export type FactConfidence = "high" | "medium" | "low";

export type SheetClaim = {
  id: string;
  claim: string;
  topic: FactTopic;
  names: string[];
  places: string[];
  years: number[];
  numbers: string[];
  instruments: string[];
  sourceName: string;
  sourceUrl: string;
  confidence: FactConfidence;
};

export const INSTRUMENT_WORDS = [
  "guitar",
  "bass",
  "drums",
  "drum",
  "piano",
  "vocal",
  "vocals",
  "voice",
  "violin",
  "fiddle",
  "saxophone",
  "sax",
  "trumpet",
  "keyboard",
  "keyboards",
  "synth",
  "synthesizer",
  "organ",
  "percussion",
  "cello",
  "banjo",
  "harmonica",
  "flute",
  "trombone",
  "clarinet",
  "ukulele",
  "viola",
  "harp",
  "accordion",
  "tambourine",
  "mellotron",
  "rhodes",
] as const;

const SENSITIVE = /\b(?:died|dies|death|suicide|overdose|addict(?:ed|ion)?|heroin|cocaine|abuse[ds]?|assault(?:ed)?|murder(?:ed)?|killed|funeral|rehab)\b/i;

const TOPIC_RANK: Record<FactTopic, number> = {
  song_story: 0,
  album_story: 1,
  band_said: 2,
  connections: 3,
  reception: 4,
  members: 6,
  origin: 7,
  release: 8,
};

export function topicRank(topic: FactTopic | undefined): number {
  if (!topic) return 9;
  return TOPIC_RANK[topic];
}

export function isReleaseTopic(topic: FactTopic | undefined): boolean {
  return topic === "release";
}

export function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "fact";
}

export function finishClaim(text: string): string {
  const sentence = text.replace(/\s+/g, " ").trim();
  if (!sentence) return "";
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

export function isSensitiveText(text: string): boolean {
  return SENSITIVE.test(text);
}

export function instrumentWords(role: string): string[] {
  const lower = role.toLowerCase();
  const found: string[] = [];
  for (const word of INSTRUMENT_WORDS) {
    const pattern = new RegExp(`\\b${word}\\b`, "i");
    if (!pattern.test(lower)) continue;
    const canonical = word === "vocal" || word === "voice" || word === "vocals"
      ? "vocals"
      : word === "drum"
        ? "drums"
        : word === "keyboard" || word === "keyboards"
          ? "keyboards"
          : word === "sax"
            ? "saxophone"
            : word;
    if (!found.includes(canonical)) found.push(canonical);
  }
  return found;
}

export function makeClaim(input: {
  id: string;
  claim: string;
  topic: FactTopic;
  names?: string[];
  places?: string[];
  years?: number[];
  numbers?: string[];
  instruments?: string[];
  sourceName: string;
  sourceUrl: string;
  confidence: FactConfidence;
}): SheetClaim | null {
  const claim = finishClaim(input.claim);
  if (!claim || isSensitiveText(claim)) return null;
  const years = [...new Set((input.years ?? []).filter((year) => year >= 1900 && year <= 2035))];
  return {
    id: input.id,
    claim,
    topic: input.topic,
    names: uniqueText(input.names ?? []),
    places: uniqueText(input.places ?? []),
    years,
    numbers: uniqueText(input.numbers ?? years.map(String)),
    instruments: uniqueText(input.instruments ?? []),
    sourceName: input.sourceName,
    sourceUrl: input.sourceUrl,
    confidence: input.confidence,
  };
}

function uniqueText(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const clean = value.replace(/\s+/g, " ").trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** A member line in our words. A departure is spoken only with a year. */
export function memberClaim(input: {
  name: string;
  instruments: readonly string[];
  beginYear?: number;
  endYear?: number;
  formedYear?: number;
  sourceName: string;
  sourceUrl: string;
  confidence?: FactConfidence;
}): SheetClaim | null {
  const name = input.name.replace(/\s+/g, " ").trim();
  if (!name || isSensitiveText(name)) return null;
  const instruments = uniqueText(input.instruments.flatMap((role) => instrumentWords(role).length ? instrumentWords(role) : []));
  const rawInstruments = uniqueText(input.instruments);
  const played = instruments.length ? instruments : rawInstruments.filter((role) => !/^(?:original|guest|additional|solo|founder)$/i.test(role));
  const sings = played.length > 0 && played.every((role) => role === "vocals");
  const playList = played.filter((role) => role !== "vocals");
  let sentence = "";
  if (input.endYear) {
    const founding = typeof input.beginYear === "number"
      && typeof input.formedYear === "number"
      && input.beginYear <= input.formedYear + 1;
    const role = sings
      ? `${name} sang`
      : playList.length
        ? `${name} played ${listWords(playList)}`
        : name;
    sentence = founding
      ? `${role}, founding member, left in ${input.endYear}`
      : `${role} and left in ${input.endYear}`;
    if (!sings && playList.length === 0) {
      sentence = founding
        ? `${name}, founding member, left in ${input.endYear}`
        : `${name} left in ${input.endYear}`;
    }
  } else if (sings) {
    sentence = `${name} sings`;
  } else if (playList.length) {
    sentence = `${name} plays ${listWords(playList)}`;
  } else {
    return null;
  }
  return makeClaim({
    id: `members:${slug(name)}:${slug(sentence)}`,
    claim: sentence,
    topic: "members",
    names: [name],
    years: [input.beginYear, input.endYear].filter((year): year is number => typeof year === "number"),
    instruments: played,
    sourceName: input.sourceName,
    sourceUrl: input.sourceUrl,
    confidence: input.confidence ?? "high",
  });
}

export function originClaim(input: {
  subject: string;
  place?: string;
  year?: number;
  sourceName: string;
  sourceUrl: string;
  confidence?: FactConfidence;
}): SheetClaim | null {
  const subject = input.subject.replace(/\s+/g, " ").trim();
  const place = input.place?.replace(/\s+/g, " ").trim();
  if (!subject) return null;
  if (!place && !input.year) return null;
  const sentence = place && input.year
    ? `${subject} formed in ${place} in ${input.year}`
    : place
      ? `${subject} formed in ${place}`
      : `${subject} started in ${input.year}`;
  return makeClaim({
    id: `origin:${slug(subject)}:${slug(place ?? "")}:${input.year ?? "na"}`,
    claim: sentence,
    topic: "origin",
    names: [subject],
    places: place ? [place] : [],
    years: input.year ? [input.year] : [],
    sourceName: input.sourceName,
    sourceUrl: input.sourceUrl,
    confidence: input.confidence ?? "high",
  });
}

const NOT_A_PLACE = /^(?:american|british|canadian|english|irish|australian|scottish|welsh)$/i;

export function hometownClaim(input: {
  name: string;
  place: string;
  sourceName: string;
  sourceUrl: string;
}): SheetClaim | null {
  const name = input.name.replace(/\s+/g, " ").trim().replace(/[.!?]+$/g, "");
  const place = input.place.replace(/\s+/g, " ").trim().replace(/[.!?]+$/g, "");
  if (!name || !place || NOT_A_PLACE.test(place) || isSensitiveText(place)) return null;
  return makeClaim({
    id: `origin:${slug(name)}:${slug(place)}`,
    claim: `${name} is from ${place}`,
    topic: "origin",
    names: [name],
    places: [place],
    sourceName: input.sourceName,
    sourceUrl: input.sourceUrl,
    confidence: "high",
  });
}

/**
 * Eight words in a row from the source means we copied the passage.
 * A short claim we wrote ourselves does not trip this.
 */
export function copiesSource(claim: string, source: string, subject = ""): boolean {
  const words = claim.toLowerCase().replace(/[^a-z0-9'\s]/g, " ").split(/\s+/).filter(Boolean);
  const src = source.toLowerCase().replace(/[^a-z0-9'\s]/g, " ");
  const subjectNorm = subject.toLowerCase().replace(/[^a-z0-9'\s]/g, " ").replace(/\s+/g, " ").trim();
  if (words.length < 8) return false;
  for (let i = 0; i <= words.length - 8; i += 1) {
    const gram = words.slice(i, i + 8).join(" ");
    if (subjectNorm.includes(gram)) continue;
    if (src.includes(gram)) return true;
  }
  return false;
}

function sentencesOf(text: string): string[] {
  return splitSentences(text);
}

function pushUnique(list: SheetClaim[], claim: SheetClaim | null, sourceSentence: string, subject = "") {
  if (!claim) return;
  let next = claim;
  if (copiesSource(next.claim, sourceSentence, subject)) {
    const rewritten = subject
      ? finishClaim(next.claim.replaceAll(subject, "this record"))
      : "";
    if (!rewritten || copiesSource(rewritten, sourceSentence)) return;
    next = { ...next, claim: rewritten };
  }
  if (list.some((row) => row.id === next.id)) return;
  list.push(next);
}

function personName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function peopleList(raw: string): string[] {
  return raw
    .replace(/\s+and\s+/gi, ", ")
    .split(",")
    .map((part) => personName(part))
    .filter((name) => /^[A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){0,3}$/.test(name));
}

function mentionsArtist(sentence: string, artist: string | undefined): boolean {
  if (!artist?.trim()) return true;
  const blob = sentence.toLowerCase();
  const full = artist.trim().toLowerCase();
  if (blob.includes(full)) return true;
  const last = full.split(/\s+/).filter((word) => word.length > 2).at(-1);
  return Boolean(last && blob.includes(last));
}

function wikiClaim(input: {
  id: string;
  claim: string;
  topic: FactTopic;
  names?: string[];
  places?: string[];
  years?: number[];
  numbers?: string[];
  sourceUrl: string;
}): SheetClaim | null {
  return makeClaim({
    ...input,
    sourceName: "Wikipedia",
    confidence: "medium",
  });
}

const ROLE_PREFIX = "(?:American|British|English|Canadian|Australian|Irish|Scottish|Welsh|French|German|Swedish|Norwegian|Danish|Japanese|Korean|Mexican|Brazilian|Spanish|Italian|singer-songwriter|singer|songwriter|musician|producer|guitarist|drummer|bassist|pianist|composer|lyricist|rapper|band)";

const PARTIAL_OBJECT = "(?:intro|introduction|arrangement|arrangements|orchestration|coda|outro|interlude|overture)";

/** A language name is not a studio. "Recorded in English" is not "English studio". */
const LANGUAGE_PLACE = /^(?:english|spanish|french|german|korean|japanese|portuguese|italian|instrumental|latin)$/i;

function stripLeadingRoles(raw: string): string {
  return raw.replace(new RegExp(`^(?:${ROLE_PREFIX}\\s+)+`, "i"), "").trim();
}

/** Stop a credit list before the next clause ("with", "at", "during"). */
function creditHead(raw: string): string {
  const cut = raw.split(/\b(?:with|who|during|while|after|before|for the|as the|as a| at | on the| from the)\b/i)[0] ?? raw;
  return stripLeadingRoles(cut).replace(/[,;]+$/g, "").replace(/\.+$/g, "").trim();
}

function creditNames(raw: string): string[] {
  const head = creditHead(raw);
  if (!head) return [];
  if (/\b(?:all|both|every|members|everyone|the band|the group)\b/i.test(head)) return [];
  return peopleList(head);
}

function creditGroup(raw: string): string {
  const head = creditHead(raw);
  if (!head || creditNames(raw).length > 0) return "";
  if (!/\b(?:all|both|every|members|everyone|the band|the group)\b/i.test(head)) return "";
  return head.replace(/\s+/g, " ");
}

function tidyChartName(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:the|a|an)\s+/i, "")
    .replace(/\s+\b(?:for|during|after|before|where|which|that)\b.*$/i, "")
    .replace(/[,:;]+$/g, "")
    .trim();
}

/**
 * A chart position without the chart name is not spoken.
 * "Reached number 22" does not say which chart.
 */
function chartSentence(sentence: string, subject: string): string {
  const topped = sentence.match(/\btopped the\s+([^,.]{3,60})/i);
  if (topped?.[1]) {
    const chart = tidyChartName(topped[1]);
    if (chart) return `${subject} — number 1 on the ${chart}`;
  }
  const hit = sentence.match(/\b(?:peaked|reached|reaching|hit)\s+(?:at\s+)?(?:number|no\.?|#)\s*(\d{1,3})\b([^.]*)/i);
  if (!hit?.[1]) return "";
  const on = (hit[2] ?? "").match(/\b(?:on|in)\s+(?:the\s+)?([^,.]{3,60})/i);
  const chart = on?.[1] ? tidyChartName(on[1]) : "";
  if (!chart || LANGUAGE_PLACE.test(chart)) return "";
  return `${subject} — number ${hit[1]} on the ${chart}`;
}

function recordingPlace(sentence: string): { place: string; how: "recorded" | "produced" } | null {
  const recorded = sentence.match(/\b(?:sessions|recorded|cut)\s+(?:at|in)\s+([^,.]{2,80})/i);
  const atStudio = sentence.match(/\bat\s+([A-Z0-9][^,.]{1,70}?\s+studios?(?:\s+[A-Z0-9][^,.]{0,40})?)/);
  const raw = (recorded?.[1] ?? atStudio?.[1] ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  let place = raw.split(/\s+\b(?:before|during|after|where|which|that|and features|and was)\b/i)[0]?.trim() ?? raw;
  place = place.replace(/[,:;]+$/g, "").trim();
  if (!place || LANGUAGE_PLACE.test(place)) return null;
  if (/^english\s+studios?$/i.test(place)) return null;
  const how = /\b(?:recorded|sessions|cut)\b/i.test(sentence) ? "recorded" : "produced";
  return { place, how };
}

function mediaUse(sentence: string, subject: string): string {
  const match = sentence.match(/\b(?:featured in|used in|appeared in)\s+(?:the\s+)?(?:\d{4}\s+)?(film|movie|television series|tv series|series|show)\s+([^.]{2,80})/i);
  if (!match?.[1] || !match[2]) return "";
  const word = match[1].toLowerCase();
  const medium = word === "movie" ? "film"
    : word === "television series" || word === "tv series" ? "TV series"
    : word;
  const title = (match[2].split(/\s+\band\b|\s+\bon\b/i)[0] ?? "").trim().replace(/[,:;]+$/g, "").replace(/\s+/g, " ");
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 6 || /\b(?:the|of|a|an|on|in|and)$/i.test(title)) return "";
  if (!/^[A-Z0-9]/.test(title) || isSensitiveText(title)) return "";
  return `${subject} was used in the ${medium} ${title}`;
}

function writingClauses(sentence: string): string[] {
  return sentence
    .split(/\s*;\s*|\s+and\s+(?=(?:[A-Z][A-Za-z.'’\-]+\s+){1,3}(?:wrote|composed|co-wrote|co-written)\b)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Writing credits stay the role the sentence actually gives.
 * "Wrote the intro" is not "wrote the song". "Based on material composed by"
 * is not "composed the song". A lyricist is not the sole writer.
 * Several names in one credit stay in one claim.
 */
function writingClaims(sentence: string, subject: string, kind: "band" | "album" | "song", sourceUrl: string): SheetClaim[] {
  const out: SheetClaim[] = [];
  const topic: FactTopic = kind === "band" ? "connections" : "song_story";
  const add = (id: string, claim: string, names: string[]) => {
    const spoken = wikiClaim({ id, claim, topic, names: [...names, subject], sourceUrl });
    if (spoken) out.push(spoken);
  };
  const joined = (names: string[]) => listWords(names);

  for (const clause of writingClauses(sentence)) {
    const basedOn = /\b(?:based on|adapted from|derived from)\b/i.test(clause);
    const partial = clause.match(new RegExp(`\\b([A-Z][A-Za-z.'’\\-]+(?:\\s+[A-Z][A-Za-z.'’\\-]+){0,3})\\s+wrote\\s+(the\\s+${PARTIAL_OBJECT})\\b`, "i"));
    if (partial?.[1] && partial[2]) {
      const who = partial[1].trim().replace(/\.+$/g, "");
      add(`song_story:wrote-part:${slug(who)}:${slug(partial[2])}`, `${who} wrote the ${partial[2].replace(/^the\s+/i, "")} of ${subject}`, [who]);
      continue;
    }

    const lyricsWere = clause.match(/\blyrics?\s+(?:were|was)\s+written\s+by\s+(.+?)(?:\.|$)/i);
    const lyricsBy = clause.match(/\blyrics?\s+by\s+(.+?)(?:\.|$)/i);
    const wroteLyrics = clause.match(/\b((?:[A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){0,3})(?:\s+and\s+[A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){0,3})*)\s+wrote\s+the\s+lyrics\b/);
    const lyricist = clause.match(/\b([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){0,2})\s+(?:as\s+)?(?:the\s+)?lyricist\b/);
    const lyricBlob = lyricsWere?.[1] ?? lyricsBy?.[1] ?? "";
    const lyricNames = lyricBlob ? creditNames(lyricBlob) : wroteLyrics?.[1] ? creditNames(wroteLyrics[1]) : [];
    if (lyricist?.[1] && !lyricNames.some((name) => name.toLowerCase() === lyricist[1].trim().toLowerCase())) {
      lyricNames.push(lyricist[1].trim());
    }
    if (lyricNames.length) {
      add(`song_story:lyrics:${slug(joined(lyricNames))}`, `${joined(lyricNames)} wrote the lyrics for ${subject}`, lyricNames);
    }

    const wroteMusic = clause.match(/\b((?:[A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){0,3})(?:\s+and\s+[A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){0,3})*)\s+wrote\s+the\s+music\b/);
    if (wroteMusic?.[1]) {
      const names = creditNames(wroteMusic[1]);
      if (names.length) {
        add(`song_story:music:${slug(joined(names))}`, `${joined(names)} wrote the music for ${subject}`, names);
      }
    }

    const composedBy = clause.match(/\bcomposed\s+by\s+(.+?)(?=,?\s+with\s+lyrics|,?\s+lyrics\b|\.|$)/i);
    if (composedBy?.[1] && !lyricsWere) {
      const names = creditNames(composedBy[1]);
      const group = creditGroup(composedBy[1]);
      if (basedOn && (names.length || group)) {
        const who = names.length ? joined(names) : group;
        add(`song_story:based-on:${slug(who)}`, `${subject}, based on material composed by ${who}`, names);
      } else if (names.length) {
        add(`song_story:composed:${slug(joined(names))}`, `${joined(names)} composed ${subject}`, names);
      }
    }

    const cowrote = clause.match(/\bco-written\s+by\s+(.+?)(?:\.|$)/i);
    if (cowrote?.[1]) {
      const names = creditNames(cowrote[1]);
      if (names.length) {
        const lyrics = /\blyrics?\b/i.test(clause) && !composedBy;
        add(
          `song_story:cowrote:${slug(joined(names))}`,
          lyrics ? `${joined(names)} co-wrote the lyrics for ${subject}` : `${joined(names)} co-wrote ${subject}`,
          names,
        );
      }
    }

    const writtenBy = lyricsWere ? null : clause.match(/\bwritten\s+by\s+(.+?)(?:\.|$)/i);
    if (writtenBy?.[1] && !/\blyrics?\s+(?:were|was)\s+written\b/i.test(clause)) {
      const names = creditNames(writtenBy[1]);
      const group = creditGroup(writtenBy[1]);
      if (group) {
        const line = /\ball five members\b/i.test(group)
          ? `All five members wrote ${subject}`
          : `Written by ${group}`;
        add(`song_story:written-by:${slug(group)}`, line, []);
      } else if (names.length && !lyricNames.length) {
        const lyrics = /\blyrics?\b/i.test(clause);
        add(
          `song_story:wrote:${slug(joined(names))}`,
          lyrics ? `${joined(names)} wrote the lyrics for ${subject}` : `${joined(names)} wrote ${subject}`,
          names,
        );
      } else if (names.length && lyricNames.length) {
        const writers = names.filter((name) => !lyricNames.some((lyric) => lyric.toLowerCase() === name.toLowerCase()));
        if (group) add(`song_story:written-by:${slug(group)}`, `${subject} was written by ${group}`, []);
        if (writers.length) {
          add(`song_story:wrote:${slug(joined(writers))}`, `${joined(writers)} wrote ${subject}`, writers);
        }
      }
    }

    const wroteIt = clause.match(/\b([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){0,2})\s+wrote\s+(?:it|the song|the track|this)\b/);
    if (wroteIt?.[1] && !partial && !wroteLyrics) {
      const who = wroteIt[1].trim();
      if (!lyricNames.some((name) => name.toLowerCase() === who.toLowerCase())) {
        add(`song_story:wrote:${slug(who)}`, `${who} wrote ${subject}`, [who]);
      }
    }
  }
  return out;
}

/**
 * Pull a few short claims out of a Wikipedia summary.
 * The summary itself is not stored.
 * A song page that is really about someone else only yields sentences
 * that name our artist. Guests are kept even when they are not members.
 */
export function claimsFromProse(input: {
  text: string;
  subject: string;
  kind: "band" | "album" | "song";
  sourceUrl: string;
  allowedPeople?: readonly string[];
  artistName?: string;
}): SheetClaim[] {
  const text = input.text.replace(/\s+/g, " ").trim();
  if (!text || isSensitiveText(text) && sentencesOf(text).every((sentence) => isSensitiveText(sentence))) {
    return [];
  }
  const claims: SheetClaim[] = [];
  const people = input.allowedPeople?.map((name) => name.toLowerCase());
  const personAllowed = (name: string) => !people || people.length === 0 || people.includes(name.toLowerCase());
  const sentences = sentencesOf(text);
  const storyTopic: FactTopic = input.kind === "song" ? "song_story" : "album_story";

  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index] ?? "";
    if (isSensitiveText(sentence)) continue;
    if (input.kind === "song" && !mentionsArtist(sentence, input.artistName)) {
      const storyBeat = /\b(?:wrote|written|co-written|co-wrote|composed by|recorded at|produced by|mixed by|about|dedicated to|named after|takes its name|lead single|sessions|brothers?|sisters?|siblings?|samples|covered|soundtrack|films?|movies?|sings|sang|vocals|peaked|reached|met)\b/i.test(sentence);
      const foreignYear = /\b(?:19|20)\d{2}\b/.test(sentence);
      if (!storyBeat || foreignYear) continue;
    }

    const formedInPlace = sentence.match(/\bformed in\s+(.+?),\s*in\s+(\d{4})\b/);
    const formedYearOnly = sentence.match(/\bformed in\s+(\d{4})\b/);
    const fromPlace = sentence.match(/\bfrom\s+([A-Z][A-Za-z.'’\-]+(?:,\s*[A-Z][A-Za-z.'’\-]+)?)/);
    if (formedInPlace?.[1] && formedInPlace[2]) {
      const place = formedInPlace[1].split(",")[0]?.trim() || formedInPlace[1].trim();
      pushUnique(claims, originClaim({
        subject: input.subject,
        place,
        year: Number(formedInPlace[2]),
        sourceName: "Wikipedia",
        sourceUrl: input.sourceUrl,
        confidence: "medium",
      }), sentence, input.subject);
    } else if (formedYearOnly?.[1]) {
      pushUnique(claims, originClaim({
        subject: input.subject,
        year: Number(formedYearOnly[1]),
        sourceName: "Wikipedia",
        sourceUrl: input.sourceUrl,
        confidence: "medium",
      }), sentence, input.subject);
    }
    if (input.kind === "band" && fromPlace?.[1]) {
      pushUnique(claims, hometownClaim({
        name: input.subject,
        place: fromPlace[1].trim(),
        sourceName: "Wikipedia",
        sourceUrl: input.sourceUrl,
      }), sentence, input.subject);
    }

    for (const match of sentence.matchAll(/([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){0,3})\s*\(([^)]{2,80})\)/g)) {
      const name = match[1]?.trim() ?? "";
      const role = match[2]?.trim() ?? "";
      if (!name || !personAllowed(name)) continue;
      if (!instrumentWords(role).length) continue;
      pushUnique(claims, memberClaim({
        name,
        instruments: role.split(/,|and/).map((part) => part.trim()),
        sourceName: "Wikipedia",
        sourceUrl: input.sourceUrl,
        confidence: "medium",
      }), sentence, input.subject);
    }

    const produced = sentence.match(/\bproduced by\s+(.+?)(?=\s+at\s+|\.|$)/i);
    if (produced?.[1]) {
      const names = creditNames(produced[1]);
      if (names.length) {
        const who = listWords(names);
        pushUnique(claims, wikiClaim({
          id: `album_story:producer:${slug(who)}`,
          claim: names.length > 1 ? `${who} co-produced ${input.subject}` : `${who} produced ${input.subject}`,
          topic: storyTopic,
          names: [...names, input.subject],
          sourceUrl: input.sourceUrl,
        }), sentence, input.subject);
      }
    }

    const studio = recordingPlace(sentence);
    if (studio && !isSensitiveText(studio.place)) {
      pushUnique(claims, wikiClaim({
        id: `album_story:studio:${slug(studio.place)}`,
        claim: `${input.subject}, ${studio.how} at ${studio.place}`,
        topic: "album_story",
        names: [input.subject],
        places: [studio.place],
        sourceUrl: input.sourceUrl,
      }), sentence, input.subject);
    }

    for (const credit of writingClaims(sentence, input.subject, input.kind, input.sourceUrl)) {
      pushUnique(claims, credit, sentence, input.subject);
    }

    const chartLine = chartSentence(sentence, input.subject);
    if (chartLine) {
      const number = chartLine.match(/\bnumber\s+(\d{1,3})\b/i)?.[1] ?? "";
      pushUnique(claims, wikiClaim({
        id: `reception:${input.kind}:${number}:${slug(chartLine)}`,
        claim: chartLine,
        topic: "reception",
        names: [input.subject],
        numbers: number ? [number] : [],
        sourceUrl: input.sourceUrl,
      }), sentence, input.subject);
    }

    const usedIn = mediaUse(sentence, input.subject);
    if (usedIn && input.kind !== "band") {
      pushUnique(claims, wikiClaim({
        id: `song_story:film:${slug(usedIn)}`,
        claim: usedIn,
        topic: input.kind === "song" ? "song_story" : "album_story",
        names: [input.subject],
        sourceUrl: input.sourceUrl,
      }), sentence, input.subject);
    }

    const guestBlob = sentence.match(/\b(?:featuring|features)\s+(?:guest appearances from\s+|guests?\s+)?([A-Z][^.]{2,160})/);
    if (guestBlob?.[1] && !/\b(?:film|movie|television|episode|series)\b/i.test(sentence)) {
      for (const guest of peopleList(guestBlob[1])) {
        pushUnique(claims, wikiClaim({
          id: `connections:${slug(guest)}`,
          claim: `${guest} is a guest on ${input.subject}`,
          topic: "connections",
          names: [guest, input.subject],
          sourceUrl: input.sourceUrl,
        }), sentence, input.subject);
      }
    }

    const said = sentence.match(/([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){0,2})\s+(?:said|called it|described it as)\s+[“"]([^”"]{8,90})[”"]/);
    if (said?.[1] && said[2] && personAllowed(said[1])) {
      const quote = said[2].trim();
      const quoteWords = quote.split(/\s+/).filter(Boolean);
      if (quoteWords.length <= 12 && !isSensitiveText(quote)) {
        pushUnique(claims, makeClaim({
          id: `band_said:${slug(said[1])}:${slug(quote).slice(0, 48)}`,
          claim: `${said[1]} called it "${quote}"`,
          topic: "band_said",
          names: [said[1]],
          sourceName: "Wikipedia",
          sourceUrl: input.sourceUrl,
          confidence: "medium",
        }), sentence, input.subject);
      }
    }

    const composedYear = sentence.match(/\b(composed|published|written)\s+in\s+((?:1[5-9]\d{2}|20\d{2}))\b/);
    if (composedYear?.[1] && composedYear[2] && input.kind !== "band" && !/\bwritten\s+by\b/i.test(sentence)) {
      const verb = composedYear[1].toLowerCase() === "published" ? "published" : composedYear[1].toLowerCase() === "written" ? "written" : "composed";
      pushUnique(claims, wikiClaim({
        id: `song_story:composed-year:${composedYear[2]}`,
        claim: `${input.subject} was ${verb} in ${composedYear[2]}`,
        topic: "song_story",
        names: [input.subject],
        years: [Number(composedYear[2])],
        numbers: [composedYear[2]],
        sourceUrl: input.sourceUrl,
      }), sentence, input.subject);
    }

    const ordinalWord = "first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth";
    const escapedSubject = input.subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const ordinal = sentence.match(new RegExp(`^${escapedSubject} is the (${ordinalWord}) studio album\\b`, "i"));
    if (ordinal?.[1] && input.kind === "album") {
      const word = ordinal[1].toLowerCase();
      const spoken = `Their ${word} studio album is ${input.subject}`;
      pushUnique(claims, wikiClaim({
        id: `album_story:ordinal:${word}`,
        claim: spoken,
        topic: "album_story",
        names: [input.subject],
        sourceUrl: input.sourceUrl,
      }), sentence, input.subject);
    }

    const releasedYear = sentence.match(/\breleased on\b[^.]{0,48}?\b((?:19|20)\d{2})\b/);
    if (releasedYear?.[1] && input.kind !== "band") {
      pushUnique(claims, wikiClaim({
        id: "release:year",
        claim: `${input.subject} came out in ${releasedYear[1]}`,
        topic: "release",
        names: [input.subject],
        years: [Number(releasedYear[1])],
        numbers: [releasedYear[1]],
        sourceUrl: input.sourceUrl,
      }), sentence, input.subject);
    }

    const label = sentence.match(/\breleased (?:on|as)\b[^.]{0,80}?\bby\s+([A-Z0-9][A-Za-z0-9&.''\-]+(?:\s+Records)?)/);
    if (label?.[1]) {
      pushUnique(claims, wikiClaim({
        id: `album_story:label:${slug(label[1])}`,
        claim: `${input.subject} came out on ${label[1].trim()}`,
        topic: "album_story",
        names: [label[1].trim(), input.subject],
        sourceUrl: input.sourceUrl,
      }), sentence, input.subject);
    }

    const producerTitle = sentence.match(/\bproducer\s+([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){0,2})/);
    if (producerTitle?.[1] && !/^by\b/i.test(producerTitle[1])) {
      pushUnique(claims, wikiClaim({
        id: `album_story:producer:${slug(producerTitle[1])}`,
        claim: `${producerTitle[1].trim()} produced ${input.subject}`,
        topic: storyTopic,
        names: [producerTitle[1].trim(), input.subject],
        sourceUrl: input.sourceUrl,
      }), sentence, input.subject);
    }

    const covered = sentence.match(/([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){0,3})\s+in\s+(\d{4})\s+(?:rearranged|covered)\b/);
    if (covered?.[1] && covered[2]) {
      pushUnique(claims, wikiClaim({
        id: `song_story:cover:${slug(covered[1])}:${covered[2]}`,
        claim: `${covered[1].trim()} covered ${input.subject} in ${covered[2]}`,
        topic: "song_story",
        names: [covered[1].trim(), input.subject],
        years: [Number(covered[2])],
        sourceUrl: input.sourceUrl,
      }), sentence, input.subject);
    }

    const left = sentence.match(/\bdeparture from\s+([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){0,2})/);
    if (left?.[1]) {
      const who = input.artistName?.trim() || input.subject;
      pushUnique(claims, wikiClaim({
        id: `connections:left:${slug(left[1])}`,
        claim: `${who} left ${left[1].trim()}`,
        topic: "connections",
        names: [who, left[1].trim()],
        sourceUrl: input.sourceUrl,
      }), sentence, input.subject);
    }

    const mixed = sentence.match(/\bmixed by\s+([A-Z][A-Za-z0-9'’\-]+(?:\s+[A-Z][A-Za-z0-9'’\-]+){0,3})/);
    if (mixed?.[1]) {
      const mixer = personName(mixed[1]);
      pushUnique(claims, wikiClaim({
        id: `album_story:mixed:${slug(mixer)}`,
        claim: `${mixer} mixed ${input.subject}`,
        topic: storyTopic,
        names: [mixer, input.subject],
        sourceUrl: input.sourceUrl,
      }), sentence, input.subject);
    }

    const named = sentence.match(/\b(?:takes its (?:name|title) from|named after)\s+([^.]{3,80})/);
    if (named?.[1]) {
      const what = named[1].trim().split(/\s+/).slice(0, 6).join(" ").replace(/[,;]+$/g, "");
      if (what && !isSensitiveText(what)) {
        pushUnique(claims, wikiClaim({
          id: `album_story:named:${slug(what)}`,
          claim: `${input.subject} takes its name from ${what}`,
          topic: storyTopic,
          names: [input.subject, what],
          sourceUrl: input.sourceUrl,
        }), sentence, input.subject);
      }
    }

    const single = sentence.match(/\bthe (lead|first|second|third|debut) single\b/i);
    if (single?.[1] && input.kind === "song") {
      pushUnique(claims, wikiClaim({
        id: `song_story:single:${single[1].toLowerCase()}`,
        claim: `${input.subject} was the ${single[1].toLowerCase()} single`,
        topic: "song_story",
        names: [input.subject],
        sourceUrl: input.sourceUrl,
      }), sentence, input.subject);
    }

    const dedicated = sentence.match(/\bdedicated to\s+([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){0,3})/);
    if (dedicated?.[1]) {
      pushUnique(claims, wikiClaim({
        id: `song_story:dedicated:${slug(dedicated[1])}`,
        claim: `${input.subject} is dedicated to ${dedicated[1].trim()}`,
        topic: storyTopic,
        names: [dedicated[1].trim(), input.subject],
        sourceUrl: input.sourceUrl,
      }), sentence, input.subject);
    }

    const quotedAbout = sentence.match(/\b(?:is|was|wrote it) about\s+[“"]([^"”]{4,90})[”"]/);
    const plainAbout = sentence.match(/\b(?:is|was|wrote it) about\s+([^"“”.]{4,80})/);
    const aboutBit = (() => {
      if (quotedAbout?.[1]) {
        const words = quotedAbout[1].trim().replace(/[.]+$/g, "").split(/\s+/).filter(Boolean);
        if (words.length < 2 || words.length > 8) return "";
        return words.join(" ");
      }
      return (plainAbout?.[1] ?? "")
        .split(/\b(?:during|while|after|before)\b/i)[0]
        ?.trim()
        .split(/\s+/)
        .slice(0, 8)
        .join(" ")
        .replace(/[,;:]+$/g, "") ?? "";
    })();
    const quotedTail = sentence.match(/\babout\s+[^"“]{0,48}[“"]([^"”]{2,48})[”"]/);
    const aboutWords = aboutBit.split(/\s+/).filter(Boolean);
    const tailWords = (quotedTail?.[1] ?? "").replace(/[.]+$/g, "").trim().split(/\s+/).filter(Boolean);
    const aboutSpoken = aboutWords.length > 0 && aboutWords.length <= 3 && tailWords.length >= 1 && tailWords.length <= 6
      ? `${aboutWords.join(" ")} ${tailWords.join(" ")}`.replace(/\s+/g, " ").trim()
      : aboutBit;
    if (aboutSpoken.split(/\s+/).filter(Boolean).length >= 2 && input.kind === "song" && !isSensitiveText(aboutSpoken) && !/["“”]/.test(aboutSpoken)) {
      pushUnique(claims, wikiClaim({
        id: `song_story:about:${slug(aboutSpoken)}`,
        claim: `${input.subject} is about ${aboutSpoken}`,
        topic: "song_story",
        names: [input.subject],
        sourceUrl: input.sourceUrl,
      }), sentence, input.subject);
    }

    const lyricist = sentence.match(/([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){0,2}),\s+has written lyrics/);
    if (lyricist?.[1]) {
      pushUnique(claims, wikiClaim({
        id: `connections:lyrics:${slug(lyricist[1])}`,
        claim: `${lyricist[1].trim()} has written lyrics for ${input.subject}`,
        topic: "connections",
        names: [lyricist[1].trim(), input.subject],
        sourceUrl: input.sourceUrl,
      }), sentence, input.subject);
    }

    const project = sentence.match(/\b([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+)?)\s+musician\s+([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){0,3})/);
    if (project?.[1] && project?.[2]) {
      const where = project[1].trim().replace(/[.!?]+$/g, "");
      const who = project[2].trim().replace(/[.!?]+$/g, "");
      pushUnique(claims, hometownClaim({
        name: who,
        place: where,
        sourceName: "Wikipedia",
        sourceUrl: input.sourceUrl,
      }), sentence, input.subject);
      pushUnique(claims, wikiClaim({
        id: `connections:project:${slug(who)}`,
        claim: `${who} is the musician behind ${input.subject}`,
        topic: "connections",
        names: [who, input.subject],
        sourceUrl: input.sourceUrl,
      }), sentence, input.subject);
    }

    const fullBrothers = sentence.match(/\b([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){1,2}) and ([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){1,2}) are (?:twin )?(brothers|sisters|siblings)\b/);
    const shortBrothers = fullBrothers
      ? null
      : sentence.match(/\b([A-Z][A-Za-z.'’\-]+) and ([A-Z][A-Za-z.'’\-]+) ([A-Z][A-Za-z.'’\-]+) are (?:twin )?(brothers|sisters|siblings)\b/);
    const leftName = fullBrothers?.[1] ?? (shortBrothers ? `${shortBrothers[1]} ${shortBrothers[3]}` : "");
    const rightName = fullBrothers?.[2] ?? (shortBrothers ? `${shortBrothers[2]} ${shortBrothers[3]}` : "");
    const relation = fullBrothers?.[3] ?? shortBrothers?.[4] ?? "";
    if (leftName && rightName && relation && (input.kind !== "band" || (personAllowed(leftName) && personAllowed(rightName)))) {
      pushUnique(claims, wikiClaim({
        id: `connections:sibling:${slug(leftName)}:${slug(rightName)}`,
        claim: `${leftName} and ${rightName} are ${relation.toLowerCase()}`,
        topic: "connections",
        names: [leftName, rightName],
        sourceUrl: input.sourceUrl,
      }), sentence, input.subject);
    }

    if (input.kind === "band") {
      const met = sentence.match(/\bmet (?:each other )?(?:in|at|while attending|through)\s+([^.]{3,48})/i);
      const where = met?.[1]?.trim().split(/\s+/).slice(0, 6).join(" ").replace(/[,;]+$/g, "");
      if (where && !isSensitiveText(where)) {
        pushUnique(claims, wikiClaim({
          id: `origin:met:${slug(where)}`,
          claim: `${input.subject} met ${where}`,
          topic: "origin",
          names: [input.subject],
          sourceUrl: input.sourceUrl,
        }), sentence, input.subject);
      }
    }

    const coveredBy = sentence.match(/\bcovered by\s+([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){0,3})/)
      ?? sentence.match(/\b([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){1,3})\s+covered\b/);
    if (coveredBy?.[1] && input.kind === "song") {
      pushUnique(claims, wikiClaim({
        id: `song_story:covered-by:${slug(coveredBy[1])}`,
        claim: `${coveredBy[1].trim()} covered ${input.subject}`,
        topic: "song_story",
        names: [coveredBy[1].trim(), input.subject],
        sourceUrl: input.sourceUrl,
      }), sentence, input.subject);
    }

    const sampled = sentence.match(/\bsamples\s+"([^"]{2,60})"/i);
    if (sampled?.[1] && input.kind === "song") {
      pushUnique(claims, wikiClaim({
        id: `song_story:sample:${slug(sampled[1])}`,
        claim: `${input.subject} samples ${sampled[1].trim()}`,
        topic: "song_story",
        names: [input.subject, sampled[1].trim()],
        sourceUrl: input.sourceUrl,
      }), sentence, input.subject);
    }

    const sings = sentence.match(/\b([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){0,2})\s+(?:sings|sang|provides)\s+(?:the\s+)?(?:lead\s+)?vocals\b/);
    if (sings?.[1] && (input.kind !== "band" || personAllowed(sings[1]))) {
      pushUnique(claims, memberClaim({
        name: sings[1].trim(),
        instruments: ["vocals"],
        sourceName: "Wikipedia",
        sourceUrl: input.sourceUrl,
        confidence: "medium",
      }), sentence, input.subject);
    }

  }

  return claims;
}

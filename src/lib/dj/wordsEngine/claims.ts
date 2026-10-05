/**
 * One short claim, in our words, with the names and the source attached.
 * Wikipedia paragraphs are mined for a fact and then thrown away.
 */

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
  band_said: 1,
  members: 2,
  origin: 3,
  album_story: 4,
  connections: 5,
  reception: 6,
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

export function hometownClaim(input: {
  name: string;
  place: string;
  sourceName: string;
  sourceUrl: string;
}): SheetClaim | null {
  const name = input.name.replace(/\s+/g, " ").trim();
  const place = input.place.replace(/\s+/g, " ").trim();
  if (!name || !place || isSensitiveText(place)) return null;
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
export function copiesSource(claim: string, source: string): boolean {
  const words = claim.toLowerCase().replace(/[^a-z0-9'\s]/g, " ").split(/\s+/).filter(Boolean);
  const src = source.toLowerCase().replace(/[^a-z0-9'\s]/g, " ");
  if (words.length < 8) return false;
  for (let i = 0; i <= words.length - 8; i += 1) {
    const gram = words.slice(i, i + 8).join(" ");
    if (src.includes(gram)) return true;
  }
  return false;
}

function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function pushUnique(list: SheetClaim[], claim: SheetClaim | null, sourceSentence: string) {
  if (!claim) return;
  if (copiesSource(claim.claim, sourceSentence)) return;
  if (list.some((row) => row.id === claim.id)) return;
  list.push(claim);
}

/**
 * Pull a few short claims out of a Wikipedia summary.
 * The summary itself is not stored.
 */
export function claimsFromProse(input: {
  text: string;
  subject: string;
  kind: "band" | "album" | "song";
  sourceUrl: string;
  allowedPeople?: readonly string[];
}): SheetClaim[] {
  const text = input.text.replace(/\s+/g, " ").trim();
  if (!text || isSensitiveText(text) && sentencesOf(text).every((sentence) => isSensitiveText(sentence))) {
    return [];
  }
  const claims: SheetClaim[] = [];
  const people = input.allowedPeople?.map((name) => name.toLowerCase());
  const personAllowed = (name: string) => !people || people.length === 0 || people.includes(name.toLowerCase());

  for (const sentence of sentencesOf(text)) {
    if (isSensitiveText(sentence)) continue;

    const formed = sentence.match(/\bformed in\s+([A-Z][^,.]{2,40}?)(?:,|\s+in\s+)(\d{4})\b/);
    if (formed?.[1] && formed[2]) {
      pushUnique(claims, originClaim({
        subject: input.subject,
        place: formed[1].replace(/\s+in\s*$/i, "").trim(),
        year: Number(formed[2]),
        sourceName: "Wikipedia",
        sourceUrl: input.sourceUrl,
        confidence: "medium",
      }), sentence);
    } else {
      const formedYear = sentence.match(/\bformed in\s+(\d{4})\b/);
      const fromPlace = sentence.match(/\bfrom\s+([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){0,3})/);
      if (formedYear || (input.kind === "band" && fromPlace?.[1])) {
        pushUnique(claims, originClaim({
          subject: input.subject,
          place: fromPlace?.[1],
          year: formedYear ? Number(formedYear[1]) : undefined,
          sourceName: "Wikipedia",
          sourceUrl: input.sourceUrl,
          confidence: "medium",
        }), sentence);
      }
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
      }), sentence);
    }

    const produced = sentence.match(/\bproduced by\s+([A-Z][^,.]{2,50})/);
    if (produced?.[1] && personAllowed(produced[1].trim())) {
      pushUnique(claims, makeClaim({
        id: `album_story:producer:${slug(produced[1])}`,
        claim: `${produced[1].trim()} produced ${input.subject}`,
        topic: input.kind === "song" ? "song_story" : "album_story",
        names: [produced[1].trim(), input.subject],
        sourceName: "Wikipedia",
        sourceUrl: input.sourceUrl,
        confidence: "medium",
      }), sentence);
    }

    const recorded = sentence.match(/\brecorded (?:at|in)\s+([A-Z][^,.]{2,60})/);
    if (recorded?.[1] && !SENSITIVE.test(recorded[1])) {
      pushUnique(claims, makeClaim({
        id: `album_story:studio:${slug(recorded[1])}`,
        claim: `${input.subject} was recorded at ${recorded[1].trim()}`,
        topic: "album_story",
        names: [input.subject],
        places: [recorded[1].trim()],
        sourceName: "Wikipedia",
        sourceUrl: input.sourceUrl,
        confidence: "medium",
      }), sentence);
    }

    const featuring = sentence.match(/\bfeaturing\s+([A-Z][^,.]{2,40})/);
    if (featuring?.[1] && personAllowed(featuring[1].trim())) {
      pushUnique(claims, makeClaim({
        id: `connections:${slug(featuring[1])}`,
        claim: `${featuring[1].trim()} is a guest on ${input.subject}`,
        topic: "connections",
        names: [featuring[1].trim(), input.subject],
        sourceName: "Wikipedia",
        sourceUrl: input.sourceUrl,
        confidence: "medium",
      }), sentence);
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
        }), sentence);
      }
    }

    const chart = sentence.match(/\b(?:peaked|reached)\s+(?:at\s+)?(?:number|no\.?)\s*(\d{1,3})\b/i);
    if (chart?.[1]) {
      pushUnique(claims, makeClaim({
        id: `reception:${input.kind}:${chart[1]}`,
        claim: `${input.subject} reached number ${chart[1]}`,
        topic: "reception",
        names: [input.subject],
        numbers: [chart[1]],
        sourceName: "Wikipedia",
        sourceUrl: input.sourceUrl,
        confidence: "medium",
      }), sentence);
    }

  }

  return claims;
}

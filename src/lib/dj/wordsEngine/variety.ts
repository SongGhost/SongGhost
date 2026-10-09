/**
 * One station's variety rules.
 * A fact is remembered by a normalized id, a connector by its wording,
 * and a listen-for only when the target is a sound on this song's sheet.
 */

import { splitSentences, titleForSpeech } from "@/lib/dj/trackSpeech";
import { slug, type FactTopic, type SheetClaim } from "./claims";
import type { FactNugget, FactPack } from "./types";

export type RotationType =
  | "people"
  | "song_story"
  | "album_story"
  | "place"
  | "chart"
  | "collaboration"
  | "sound";

const ORDINAL = "first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth";

/** A credit role with nothing you can name. "instrument" is not a role. */
const GENERIC_ROLE = /^(?:instrument|instruments|performer|performers|guest|guests|credit|credits|additional|other|miscellaneous|artist|musician|member)$/i;

const HEARABLE = /\b(guitar|bass|drums|piano|violin|saxophone|trumpet|keyboards|keyboard|organ|percussion|cello|banjo|harmonica|flute|trombone|clarinet|ukulele|viola|harp|accordion|tambourine|mellotron|rhodes|strings|horns|choir|riff|hook|harmony|harmonies)\b/i;

const ARRANGEMENT = /\b(strings|horns|choir|riff|hook|harmony|harmonies)\b/i;

/** Closers the writer was copying on every break. */
export const STOCK_CONNECTORS: readonly RegExp[] = [
  /that'?s the part worth knowing\b/i,
  /that'?s the record this (?:song|track) is on/i,
  /that'?s where\b[^.]{0,40}\bgot started/i,
  /which is where you'?ll find this track/i,
  /which is where this track comes from/i,
  /that'?s where\b[^.]{0,48}\bcut this one/i,
  /that'?s who wrote this one/i,
  /that'?s what you hear from\b/i,
  /\bis the one who produced this one\b/i,
];

const THE_INSTRUMENT = /^(?:guitar|bass|drums|piano|violin|saxophone|trumpet|keyboards|organ|percussion|cello|banjo|harmonica|flute|trombone|clarinet|ukulele|viola|harp|accordion)$/i;

/** A credit in spoken English. "William Swan plays the trumpet on this one." */
export function spokenCredit(name: string, role: string): string {
  const clean = specificCreditRole(role);
  if (!clean) return `${name} is on this one.`;
  if (/^vocals?$/i.test(clean)) return `${name} sings on this one.`;
  if (/^engineers?$/i.test(clean)) return `${name} engineered this one.`;
  const parts = clean.split(/\s*,\s*/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 1) {
    const word = parts[0]!;
    const spoken = THE_INSTRUMENT.test(word) ? `the ${word.toLowerCase()}` : word.toLowerCase();
    return `${name} plays ${spoken} on this one.`;
  }
  const list = parts.map((part) => part.toLowerCase());
  const joined = list.length === 2
    ? `${list[0]} and ${list[1]}`
    : `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
  return `${name} plays ${joined} on this one.`;
}

const STORY_MARK = /\b(?:founding|left|until|wrote|written|about|brother|sister|sibling|recorded|produced|formed|dedicated|single|covered|samples|guest|featuring)\b/i;

export function isMusicianBehind(sentence: string): boolean {
  return /\bis the musician behind\b/i.test(sentence);
}

/** A name plus an instrument, with no story around it. */
export function isBareCreditSentence(sentence: string): boolean {
  if (isMusicianBehind(sentence)) return true;
  if (STORY_MARK.test(sentence)) return false;
  if (/\bis credited on\b/i.test(sentence)) return true;
  if (/\bplays\b/i.test(sentence)) return true;
  if (/\bsings\b/i.test(sentence)) return true;
  return false;
}

/** Fold a hearable cue into the fact. Never its own "Hear the …" sentence. */
export function weaveCueIntoFact(sentence: string, cue: string | null): string {
  const trimmed = sentence.replace(/\s+/g, " ").trim();
  const finished = /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  if (!cue) return finished;
  const core = finished.replace(/[.!?]+$/g, "").trim();
  if (/\byou'?ll hear\b/i.test(core)) return `${core}.`;
  const token = cue.trim();
  if (/\s/.test(token) && /^[A-Z]/.test(token)) {
    return `${core}, that's ${token} you'll hear.`;
  }
  const word = token.toLowerCase();
  const pattern = new RegExp(`\\b(?:the\\s+)?${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  if (pattern.test(core)) return `${core.replace(pattern, `the ${word} you'll hear`)}.`;
  return `${core}, that's the ${word} you'll hear.`;
}

/** "Hear the trumpet." / "Listen for the guitar." as its own sentence. */
export function standaloneCueCommand(sentence: string): boolean {
  const text = sentence.replace(/[.!?]+$/g, "").trim();
  return /^(?:hear|listen for|listen to|catch)\b/i.test(text);
}

export function hasStandaloneCue(script: string): boolean {
  return splitSentences(script).some((sentence) => standaloneCueCommand(sentence));
}

/**
 * A handoff or a tease the show adds around the fact.
 * "Here's Title.", "Coming up, Title by Artist.", and "Stick around, …" are frames.
 * The fact sentence is not a frame, even when it names the song.
 */
export function isAppFrame(sentence: string): boolean {
  const text = sentence.replace(/[.!?]+$/g, "").trim();
  if (!text) return false;
  if (/^next,/i.test(text) || /^(?:here'?s|here is|up next|coming up|next is|the next song|this one is|this is|the song is|on deck|stick around|stay for)\b/i.test(text)) {
    return true;
  }
  if (/^from\s+\S/i.test(text) && text.split(/\s+/).length <= 8 && !/\b(?:recorded|produced|formed|wrote|written|left|plays|sings|reached)\b/i.test(text)) {
    return true;
  }
  if (/^that'?s\s+\S/i.test(text) && text.split(/\s+/).length <= 8 && !/\b(?:recorded|produced|formed|wrote|written|left|plays|sings|reached|album)\b/i.test(text)) {
    return true;
  }
  if (/^(?:by|it'?s)\s+\S/i.test(text) && text.split(/\s+/).length <= 8 && !/\b(?:recorded|produced|formed|wrote|written|left|plays|sings|reached|engineered|album)\b/i.test(text)) {
    return true;
  }
  return false;
}

/** Sentences the writer is responsible for. Frames are rotated separately. */
export function factSentences(script: string): string[] {
  return splitSentences(script).filter((sentence) => !isAppFrame(sentence));
}

/** "The song is X, from Y." */
export function cannedSongHandoff(script: string): boolean {
  return /\bthe song is\b[^.]{0,160}\bfrom\b/i.test(script);
}

export function specificCreditRole(role: string): string | null {
  const clean = role.replace(/\s*\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const parts = clean
    .split(/\s*,\s*|\s+\band\s+/i)
    .map((part) => part.trim())
    .filter((part) => part && !GENERIC_ROLE.test(part));
  if (parts.length === 0) {
    if (/^vocals?$/i.test(clean)) return "vocals";
    return null;
  }
  return parts.join(", ");
}

export function isBlankCredit(sentence: string): boolean {
  if (/\bfor instruments?\b/i.test(sentence)) return true;
  if (/\bcredited on instruments?\b/i.test(sentence)) return true;
  const role = sentence.match(/\b(?:plays|credited on|for)\s+([^.!?]+)/i)?.[1]?.trim() ?? "";
  if (!role) return false;
  return specificCreditRole(role) == null && GENERIC_ROLE.test(role.replace(/^the\s+/i, ""));
}

function placeFrom(claim: string, places: readonly string[] | undefined): string {
  const listed = places?.map((place) => place.trim()).find(Boolean) ?? "";
  if (listed) return listed;
  const recorded = claim.match(/\b(?:recorded|produced|sessions)\s+(?:at|in)\s+([^.,]{2,48})/i);
  return recorded?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

function studioSlug(place: string): string {
  return slug(place.replace(/\s+studios?$/i, "").replace(/\s+studio$/i, ""));
}

/**
 * The same real fact, even when two lookups word it differently.
 * Long Pond and Long Pond studio are one id. A tease uses this id too.
 */
const ROLE_WORD = /^(?:singer-songwriter|singer|songwriter)$/i;

/** The person immediately before "wrote" or "has written", without a job title. */
function writerFrom(claim: string): string | null {
  const match = claim.match(/\b((?:[A-Z][A-Za-z.'’\-]+)(?:\s+[A-Z][A-Za-z.'’\-]+){0,4})\s+(?:wrote|has written)\b/);
  if (!match?.[1]) return null;
  const tokens = match[1].split(/\s+/).filter((token) => !ROLE_WORD.test(token));
  return tokens.length > 0 ? tokens.join(" ") : null;
}

function lyricParts(key: string): string[] {
  return key.slice("lyric:".length).split("-").filter((part) => part.length > 2);
}

/**
 * "Gibbard wrote" is the same fact as "Ben Gibbard wrote".
 * "Bryce Dessner wrote" is not the same fact as "Aaron Dessner wrote".
 */
export function spentFact(
  used: ReadonlySet<string>,
  input: { id: string; claim?: string; sentence?: string; names?: readonly string[] },
): boolean {
  const key = factKey(input);
  if (used.has(key)) return true;
  if (!key.startsWith("lyric:")) return false;
  const parts = lyricParts(key);
  const last = parts[parts.length - 1] ?? "";
  const given = parts.slice(0, -1);
  if (!last) return false;
  for (const other of used) {
    if (!other.startsWith("lyric:")) continue;
    const otherParts = lyricParts(other);
    if ((otherParts[otherParts.length - 1] ?? "") !== last) continue;
    const otherGiven = otherParts.slice(0, -1);
    if (given.length === 0 || otherGiven.length === 0) return true;
    if (given[0] === otherGiven[0]) return true;
  }
  return false;
}

export function factKey(input: {
  id: string;
  claim?: string;
  sentence?: string;
  places?: readonly string[];
  names?: readonly string[];
  instruments?: readonly string[];
}): string {
  const claim = (input.claim ?? input.sentence ?? "").replace(/\s+/g, " ").trim();
  if (!claim) return `id:${input.id}`;
  const place = placeFrom(claim, input.places);
  if (place && /\b(?:recorded|produced|sessions|studio)\b/i.test(claim)) {
    return `place:${studioSlug(place)}`;
  }
  const ordinal = claim.match(new RegExp(`\\btheir (?:${ORDINAL}) studio album is\\s+(.+?)[.!?]*$`, "i"));
  if (ordinal?.[1]) return `album:${slug(ordinal[1])}`;
  const onAlbum = claim.match(/\bis on\s+(.+?)[.!?]*$/i);
  if (onAlbum?.[1] && /\b(?:is on|studio album)\b/i.test(claim)) return `album:${slug(onAlbum[1])}`;
  if (/\bare (?:brothers|sisters|siblings)\b/i.test(claim)) return `sibling:${slug(claim)}`;
  const produced = claim.match(/^([A-Z][^.]{1,48}?)\s+produced\b/);
  if (produced?.[1]) return `producer:${slug(produced[1])}`;
  const writer = writerFrom(claim);
  if (writer) return `lyric:${slug(writer)}`;
  const behind = claim.match(/^([A-Z][^.]{1,60}?)\s+is the musician behind\b/i);
  if (behind?.[1]) return `behind:${slug(behind[1])}`;
  const departed = claim.match(/^([A-Z][A-Za-z.'’\-]+(?:\s+[A-Z][A-Za-z.'’\-]+){0,2})\b[^.]*\bleft in\b/);
  if (departed?.[1]) return `left:${slug(departed[1])}`;
  const forRole = claim.match(/^([A-Z][^.]{1,48}?)\s+is credited on\s+.+?\bfor\s+([^.!?]+)/i);
  if (forRole?.[1] && forRole[2] && specificCreditRole(forRole[2])) {
    return `role:${slug(forRole[1])}:${slug(specificCreditRole(forRole[2]) ?? forRole[2])}`;
  }
  const plays = claim.match(/^([A-Z][^.]{1,48}?)\s+(?:plays|is credited on)\s+([^.!?]+)/i);
  if (plays?.[1] && plays[2]) {
    const what = plays[2].replace(/\s+on this one$/i, "").replace(/\s+you'll hear\b.*$/i, "").replace(/^the\s+/i, "").trim();
    const role = specificCreditRole(what);
    if (role) return `role:${slug(plays[1])}:${slug(role)}`;
  }
  const formed = claim.match(/\bformed in\s+([A-Za-z][^.]{1,40}?)(?:\s+in\s+\d{4})?[.!?]*$/i);
  if (formed?.[1]) return `origin:${slug(formed[1])}`;
  const from = claim.match(/\bis from\s+([A-Za-z][^.]{1,40})/i);
  if (from?.[1]) {
    const who = input.names?.[0]?.trim() || "band";
    return `home:${slug(who)}:${slug(from[1])}`;
  }
  return `id:${input.id}`;
}

export function rotationType(input: {
  claim?: string;
  sentence?: string;
  topic?: FactTopic;
  places?: readonly string[];
  instruments?: readonly string[];
}): RotationType {
  const claim = input.claim ?? input.sentence ?? "";
  if (input.topic === "reception" || /\b(?:\bsingle\b|chart|reached number|peaked|billboard)\b/i.test(claim)) {
    return "chart";
  }
  if (
    input.topic === "origin"
    || /\b(?:formed in|is from|met in|met at|hometown)\b/i.test(claim)
  ) {
    return "place";
  }
  if (/\b(?:recorded at|recorded in|sessions at|sessions in)\b/i.test(claim)) return "place";
  if (
    input.topic === "connections"
    || /\b(?:guest|featuring|featured|brother|sister|sibling)\b/i.test(claim)
  ) {
    return "collaboration";
  }
  const hearable = (input.instruments ?? []).some((item) => item && item !== "vocals" && HEARABLE.test(item))
    || HEARABLE.test(claim);
  if (hearable && /\b(?:plays|guitar|bass|drums|piano|strings|vocals|sings)\b/i.test(claim)) return "sound";
  if (input.topic === "members" || /\b(?:plays|sings|vocals)\b/i.test(claim)) return "people";
  if (input.topic === "song_story" || input.topic === "band_said") return "song_story";
  if (input.topic === "album_story") return "album_story";
  if (/\bproduced\b/i.test(claim)) return "collaboration";
  return "song_story";
}

export function cueSpoken(cue: string): string {
  if (/\s/.test(cue)) return cue;
  return `the ${cue}`;
}

/** A sound on this nugget: an instrument, a guest voice, or an arrangement word. Never a place. */
export function earCue(nugget: Pick<FactNugget, "sentence" | "instruments" | "names" | "places">): string | null {
  // Someone who left, or a guest on the album only, is not a sound on this track.
  if (/\bleft in\b/i.test(nugget.sentence)) return null;
  if (/\bis a guest on\b/i.test(nugget.sentence) && !/\bthis (?:song|one|track)\b/i.test(nugget.sentence)) return null;
  const listed = (nugget.instruments ?? []).find((item) => item && item !== "vocals" && specificCreditRole(item));
  const heard = nugget.sentence.match(HEARABLE);
  const instrument = listed || heard?.[1]?.toLowerCase();
  if (instrument && specificCreditRole(instrument)) {
    const word = instrument.toLowerCase();
    return word === "keyboard" ? "keyboards" : word;
  }
  if (/\b(?:guest|featuring|features|vocals|sings)\b/i.test(nugget.sentence)) {
    const guest = nugget.names?.[0]?.trim();
    const place = (nugget.places ?? []).some((item) => item && guest && item.toLowerCase() === guest.toLowerCase());
    if (guest && !place && !/\b(?:studio|label|album)\b/i.test(guest)) return guest;
  }
  const arrangement = nugget.sentence.match(ARRANGEMENT);
  if (arrangement?.[1]) return arrangement[1].toLowerCase();
  return null;
}

function sheetBlob(pack: FactPack): string {
  return [
    ...pack.nuggets.map((nugget) => `${nugget.sentence} ${(nugget.instruments ?? []).join(" ")} ${(nugget.names ?? []).join(" ")}`),
    ...(pack.sheet ?? []).map((claim) => `${claim.claim} ${claim.instruments.join(" ")} ${claim.names.join(" ")}`),
  ].join(" ").toLowerCase();
}

/** Listen-for is a sound that this song's sheet already names. */
export function listenForMisses(script: string, pack: FactPack): boolean {
  const blob = sheetBlob(pack);
  const pattern = /\blisten for(?:\s+the)?\s+([^.,!?]{1,60})/gi;
  for (const match of script.matchAll(pattern)) {
    const target = (match[1] ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!target) return true;
    if (/^(?:instrument|instruments)$/.test(target)) return true;
    if (/\b(?:studio|studios|label|album)\b/.test(target)) return true;
    if (/\b(?:19|20)\d{2}\b/.test(target)) return true;
    const places = [
      ...(pack.nuggets.flatMap((nugget) => nugget.places ?? [])),
      ...(pack.sheet ?? []).flatMap((claim) => claim.places),
    ];
    if (places.some((place) => place && target.includes(place.toLowerCase()))) return true;
    const sound = target.match(HEARABLE)?.[1]?.toLowerCase();
    if (sound && blob.includes(sound === "keyboard" ? "keyboard" : sound)) continue;
    const guest = (pack.nuggets.flatMap((nugget) => nugget.names ?? []))
      .concat((pack.sheet ?? []).flatMap((claim) => claim.names))
      .find((name) => name && target.includes(name.toLowerCase()) && !/\b(?:studio|label)\b/i.test(name));
    if (guest && /\b(?:guest|featuring|vocal|sings)\b/i.test(blob)) continue;
    return true;
  }
  return false;
}

export function hasStockConnector(script: string): boolean {
  return STOCK_CONNECTORS.some((pattern) => pattern.test(script));
}

/** A sentence that is only a name, a title, or "Title by Artist." */
export function hasBareFragment(script: string, pack: FactPack): boolean {
  if (pack.sessionOpening) return false;
  if (pack.shape === "song_id" || pack.shape === "stinger" || pack.shape === "recap") return false;
  const title = titleForSpeech(pack.now.title).trim().toLowerCase();
  const artist = pack.now.artist.trim().toLowerCase();
  const byline = title && artist ? `${title} by ${artist}` : "";
  for (const sentence of splitSentences(script)) {
    const text = sentence.replace(/[.!?]+$/g, "").trim().toLowerCase();
    if (!text) continue;
    if (artist && text === artist) return true;
    if (title && text === title) return true;
    if (byline && text === byline) return true;
  }
  return false;
}

function isHandoffSentence(sentence: string): boolean {
  return /^\s*(?:here'?s|here is|up next|stick around|coming up|next is|this one is|the song is)\b/i.test(sentence);
}

function factTokens(pack: FactPack): string[] {
  const blob = [
    pack.now.title,
    pack.now.artist,
    ...pack.nuggets.flatMap((nugget) => [
      nugget.sentence,
      ...(nugget.names ?? []),
      ...(nugget.places ?? []),
      ...(nugget.instruments ?? []),
    ]),
    pack.tease?.claim ?? "",
    ...(pack.tease?.names ?? []),
  ].join(" ");
  return [...new Set(
    blob.toLowerCase().split(/[^a-z0-9']+/).filter((token) => token.length > 3),
  )];
}

/**
 * The DJ's own reaction. Short, first person, no new name or claim.
 * It can come back. It is not a fact shape.
 */
export function isOwnReaction(sentence: string): boolean {
  const text = sentence.replace(/[.!?]+$/g, "").trim();
  if (!text || text.split(/\s+/).length > 12) return false;
  if (!/\b(?:i love|i like|love this|turn (?:this|it) up|crank (?:this|it)|play this loud)\b/i.test(text)) return false;
  if (/\b(?:19|20)\d{2}\b/.test(text)) return false;
  if (/\b(?:guitar|bass|drums|piano|studio|produced|recorded|album|legendary|iconic|acclaimed|classic|masterpiece)\b/i.test(text)) return false;
  const laterCaps = text.split(/\s+/).slice(1).filter((word) => /^[A-Z]/.test(word));
  return laterCaps.length === 0;
}

/** Glue sentences, with names and the song title removed. A fact sentence is not glue. */
export function connectorKeys(script: string, pack: FactPack): string[] {
  const tokens = factTokens(pack);
  const keys: string[] = [];
  for (const sentence of splitSentences(script)) {
    if (isOwnReaction(sentence)) continue;
    if (isHandoffSentence(sentence)) continue;
    const lower = sentence.toLowerCase();
    if (hasStockConnector(sentence)) {
      const stock = lower.replace(/[^a-z0-9'\s]/g, " ").replace(/\s+/g, " ").trim();
      if (stock) keys.push(stock);
      continue;
    }
    if (/\bis named in that\b/i.test(sentence)) {
      keys.push("is named in that");
      continue;
    }
    if (/\bthe person in that is\b/i.test(sentence)) {
      keys.push("the person in that is");
      continue;
    }
    if (/\bis the one in the story\b/i.test(sentence)) {
      keys.push("is the one in the story");
      continue;
    }
    if (/\bthe name in that is\b/i.test(sentence)) {
      keys.push("the name in that is");
      continue;
    }
    if (/\bin that line\b/i.test(sentence)) {
      keys.push("in that line");
      continue;
    }
    if (/^(?:listen for|hear|catch|notice how|you can hear)\b/i.test(sentence)) {
      const heard = lower
        .replace(/\b(?:guitar|bass|drums|piano|violin|keyboards|keyboard|strings|vocals)\b/g, "#")
        .replace(/[^a-z0-9#'\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (heard) keys.push(heard);
      continue;
    }
    let stripped = ` ${lower} `;
    for (const token of tokens) {
      stripped = stripped.replace(new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " ");
    }
    const norm = stripped.replace(/[^a-z0-9'\s]/g, " ").replace(/\s+/g, " ").trim();
    if (norm.split(" ").filter(Boolean).length < 4) continue;
    keys.push(norm);
  }
  return [...new Set(keys)];
}

export function repeatsConnector(script: string, pack: FactPack): boolean {
  const used = new Set(pack.usedConnectors ?? []);
  if (used.size === 0) return false;
  return connectorKeys(script, pack).some((key) => used.has(key));
}

/**
 * The tease already said this fact. The next break may go deeper
 * (a different fact about the same person) but may not say it again.
 */
export function restatesFact(
  script: string,
  claim: { id: string; claim: string; places?: readonly string[]; names?: readonly string[]; instruments?: readonly string[] },
): boolean {
  const key = factKey(claim);
  const lower = script.toLowerCase();
  const core = claim.claim.toLowerCase().replace(/[.!?]/g, "").replace(/\s+/g, " ").trim();
  if (core.length > 12 && lower.includes(core)) return true;
  if (key.startsWith("place:")) {
    const place = key.slice("place:".length).replace(/-/g, " ");
    if (place && lower.includes(place) && /\b(?:recorded|studio|cut|sessions)\b/.test(lower)) return true;
  }
  if (key.startsWith("producer:")) {
    const who = key.slice("producer:".length).replace(/-/g, " ");
    if (who && lower.includes(who) && /\bproduced\b/.test(lower)) return true;
  }
  if (key.startsWith("album:")) {
    const album = key.slice("album:".length).replace(/-/g, " ");
    if (album && lower.includes(album) && /\b(?:studio album|is on|the record)\b/.test(lower)) return true;
  }
  if (key.startsWith("role:")) {
    const body = key.slice("role:".length);
    const splitAt = body.lastIndexOf(":");
    const who = (splitAt >= 0 ? body.slice(0, splitAt) : body).replace(/-/g, " ");
    const what = (splitAt >= 0 ? body.slice(splitAt + 1) : "").replace(/-/g, " ");
    if (who && what && lower.includes(who) && lower.includes(what) && /\b(?:plays|credited|listen for)\b/.test(lower)) {
      return true;
    }
  }
  if (key.startsWith("origin:")) {
    const place = key.slice("origin:".length).replace(/-/g, " ");
    if (place && lower.includes(place) && /\bformed\b/.test(lower)) return true;
  }
  if (key.startsWith("lyric:")) {
    const parts = lyricParts(key);
    const last = parts[parts.length - 1] ?? "";
    if (!last || !lower.includes(last) || !/\b(?:wrote|written|lyrics)\b/.test(lower)) return false;
    const given = parts.slice(0, -1);
    if (given.some((part) => lower.includes(part))) return true;
    const named = lower.match(new RegExp(`\\b([a-z]{3,})\\s+${last}\\b`));
    if (named?.[1] && !parts.includes(named[1])) return false;
    return true;
  }
  if (key.startsWith("behind:")) {
    const who = key.slice("behind:".length).replace(/-/g, " ");
    const parts = who.split(" ").filter((part) => part.length > 2);
    if (parts.length > 0 && parts.every((part) => lower.includes(part)) && /\bmusician behind\b/.test(lower)) {
      return true;
    }
  }
  if (key.startsWith("left:")) {
    const who = key.slice("left:".length).replace(/-/g, " ");
    const parts = who.split(" ").filter((part) => part.length > 2);
    if (parts.length > 0 && parts.every((part) => lower.includes(part)) && /\bleft\b/.test(lower)) {
      return true;
    }
  }
  return false;
}

function escapeReg(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SHAPE_SKIP = /^(?:here'?s|here|the|a|an|coming|up|next|stick|around|from|on|this|that|it|you|and|but|for|with|their|his|her|after|before|when|where|what|who|how|in|out|not|so|or|to|of|is|was|it's|you're|that's)$/i;

function shapeMasks(sentence: string, pack: FactPack): string[] {
  const raw = [
    titleForSpeech(pack.now.title),
    pack.now.title,
    pack.now.artist,
    pack.now.album ?? "",
    pack.previous?.title ?? "",
    pack.previous?.artist ?? "",
    ...(pack.nuggets.flatMap((nugget) => [...(nugget.names ?? []), ...(nugget.places ?? [])])),
    ...(pack.tease?.names ?? []),
    ...(pack.tease?.places ?? []),
    ...(pack.payoff?.names ?? []),
    ...(pack.sheet ?? []).flatMap((claim) => [...claim.names, ...claim.places]),
    ...(pack.nextSheet ?? []).flatMap((claim) => [...claim.names, ...claim.places]),
  ];
  const runs = sentence.match(/\b[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*)*/g) ?? [];
  for (const run of runs) {
    const parts = run.split(/\s+/);
    const trimmed = parts[0] && SHAPE_SKIP.test(parts[0]) ? parts.slice(1).join(" ") : run;
    if (trimmed && !SHAPE_SKIP.test(trimmed)) raw.push(trimmed);
  }
  return [...new Set(raw.map((item) => item.replace(/\s+/g, " ").trim()).filter((item) => item.length > 1))]
    .sort((a, b) => b.length - a.length);
}

/** Names, titles, and numbers become #. The sentence pattern stays. */
export function sentenceShape(sentence: string, pack: FactPack): string {
  let text = sentence;
  for (const phrase of shapeMasks(sentence, pack)) {
    text = text.replace(new RegExp(escapeReg(phrase), "gi"), " # ");
  }
  return text
    .toLowerCase()
    .replace(/\b(?:19|20)\d{2}\b/g, "#")
    .replace(/\b\d+\b/g, "#")
    .replace(/[^a-z0-9#'\s]/g, " ")
    .replace(/(?:#\s*)+/g, "# ")
    .replace(/\s+/g, " ")
    .trim();
}

function usableShape(shape: string): boolean {
  const tokens = shape.split(" ").filter(Boolean);
  if (tokens.length < 2) return false;
  return tokens.some((token) => token !== "#");
}

/**
 * The same fact, in a new sentence, when this station already used the sheet's sentence shape.
 * The verb stays. Nothing is added.
 */
export function freshFactSentence(sentence: string, pack: FactPack): string {
  const used = new Set(pack.usedShapes ?? []);
  const current = sentenceShape(sentence, pack);
  if (!used.has(current)) return sentence;
  const clean = sentence.replace(/[.!?]+$/g, "").trim();
  const title = titleForSpeech(pack.now.title);
  const artist = pack.now.artist.trim();
  let next = "";
  const formed = clean.match(/^(.+?) formed in (.+?) in (\d{4})$/i);
  if (formed) next = `In ${formed[3]}, ${formed[1].trim()} formed in ${formed[2].trim()}`;
  const recorded = clean.match(/^(.+?) was recorded at (.+)$/i);
  if (!next && recorded && title && artist) {
    next = `${recorded[2].trim()} is where ${artist} recorded ${title}`;
  }
  const lyrics = clean.match(/^(.+?) wrote the lyrics for (.+)$/i);
  if (!next && lyrics) next = `The lyrics for ${lyrics[2].trim()} were written by ${lyrics[1].trim()}`;
  const produced = clean.match(/^(.+?) produced (.+)$/i);
  if (!next && produced) next = `${produced[2].trim()} is what ${produced[1].trim()} produced`;
  const engineered = clean.match(/^(.+?) engineered (.+)$/i);
  if (!next && engineered) next = `${engineered[2].trim()} is what ${engineered[1].trim()} engineered`;
  if (!next) return sentence;
  const rebuilt = `${next}.`;
  if (used.has(sentenceShape(rebuilt, pack))) return sentence;
  return rebuilt;
}

/** The closing handoff, separate from the fact, so ", on Title by Artist" cannot repeat. */
function handoffKey(shape: string): string | null {
  if (/\bon # by #$/.test(shape)) return "handoff:on-by";
  if (/^here'?s # by #$/.test(shape)) return "handoff:heres-by";
  if (/^here'?s #$/.test(shape)) return "handoff:heres";
  if (/\bthat'?s # by #$/.test(shape)) return "handoff:thats-by";
  if (/^coming up\b/.test(shape)) return "handoff:coming-up";
  if (/^up next\b/.test(shape)) return "handoff:up-next";
  if (/\bthis is #$/.test(shape)) return "handoff:this-is";
  return null;
}

/**
 * Same handoff, read off the words themselves.
 * Masking can miss a title; ", on Title by Artist" still has to count.
 */
function rawHandoff(sentence: string): string | null {
  const text = sentence.toLowerCase().replace(/[^a-z0-9'\s]/g, " ").replace(/\s+/g, " ").trim();
  if (/\bon [a-z0-9' ]{1,80} by [a-z0-9' ]{1,60}$/.test(text)) return "handoff:on-by";
  if (/^here'?s [a-z0-9' ]{1,60} by [a-z0-9' ]{1,60}$/.test(text)) return "handoff:heres-by";
  if (/^here'?s [a-z0-9' ]{1,60}$/.test(text)) return "handoff:heres";
  if (/\bthat'?s [a-z0-9' ]{1,80} by [a-z0-9' ]{1,60}$/.test(text)) return "handoff:thats-by";
  if (/^coming up\b/.test(text)) return "handoff:coming-up";
  if (/^up next\b/.test(text)) return "handoff:up-next";
  if (/\bthis is [a-z0-9' ]{1,60}$/.test(text)) return "handoff:this-is";
  return null;
}

export function sentenceShapes(script: string, pack: FactPack): string[] {
  const shapes: string[] = [];
  const seen = new Set<string>();
  const add = (shape: string) => {
    if (seen.has(shape)) return;
    seen.add(shape);
    shapes.push(shape);
  };
  for (const sentence of splitSentences(script)) {
    if (isOwnReaction(sentence)) continue;
    const shape = sentenceShape(sentence, pack);
    if (usableShape(shape)) add(shape);
    const masked = handoffKey(shape);
    const raw = rawHandoff(sentence);
    if (masked) add(masked);
    if (raw) add(raw);
  }
  return shapes;
}

/** A sentence pattern this station already used, or used twice in this line. */
export function repeatsSentenceShape(script: string, pack: FactPack): boolean {
  const seen = new Set(pack.usedShapes ?? []);
  for (const shape of sentenceShapes(script, pack)) {
    if (seen.has(shape)) return true;
    seen.add(shape);
  }
  return false;
}

export function claimFromNugget(nugget: FactNugget): SheetClaim {
  return {
    id: nugget.id,
    claim: nugget.sentence,
    topic: nugget.topic ?? "song_story",
    names: nugget.names ?? [],
    places: nugget.places ?? [],
    years: nugget.years ?? [],
    numbers: nugget.numbers ?? [],
    instruments: nugget.instruments ?? [],
    sourceName: nugget.sourceName ?? "",
    sourceUrl: nugget.sourceUrl ?? "",
    confidence: "high",
  };
}

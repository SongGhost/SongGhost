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
  const forRole = claim.match(/^([A-Z][^.]{1,48}?)\s+is credited on\s+.+?\bfor\s+([^.!?]+)/i);
  if (forRole?.[1] && forRole[2] && specificCreditRole(forRole[2])) {
    return `role:${slug(forRole[1])}:${slug(specificCreditRole(forRole[2]) ?? forRole[2])}`;
  }
  const plays = claim.match(/^([A-Z][^.]{1,48}?)\s+(?:plays|is credited on)\s+([^.!?]+)/i);
  if (plays?.[1] && plays[2] && specificCreditRole(plays[2])) {
    return `role:${slug(plays[1])}:${slug(specificCreditRole(plays[2]) ?? plays[2])}`;
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

/** Glue sentences, with names and the song title removed. A fact sentence is not glue. */
export function connectorKeys(script: string, pack: FactPack): string[] {
  const tokens = factTokens(pack);
  const keys: string[] = [];
  for (const sentence of splitSentences(script)) {
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

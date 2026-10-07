/**
 * Build the only facts New is allowed to say.
 * Fields come from the queue row, the album sleeve (including players
 * and instruments), a catalog lookup already run for this break
 * (iTunes year/album, plus MusicBrainz producer, engineer, and studio
 * when that lookup returned them), or a weather/concert line the
 * scheduler already earned. A concert place is never spoken as
 * "recorded at". Nothing here is invented.
 */

import { isLiveVenueName } from "@/lib/catalog/recordingPlace";
import { cleanTrackForSpeech, formatTrackByline, titleForSpeech } from "@/lib/dj/trackSpeech";
import {
  DEFAULT_COMMENTARY_FORMAT,
  resolveCommentaryFormat,
  type CommentaryFormat,
  type DjSegmentPlan,
} from "@/types/dj";
import type { AlbumContext } from "@/types/station";
import {
  instrumentWords,
  isReleaseTopic,
  topicRank,
  type FactTopic,
  type SheetClaim,
} from "./claims";
import { factKey, isBlankCredit, rotationType, specificCreditRole } from "./variety";
import type { FactNugget, FactPack, FactPackInput, NewBreakShape, SpeechName } from "./types";

const NUGGET_CAP: Record<CommentaryFormat, number> = {
  standard: 0,
  roots_branches: 1,
  time_capsule: 1,
  directors_cut: 2,
};

const MAX_CREDITS = 4;

export function nuggetCapForDepth(depth: CommentaryFormat | undefined): number {
  return NUGGET_CAP[resolveCommentaryFormat(depth ?? DEFAULT_COMMENTARY_FORMAT)];
}

function readYear(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  if (value < 1900 || value > 2035) return undefined;
  return value;
}

function names(title?: string, artist?: string, album?: string): SpeechName {
  const spoken = cleanTrackForSpeech({ title: title ?? "", artist: artist ?? "" });
  const albumName = album?.replace(/\s+/g, " ").trim();
  return albumName ? { ...spoken, album: albumName } : spoken;
}

/**
 * Director's Cut song-1 exit may say one fact about the song that just
 * finished. The only fact used here is the album already on that row.
 * No lookup. No invented year, studio, or story.
 */
function pastNuggetFor(
  depth: CommentaryFormat,
  previous: SpeechName | undefined,
  songOneExit: boolean,
): FactNugget | undefined {
  if (!songOneExit || depth !== "directors_cut") return undefined;
  const album = previous?.album?.trim();
  const title = previous?.title?.trim();
  if (!album || !title || isJunkTagSentence(album)) return undefined;
  return {
    id: "past-album",
    sentence: `${title} is on ${album}.`,
  };
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function albumApplies(
  trackTitle: string,
  trackAlbum: string | undefined,
  album: AlbumContext | null | undefined,
): boolean {
  if (!album) return false;
  if (album.trackList.some((row) => sameText(row.title, trackTitle))) return true;
  if (trackAlbum && sameText(trackAlbum, album.albumTitle)) return true;
  return false;
}

function resolveShape(plan: DjSegmentPlan | undefined): NewBreakShape {
  if (plan?.kind === "song_id") return "song_id";
  if (plan?.kind === "stinger") return "stinger";
  if (plan?.kind === "recap") return "recap";
  if (plan?.kind === "roots_teaser") return "teaser";
  if (plan?.isFirstPlaylistPack) return "catchup";
  return "lore";
}

function topicForId(id: string): FactTopic {
  if (id === "year" || id === "album" || id === "position" || id === "disc" || id === "side") return "release";
  if (id === "label" || id === "concert") return "connections";
  if (id.startsWith("credit:")) return "members";
  if (id === "weather") return "origin";
  return "album_story";
}

function pushNugget(list: FactNugget[], seen: Set<string>, nugget: FactNugget | null) {
  if (!nugget) return;
  const sentence = nugget.sentence.replace(/\s+/g, " ").trim();
  if (!sentence || seen.has(nugget.id)) return;
  seen.add(nugget.id);
  const topic = nugget.topic ?? topicForId(nugget.id);
  const years = nugget.years ?? yearsIn(sentence);
  const instruments = nugget.instruments ?? instrumentWords(sentence);
  list.push({
    ...nugget,
    topic,
    years,
    instruments,
    sentence: /[.!?]$/.test(sentence) ? sentence : `${sentence}.`,
  });
}

function yearsIn(text: string): number[] {
  const found = text.match(/\b(?:19|20)\d{2}\b/g) ?? [];
  return found.map((year) => Number(year)).filter((year) => year >= 1900 && year <= 2035);
}

/** Genre and era tags are not facts. "Filed under alternative rock" is not lore. */
export function isJunkTagSentence(sentence: string): boolean {
  return /\b(?:filed under|listed as)\b/i.test(sentence);
}

function creditId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `credit:${slug || "player"}`;
}

function spokenSet(ids: readonly string[] | undefined): Set<string> {
  return new Set((ids ?? []).map((id) => id.trim()).filter(Boolean));
}

type CandidateContext = {
  input: FactPackInput;
  plan: DjSegmentPlan | undefined;
  now: SpeechName;
  sleeve: AlbumContext | null;
  year: number | undefined;
  albumTitle: string;
};

function collectCandidates(ctx: CandidateContext): FactNugget[] {
  const { input, plan, now, sleeve, year, albumTitle } = ctx;
  const candidates: FactNugget[] = [];
  const seen = new Set<string>();

  if (plan?.kind === "local_events" && plan.localEvent) {
    const event = plan.localEvent;
    const bits = [event.artist, event.venue, event.city, event.dateLabel]
      .map((part) => part.trim())
      .filter(Boolean);
    if (bits.length >= 2) {
      pushNugget(candidates, seen, {
        id: "concert",
        sentence: `${event.artist.trim()} is at ${event.venue.trim()} in ${event.city.trim()} on ${event.dateLabel.trim()}.`,
      });
    }
  }

  const weather = input.weatherSummary?.replace(/\s+/g, " ").trim();
  const city = input.homeCity?.replace(/\s+/g, " ").trim();
  if (plan?.kind === "local_events" && !plan.localEvent && weather && city) {
    pushNugget(candidates, seen, {
      id: "weather",
      sentence: `In ${city}, it is ${weather}.`,
    });
  }

  if (year && now.title) {
    pushNugget(candidates, seen, {
      id: "year",
      sentence: `${now.title} came out in ${year}.`,
    });
  }
  if (albumTitle) {
    pushNugget(candidates, seen, {
      id: "album",
      sentence: `It is on ${albumTitle}.`,
    });
  }
  const sleeveProducer = sleeve?.producer?.trim();
  const lookedUpProducer = input.lookupProducer?.replace(/\s+/g, " ").trim();
  const producer = sleeveProducer
    || (lookedUpProducer && !isJunkTagSentence(lookedUpProducer) ? lookedUpProducer : "");
  if (producer) {
    const firstProducer = producer.split(/\s*,\s*|\s+\band\s+/i).map((name) => name.trim()).find(Boolean) ?? producer;
    pushNugget(candidates, seen, {
      id: "producer",
      sentence: `${firstProducer} produced it.`,
    });
  }
  const sleeveStudio = sleeve?.recordingStudio?.trim();
  const lookedUpStudio = input.lookupStudio?.replace(/\s+/g, " ").trim();
  const studioCandidate = sleeveStudio
    || (lookedUpStudio && !isJunkTagSentence(lookedUpStudio) ? lookedUpStudio : "");
  const studio = studioCandidate && !isLiveVenueName(studioCandidate) ? studioCandidate : "";
  if (studio) {
    pushNugget(candidates, seen, {
      id: "studio",
      sentence: `Recorded at ${studio}.`,
    });
  }
  let credits = 0;
  for (const credit of sleeve?.personnel ?? []) {
    if (credits >= MAX_CREDITS) break;
    const person = credit.name.trim();
    const role = specificCreditRole(credit.role);
    if (!person || !role) continue;
    pushNugget(candidates, seen, {
      id: creditId(person),
      sentence: `${person} is credited on ${role}.`,
    });
    credits += 1;
  }
  for (const rawEngineer of input.lookupEngineers ?? []) {
    if (credits >= MAX_CREDITS) break;
    const person = rawEngineer.replace(/\s+/g, " ").trim();
    if (!person || isJunkTagSentence(person)) continue;
    const id = creditId(person);
    if (seen.has(id)) continue;
    pushNugget(candidates, seen, {
      id,
      sentence: `${person} is credited on engineer.`,
    });
    credits += 1;
  }

  if (sleeve?.label?.trim()) {
    pushNugget(candidates, seen, {
      id: "label",
      sentence: `Out on ${sleeve.label.trim()}.`,
    });
  }

  const trackRow = sleeve?.trackList.find((row) => sameText(row.title, now.title));
  const note = trackRow?.note?.trim();
  if (note) {
    pushNugget(candidates, seen, { id: "note", sentence: note });
  }
  const side = trackRow?.side?.trim();
  if (side) {
    const onSide = /^disc\b/i.test(side) ? `It is on ${side}.` : `It is on side ${side}.`;
    pushNugget(candidates, seen, { id: "side", sentence: onSide });
  }
  if (trackRow && trackRow.position > 0) {
    pushNugget(candidates, seen, {
      id: "position",
      sentence: `It is track ${trackRow.position}.`,
    });
  }

  if (!seen.has("position")) {
    const trackNumber = input.lookupTrackNumber;
    if (
      typeof trackNumber === "number"
      && Number.isInteger(trackNumber)
      && trackNumber > 0
      && trackNumber < 100
    ) {
      pushNugget(candidates, seen, {
        id: "position",
        sentence: `It is track ${trackNumber}.`,
      });
    }
  }

  const discNumber = input.lookupDiscNumber;
  if (
    typeof discNumber === "number"
    && Number.isInteger(discNumber)
    && discNumber > 1
    && discNumber < 20
  ) {
    pushNugget(candidates, seen, {
      id: "disc",
      sentence: `It is on disc ${discNumber}.`,
    });
  }

  const catalogNote = input.catalogNote?.replace(/\s+/g, " ").trim();
  if (!note && catalogNote && !isJunkTagSentence(catalogNote)) {
    pushNugget(candidates, seen, { id: "catalog", sentence: catalogNote });
  }

  return candidates;
}

/**
 * How many unused true facts this input already has, before a network lookup.
 * Cap 0 means this break is not allowed to add facts.
 */
export function unusedFactSupply(input: FactPackInput): { cap: number; unused: number } {
  const plan = input.plan;
  const depth = resolveCommentaryFormat(input.depth ?? DEFAULT_COMMENTARY_FORMAT);
  const shape = resolveShape(plan);
  let cap = nuggetCapForDepth(depth);
  if (shape === "song_id" || shape === "stinger" || shape === "recap") cap = 0;
  if (shape === "teaser") cap = Math.min(1, cap);
  if (cap <= 0) return { cap, unused: 0 };

  const announced = plan?.announceTracks?.at(-1);
  const now = names(announced?.title || input.title, announced?.artist || input.artist);
  const trackAlbum = (announced?.album || input.album || "").trim();
  const sleeve = albumApplies(now.title, trackAlbum, input.albumContext)
    ? input.albumContext ?? null
    : null;
  const year =
    readYear(input.releaseYear)
    ?? (sleeve ? readYear(sleeve.releaseYear) : undefined)
    ?? readYear(input.lookupYear);
  const albumTitle =
    trackAlbum
    || sleeve?.albumTitle?.trim()
    || input.lookupAlbum?.trim()
    || "";
  const spoken = spokenSet(input.spokenFactIds);
  const usedKeys = new Set(input.usedFactKeys ?? []);
  const unused = pickNuggets(
    withTrackGuests(collectCandidates({ input, plan, now, sleeve, year, albumTitle }), now.title),
    cap,
    input.spokenFactIds,
    input.spokenTopics,
    now.title,
    albumTitle,
    input.usedFactKeys,
    input.recentRotation,
  ).filter((nugget) => !spoken.has(nugget.id) && !usedKeys.has(factKey(nugget))).length;
  return { cap, unused };
}

function nuggetToClaim(nugget: FactNugget): SheetClaim {
  return {
    id: nugget.id,
    claim: nugget.sentence,
    topic: nugget.topic ?? topicForId(nugget.id),
    names: nugget.names ?? [],
    places: nugget.places ?? [],
    years: nugget.years ?? yearsIn(nugget.sentence),
    numbers: nugget.numbers ?? (nugget.years ?? yearsIn(nugget.sentence)).map(String),
    instruments: nugget.instruments ?? instrumentWords(nugget.sentence),
    sourceName: nugget.sourceName ?? "catalog",
    sourceUrl: nugget.sourceUrl ?? "",
    confidence: "high",
  };
}

function claimToNugget(claim: SheetClaim): FactNugget {
  return {
    id: claim.id,
    sentence: claim.claim,
    topic: claim.topic,
    names: claim.names,
    places: claim.places,
    years: claim.years,
    numbers: claim.numbers,
    instruments: claim.instruments,
    sourceName: claim.sourceName,
    sourceUrl: claim.sourceUrl,
  };
}

/** A guitar, a bass, or a piano teaches more than "sings" alone. */
function memberRichness(nugget: FactNugget): number {
  const instruments = nugget.instruments ?? [];
  let score = 0;
  if (instruments.some((item) => item !== "vocals")) score += 3;
  if ((nugget.places?.length ?? 0) > 0) score += 2;
  if ((nugget.years?.length ?? 0) > 0) score += 1;
  return score;
}

const ORDINAL_WORD = "first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth";

/** Names in "(feat. Phoebe Bridgers)". The guest on this track, not the album. */
export function featuredGuestNames(title: string): string[] {
  const match = title.match(/\((?:feat\.?|ft\.?|featuring)\s+([^)]+)\)/i);
  if (!match?.[1]) return [];
  return match[1]
    .split(/\s*,\s*|\s+(?:&|and)\s+/i)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 1);
}

function mentions(nugget: FactNugget, name: string): boolean {
  const blob = `${nugget.sentence} ${(nugget.names ?? []).join(" ")}`.toLowerCase();
  return blob.includes(name.toLowerCase());
}

/** A label line, or "X produced it" with no story around it. */
export function isBareLabel(nugget: FactNugget): boolean {
  if (nugget.id === "label" || nugget.id.startsWith("album_story:label")) return true;
  return /\b(?:came out on|out on)\b/i.test(nugget.sentence)
    && !/\b(?:recorded|guest|wrote|studio album|plays)\b/i.test(nugget.sentence);
}

export function isBareProducer(nugget: FactNugget): boolean {
  if (nugget.id === "producer" || nugget.id.startsWith("album_story:producer")) {
    return !/\b(?:guitar|plays|recorded at|same)\b/i.test(nugget.sentence);
  }
  return /^\s*[^.]{0,80}\s+produced (?:it|this)\.?$/i.test(nugget.sentence);
}

/** The album named by an ordinal sentence, when the sentence is one. */
export function ordinalAlbumOf(sentence: string): string | null {
  const their = sentence.match(new RegExp(`\\btheir (?:${ORDINAL_WORD}) studio album is (.+?)[.!?]*$`, "i"));
  if (their?.[1]) return their[1].trim();
  const classic = sentence.match(new RegExp(`^(.+?) is the (?:band's |their )?(?:${ORDINAL_WORD}) studio album\\b`, "i"));
  return classic?.[1]?.trim() ?? null;
}

/** An eighth-album line stays on the eighth album. A one-word tail does not count. */
export function ordinalFitsAlbum(sentence: string, albumTitle: string): boolean {
  if (!/\bstudio album\b/i.test(sentence)) return true;
  const named = ordinalAlbumOf(sentence);
  if (!named) return false;
  if (!albumTitle.trim()) return true;
  return named.toLowerCase() === albumTitle.trim().toLowerCase();
}

/**
 * What to teach first.
 * 0 this track's featured guest
 * 1 a credit that names this song
 * 2 a song or album story
 * 3 a guest on the album, not on this track
 * 4 a player you can hear
 * 5 hometown
 * 6 a producer, only when nothing above is left
 * 9 a label on its own — never taught
 */
function leadRank(nugget: FactNugget, title: string): number {
  if (isBareLabel(nugget)) return 9;
  if (featuredGuestNames(title).some((name) => mentions(nugget, name))) return 0;
  const song = titleForSpeech(title).toLowerCase();
  const sentence = nugget.sentence.toLowerCase();
  if (song && sentence.includes(song) && /\b(?:guest|featured|featuring|credited on)\b/i.test(sentence)) return 1;
  if (isBareProducer(nugget)) return 6;
  const topic = nugget.topic ?? topicForId(nugget.id);
  if (topic === "song_story" || topic === "album_story") return 2;
  if (/\b(?:guest|featuring|featured)\b/i.test(sentence)) return 3;
  if (topic === "members" || nugget.id.startsWith("credit:") || /\bplays\b/i.test(sentence)) return 4;
  if (topic === "origin" || /\b(?:formed in|is from|was born)\b/i.test(sentence)) return 5;
  return 5;
}

function sharesAnchor(left: FactNugget, right: FactNugget, albumTitle = "", trackTitle = ""): boolean {
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const skip = new Set<string>();
  const add = (value: string | null | undefined) => {
    const key = norm(value ?? "");
    if (key.length > 2) skip.add(key);
  };
  add(albumTitle);
  add(trackTitle);
  add(titleForSpeech(trackTitle));
  add(ordinalAlbumOf(left.sentence));
  add(ordinalAlbumOf(right.sentence));
  for (const nugget of [left, right]) {
    const on = nugget.sentence.match(/\b(?:guest|featured|featuring) on ([^.!?]+)/i);
    if (on?.[1]) add(on[1].replace(/\s+with\s+.+$/i, ""));
  }
  const names = new Set((left.names ?? []).map(norm).filter((name) => name.length > 2 && !skip.has(name)));
  if ((right.names ?? []).some((name) => names.has(norm(name)))) return true;
  const places = new Set((left.places ?? []).map(norm).filter((place) => place.length > 2));
  return (right.places ?? []).some((place) => places.has(norm(place)));
}

function withTrackGuests(candidates: FactNugget[], title: string): FactNugget[] {
  const extra: FactNugget[] = [];
  for (const name of featuredGuestNames(title)) {
    if (candidates.some((nugget) => mentions(nugget, name))) continue;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "guest";
    extra.push({
      id: `track-feat:${slug}`,
      sentence: `${name} is the featured guest on this song.`,
      topic: "connections",
      names: [name],
      sourceName: "track title",
      sourceUrl: "",
    });
  }
  return [...extra, ...candidates];
}

/**
 * Release year, album, and track number stay available, but they wait
 * behind a real story. One supporting release fact is enough.
 * A fact already spoken on this station is not used again.
 */
function pickNuggets(
  candidates: FactNugget[],
  maxNuggets: number,
  spokenIds: readonly string[] | undefined,
  spokenTopics: readonly FactTopic[] | undefined,
  trackTitle = "",
  albumTitle = "",
  usedFactKeys?: readonly string[],
  recentRotation?: readonly string[],
  boostNames?: readonly string[],
): FactNugget[] {
  if (maxNuggets <= 0) return [];
  const spoken = spokenSet(spokenIds);
  const usedKeys = new Set(usedFactKeys ?? []);
  const usedTopics = new Set(spokenTopics ?? []);
  const recent = new Set((recentRotation ?? []).slice(-3));
  const boost = new Set((boostNames ?? []).map((name) => name.toLowerCase()).filter((name) => name.length > 2));
  const unused = candidates.filter((nugget) =>
    !spoken.has(nugget.id)
    && !usedKeys.has(factKey(nugget))
    && !isBlankCredit(nugget.sentence)
    && leadRank(nugget, trackTitle) < 9
    && ordinalFitsAlbum(nugget.sentence, albumTitle),
  );
  if (unused.length === 0) return [];
  const ranked = [...unused].sort((a, b) => {
    const aTopic = a.topic ?? topicForId(a.id);
    const bTopic = b.topic ?? topicForId(b.id);
    if (recent.size > 0) {
      const aFresh = recent.has(rotationType(a)) ? 1 : 0;
      const bFresh = recent.has(rotationType(b)) ? 1 : 0;
      if (aFresh !== bFresh) return aFresh - bFresh;
    }
    if (boost.size > 0) {
      const shares = (nugget: FactNugget) => (nugget.names ?? []).some((name) => boost.has(name.toLowerCase())) ? 0 : 1;
      const byBoost = shares(a) - shares(b);
      if (byBoost !== 0) return byBoost;
    }
    const byStory = leadRank(a, trackTitle) - leadRank(b, trackTitle);
    if (byStory !== 0) return byStory;
    const aUsedTopic = usedTopics.has(aTopic) ? 1 : 0;
    const bUsedTopic = usedTopics.has(bTopic) ? 1 : 0;
    if (aUsedTopic !== bUsedTopic) return aUsedTopic - bUsedTopic;
    const aRelease = isReleaseTopic(aTopic) || a.id === "label" ? 1 : 0;
    const bRelease = isReleaseTopic(bTopic) || b.id === "label" ? 1 : 0;
    if (aRelease !== bRelease) return aRelease - bRelease;
    const aFlat = flatCredit(a) ? 1 : 0;
    const bFlat = flatCredit(b) ? 1 : 0;
    if (aFlat !== bFlat) return aFlat - bFlat;
    const byTopic = topicRank(aTopic) - topicRank(bTopic);
    if (byTopic !== 0) return byTopic;
    if (aTopic === "members") return memberRichness(b) - memberRichness(a);
    return 0;
  });
  const backing = (nugget: FactNugget) => {
    const topic = nugget.topic ?? topicForId(nugget.id);
    return isReleaseTopic(topic) || nugget.id === "label";
  };
  const mains = ranked.filter((nugget) => !backing(nugget));
  const support = ranked.filter((nugget) => backing(nugget));
  const ordered = mains.length > 0 ? [...mains, ...support] : ranked;
  const take: Record<string, number> = {
    members: 1,
    origin: 1,
    album_story: 1,
    song_story: 1,
    band_said: 1,
    connections: 1,
    reception: 1,
    release: 1,
  };
  const chosen: FactNugget[] = [];
  const taken = new Map<string, number>();
  const tryTake = (nugget: FactNugget, limit: boolean) => {
    if (chosen.length >= maxNuggets) return;
    if (chosen.some((row) => row.id === nugget.id)) return;
    const topic = nugget.topic ?? topicForId(nugget.id);
    const release = isReleaseTopic(topic) || nugget.id === "label";
    const already = taken.get(topic) ?? 0;
    if (limit && flatCredit(nugget) && leadRank(nugget, trackTitle) > 2) return;
    if (limit && release && mains.length > 0) return;
    if (limit && already >= (take[topic] ?? 1)) return;
    if (release && mains.length > 0 && (taken.get("release") ?? 0) >= 1) return;
    chosen.push(nugget);
    taken.set(topic, already + 1);
  };
  for (const nugget of ordered) tryTake(nugget, true);
  if (chosen.length < maxNuggets) {
    for (const nugget of ordered) tryTake(nugget, false);
  }
  return trimToOneSurprise(chosen, maxNuggets, albumTitle, trackTitle);
}

/** A pile of names, or "X sings" with nothing else. One real player is a fact. */
function flatCredit(nugget: FactNugget): boolean {
  if ((nugget.names?.length ?? 0) >= 3) return true;
  if ((nugget.instruments?.length ?? 0) >= 3) return true;
  const played = (nugget.instruments ?? []).filter((item) => item !== "vocals");
  if (/^\s*.+\s+sings\.?$/i.test(nugget.sentence)) return true;
  if (played.length === 1 && (nugget.names?.length ?? 0) <= 2) return false;
  return /\bis credited on\b/i.test(nugget.sentence);
}

function isPlayerCredit(nugget: FactNugget): boolean {
  const topic = nugget.topic ?? topicForId(nugget.id);
  return topic === "members" || /\bis credited on\b/i.test(nugget.sentence);
}

/**
 * One fact, unless the next one is the same person or the same place.
 * A label, a producer, and a guitar credit do not get stacked.
 */
function trimToOneSurprise(chosen: FactNugget[], maxNuggets: number, albumTitle = "", trackTitle = ""): FactNugget[] {
  const pool = chosen.filter((nugget) => !isBareLabel(nugget));
  const first = pool[0];
  if (!first) return [];
  const kept: FactNugget[] = [tightenCreditSentence(first)];
  if (maxNuggets <= 1) return kept;
  let credits = isPlayerCredit(first) ? 1 : 0;
  for (const nugget of pool.slice(1)) {
    if (kept.length >= maxNuggets) break;
    if (!sharesAnchor(first, nugget, albumTitle, trackTitle)) continue;
    if (isPlayerCredit(nugget)) {
      if (credits >= 1) continue;
      credits += 1;
    }
    kept.push(tightenCreditSentence(nugget));
  }
  return kept;
}

/**
 * A credit stack names one person.
 * "Credited on" stays "credited on" unless the sheet already says they play it.
 */
function tightenCreditSentence(nugget: FactNugget): FactNugget {
  const played = (nugget.instruments ?? []).filter((item) => item !== "vocals");
  const people = nugget.names ?? [];
  if (played.length < 3 && people.length < 3) return nugget;
  const who = people[0];
  const what = played[0];
  if (!who) return nugget;
  const credited = /\bis credited on\b/i.test(nugget.sentence);
  const plays = /\bplays\b/i.test(nugget.sentence);
  if (!credited && !plays) {
    return {
      ...nugget,
      names: [who],
      instruments: what ? [what] : (nugget.instruments ?? []).slice(0, 1),
    };
  }
  return {
    ...nugget,
    sentence: what
      ? `${who} ${credited ? "is credited on" : "plays"} ${what}.`
      : `${who} ${credited ? "is credited on this one" : "is on this one"}.`,
    names: [who],
    instruments: what ? [what] : (nugget.instruments ?? []).slice(0, 1),
  };
}

function hasCraftDetail(nugget: FactNugget): boolean {
  const blob = `${nugget.sentence} ${(nugget.instruments ?? []).join(" ")}`;
  const text = blob.replace(/\bstudio albums?\b/gi, "");
  return /\b(?:guitar|bass|drums|piano|vocal|vocals|produced|recorded|studio|wrote|written|lyric|lyrics|composed|engineer)\b/i.test(text);
}

function lengthFor(depth: FactPack["depth"], claims: readonly { topic?: FactTopic }[]): FactPack["length"] {
  const mains = claims.filter((claim) => claim.topic && !isReleaseTopic(claim.topic)).length;
  // About 2.5 words a second. Prefer the short end. A thin sheet does not get padded.
  if (depth === "standard") return { minWords: 0, maxWords: 32 };
  if (depth === "directors_cut") {
    if (mains === 0) return { minWords: 0, maxWords: 40 };
    // The sheet can be long. This break still teaches one fact, or two that
    // share a person or a place. The floor is one true telling, not a quota.
    return { minWords: 12, maxWords: mains >= 4 ? 90 : 75 };
  }
  // Every Song, Roots, Time Capsule: a real fact, not a padded closer.
  if (mains === 0) return { minWords: 0, maxWords: 40 };
  return { minWords: 12, maxWords: 50 };
}

function claimIsCreditList(claim: SheetClaim): boolean {
  if (claim.instruments.length >= 3) return true;
  if (claim.names.length >= 3) return true;
  const chunks = claim.claim
    .split(/\s*,\s*|\s+\band\b\s+/i)
    .map((part) => part.trim())
    .filter((part) => /^[A-Z]/.test(part));
  return chunks.length >= 3 && /\b(?:guest|produced|featuring|credited|plays)\b/i.test(claim.claim);
}

/** A tease has to be a promise, not "someone sings" or a credit line. */
function flatTease(claim: SheetClaim): boolean {
  if (claimIsCreditList(claim)) return true;
  if (/^\s*.+\s+sings\.?$/i.test(claim.claim)) return true;
  if (/\bis credited on\b/i.test(claim.claim)) return true;
  if (/\bstudio album\b/i.test(claim.claim)) return true;
  if (/\b(?:came out on|out on|is the label)\b/i.test(claim.claim)) return true;
  if (/\bproduced (?:it|this)\b/i.test(claim.claim)) return true;
  return false;
}

function sameWords(left: string, right: string): boolean {
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return norm(left) === norm(right);
}

function pickTease(
  nextClaims: readonly SheetClaim[],
  spokenIds: ReadonlySet<string>,
  spokenTopics: ReadonlySet<FactTopic>,
  avoidNames: readonly string[],
  avoidClaims: readonly string[],
  usedFactKeys?: ReadonlySet<string>,
): SheetClaim | undefined {
  const avoid = new Set(avoidNames.map((name) => name.toLowerCase()));
  const usedKeys = usedFactKeys ?? new Set<string>();
  const ranked = [...nextClaims].filter((claim) =>
    !isReleaseTopic(claim.topic)
    && !spokenIds.has(claim.id)
    && !usedKeys.has(factKey(claim))
    && !isBlankCredit(claim.claim)
    && !flatTease(claim)
    && !avoidClaims.some((spoken) => sameWords(spoken, claim.claim)),
  );
  ranked.sort((a, b) => {
    const byStory = leadRank(claimToNugget(a), "") - leadRank(claimToNugget(b), "");
    if (byStory !== 0) return byStory;
    const aUsed = spokenTopics.has(a.topic) ? 1 : 0;
    const bUsed = spokenTopics.has(b.topic) ? 1 : 0;
    if (aUsed !== bUsed) return aUsed - bUsed;
    const byTopic = topicRank(a.topic) - topicRank(b.topic);
    if (byTopic !== 0) return byTopic;
    const aSame = a.names.some((name) => avoid.has(name.toLowerCase())) ? 1 : 0;
    const bSame = b.names.some((name) => avoid.has(name.toLowerCase())) ? 1 : 0;
    if (aSame !== bSame) return aSame - bSame;
    if (a.topic === "members") {
      const score = (claim: SheetClaim) => (claim.instruments.some((item) => item !== "vocals") ? 1 : 0);
      return score(b) - score(a);
    }
    return 0;
  });
  return ranked[0];
}

export function buildFactPack(input: FactPackInput): FactPack {
  const plan = input.plan;
  const announced = plan?.announceTracks?.at(-1);
  const now = names(announced?.title || input.title, announced?.artist || input.artist);
  const sessionOpening = plan?.isSessionOpening === true;
  const songOneExit = plan?.isFirstPlaylistPack === true && !sessionOpening;
  const previousSource = songOneExit ? (plan?.recapTracks?.[0] ?? input.previous) : undefined;
  const previous = previousSource
    ? names(previousSource.title, previousSource.artist, previousSource.album)
    : undefined;
  const previousName =
    previous && (previous.title || previous.artist) ? previous : undefined;

  const depth = resolveCommentaryFormat(input.depth ?? DEFAULT_COMMENTARY_FORMAT);
  let shape = resolveShape(plan);
  if (!songOneExit && (shape === "recap" || shape === "catchup")) shape = "lore";
  let maxNuggets = sessionOpening ? 0 : nuggetCapForDepth(depth);
  if (shape === "song_id" || shape === "stinger" || shape === "recap") maxNuggets = 0;
  if (shape === "teaser") maxNuggets = Math.min(1, maxNuggets);

  const trackAlbum = (announced?.album || input.album || "").trim();
  const sleeve = albumApplies(now.title, trackAlbum, input.albumContext)
    ? input.albumContext ?? null
    : null;
  const year =
    readYear(input.releaseYear)
    ?? (sleeve ? readYear(sleeve.releaseYear) : undefined)
    ?? readYear(input.lookupYear);
  const albumTitle =
    trackAlbum
    || sleeve?.albumTitle?.trim()
    || input.lookupAlbum?.trim()
    || "";

  const sleeveCandidates = collectCandidates({ input, plan, now, sleeve, year, albumTitle });
  const external = (input.claims ?? []).map(claimToNugget);
  const merged: FactNugget[] = [];
  const seenNuggets = new Set<string>();
  for (const nugget of withTrackGuests([...external, ...sleeveCandidates], now.title)) {
    if (seenNuggets.has(nugget.id)) continue;
    if (!ordinalFitsAlbum(nugget.sentence, albumTitle)) continue;
    seenNuggets.add(nugget.id);
    merged.push(nugget);
  }
  let nuggets = sessionOpening
    ? []
    : pickNuggets(
        merged,
        maxNuggets,
        input.spokenFactIds,
        input.spokenTopics,
        now.title,
        albumTitle,
        input.usedFactKeys,
        input.recentRotation,
        input.boostNames,
      );
  if (!sessionOpening && input.personaId?.trim() === "sarcastic-critic") {
    const spoken = spokenSet(input.spokenFactIds);
    const blocked = new Set(input.usedFactKeys ?? []);
    const craft = [...merged]
      .filter((nugget) =>
        !spoken.has(nugget.id)
        && !blocked.has(factKey(nugget))
        && !isBlankCredit(nugget.sentence)
        && !isReleaseTopic(nugget.topic ?? topicForId(nugget.id))
        && !isBareLabel(nugget)
        && hasCraftDetail(nugget),
      )
      .sort((a, b) => leadRank(a, now.title) - leadRank(b, now.title))[0];
    if (craft) {
      nuggets = trimToOneSurprise(
        [craft, ...nuggets.filter((nugget) => nugget.id !== craft.id)],
        maxNuggets,
        albumTitle,
        now.title,
      );
    }
  }
  const recapLines = songOneExit
    ? (plan?.recapTracks ?? [])
      .map((track) => formatTrackByline(track))
      .filter((line) => line && line !== "this one")
    : [];
  const pastNugget = pastNuggetFor(depth, previousName, songOneExit);

  const sheet = [
    ...(input.claims ?? []),
    ...sleeveCandidates.map(nuggetToClaim),
  ].filter((claim, index, all) => all.findIndex((row) => row.id === claim.id) === index);
  const nextSheet = input.nextClaims ?? [];
  const spokenIds = spokenSet(input.spokenFactIds);
  const spokenTopicSet = new Set(input.spokenTopics ?? []);
  const usedKeySet = new Set(input.usedFactKeys ?? []);
  const payoff = input.payoff;
  const leadNames = nuggets
    .filter((nugget) => !isReleaseTopic(nugget.topic ?? topicForId(nugget.id)))
    .flatMap((nugget) => nugget.names ?? []);
  const tease = !sessionOpening && !payoff
    ? pickTease(
        nextSheet,
        spokenIds,
        spokenTopicSet,
        leadNames,
        nuggets.map((nugget) => nugget.sentence),
        usedKeySet,
      )
    : undefined;
  const allowedYears = [
    ...sheet.flatMap((claim) => claim.years),
    ...nextSheet.flatMap((claim) => claim.years),
    ...nuggets.flatMap((nugget) => nugget.years ?? yearsIn(nugget.sentence)),
  ];

  const variant = ((plan?.styleRotationIndex ?? 0) % 5) as 0 | 1 | 2 | 3 | 4;
  const stationName = input.stationName?.replace(/\s+/g, " ").trim() || undefined;

  return {
    engine: "new",
    depth,
    maxNuggets,
    personaId: input.personaId?.trim() || "standard-broadcast",
    shape,
    shapeVariant: variant,
    stationName,
    includeStationId: plan?.includeStinger === true && Boolean(stationName),
    now: albumTitle ? { ...now, album: albumTitle } : now,
    previous: previousName,
    songOneExit,
    pastNugget,
    recapLines,
    nuggets,
    sheet,
    nextSheet,
    ...(tease ? { tease } : {}),
    ...(payoff ? { payoff } : {}),
    usedConnectors: input.usedConnectors ?? [],
    recentRotation: input.recentRotation ?? [],
    allowExplicit: input.allowExplicit !== false,
    allowedYears: [...new Set(allowedYears)],
    length: lengthFor(depth, sheet),
    sessionOpening,
  };
}

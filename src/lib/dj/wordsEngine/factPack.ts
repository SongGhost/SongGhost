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
import { cleanTrackForSpeech, formatTrackByline } from "@/lib/dj/trackSpeech";
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
import type { FactNugget, FactPack, FactPackInput, NewBreakShape, SpeechName } from "./types";

const NUGGET_CAP: Record<CommentaryFormat, number> = {
  standard: 0,
  roots_branches: 1,
  time_capsule: 3,
  directors_cut: 6,
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
    pushNugget(candidates, seen, {
      id: "producer",
      sentence: `${producer} produced it.`,
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
    const role = credit.role.trim();
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
  const unused = pickNuggets(
    collectCandidates({ input, plan, now, sleeve, year, albumTitle }),
    cap,
    input.spokenFactIds,
    input.spokenTopics,
  ).filter((nugget) => !spoken.has(nugget.id)).length;
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
): FactNugget[] {
  if (maxNuggets <= 0) return [];
  const spoken = spokenSet(spokenIds);
  const usedTopics = new Set(spokenTopics ?? []);
  const unused = candidates.filter((nugget) => !spoken.has(nugget.id));
  if (unused.length === 0) return [];
  const ranked = [...unused].sort((a, b) => {
    const aTopic = a.topic ?? topicForId(a.id);
    const bTopic = b.topic ?? topicForId(b.id);
    const aUsedTopic = usedTopics.has(aTopic) ? 1 : 0;
    const bUsedTopic = usedTopics.has(bTopic) ? 1 : 0;
    if (aUsedTopic !== bUsedTopic) return aUsedTopic - bUsedTopic;
    const aRelease = isReleaseTopic(aTopic) ? 1 : 0;
    const bRelease = isReleaseTopic(bTopic) ? 1 : 0;
    if (aRelease !== bRelease) return aRelease - bRelease;
    const byTopic = topicRank(aTopic) - topicRank(bTopic);
    if (byTopic !== 0) return byTopic;
    if (aTopic === "members") return memberRichness(b) - memberRichness(a);
    return 0;
  });
  const mains = ranked.filter((nugget) => !isReleaseTopic(nugget.topic ?? topicForId(nugget.id)));
  const support = ranked.filter((nugget) => isReleaseTopic(nugget.topic ?? topicForId(nugget.id)));
  const ordered = mains.length > 0 ? [...mains, ...support] : ranked;
  const chosen: FactNugget[] = [];
  let releases = 0;
  for (const nugget of ordered) {
    if (chosen.length >= maxNuggets) break;
    const release = isReleaseTopic(nugget.topic ?? topicForId(nugget.id));
    if (release && mains.length > 0 && releases >= 1) continue;
    if (release) releases += 1;
    chosen.push(nugget);
  }
  return chosen;
}

function lengthFor(depth: FactPack["depth"], claims: readonly { topic?: FactTopic }[]): FactPack["length"] {
  const mains = claims.filter((claim) => claim.topic && !isReleaseTopic(claim.topic)).length;
  if (depth === "standard") return { minWords: 0, maxWords: 32 };
  if (depth === "time_capsule") {
    return mains >= 2 ? { minWords: 50, maxWords: 78 } : { minWords: 0, maxWords: 55 };
  }
  if (depth === "directors_cut") {
    return mains >= 3 ? { minWords: 75, maxWords: 117 } : { minWords: 0, maxWords: 55 };
  }
  return mains >= 1 ? { minWords: 30, maxWords: 57 } : { minWords: 0, maxWords: 40 };
}

function pickTease(
  nextClaims: readonly SheetClaim[],
  spokenIds: ReadonlySet<string>,
  spokenTopics: ReadonlySet<FactTopic>,
  avoidNames: readonly string[],
): SheetClaim | undefined {
  const avoid = new Set(avoidNames.map((name) => name.toLowerCase()));
  const ranked = [...nextClaims].filter((claim) => !isReleaseTopic(claim.topic) && !spokenIds.has(claim.id));
  ranked.sort((a, b) => {
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
  for (const nugget of [...external, ...sleeveCandidates]) {
    if (seenNuggets.has(nugget.id)) continue;
    seenNuggets.add(nugget.id);
    merged.push(nugget);
  }
  const nuggets = sessionOpening
    ? []
    : pickNuggets(merged, maxNuggets, input.spokenFactIds, input.spokenTopics);
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
  const payoff = input.payoff;
  const leadNames = nuggets
    .filter((nugget) => !isReleaseTopic(nugget.topic ?? topicForId(nugget.id)))
    .flatMap((nugget) => nugget.names ?? []);
  const tease = !sessionOpening && !payoff
    ? pickTease(nextSheet, spokenIds, spokenTopicSet, leadNames)
    : undefined;
  const allowedYears = [
    ...sheet.flatMap((claim) => claim.years),
    ...nextSheet.flatMap((claim) => claim.years),
    ...nuggets.flatMap((nugget) => nugget.years ?? yearsIn(nugget.sentence)),
  ];

  const variant = ((plan?.styleRotationIndex ?? 0) % 3) as 0 | 1 | 2;
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
    now,
    previous: previousName,
    songOneExit,
    pastNugget,
    recapLines,
    nuggets,
    sheet,
    nextSheet,
    ...(tease ? { tease } : {}),
    ...(payoff ? { payoff } : {}),
    allowExplicit: input.allowExplicit !== false,
    allowedYears: [...new Set(allowedYears)],
    length: lengthFor(depth, sheet),
    sessionOpening,
  };
}

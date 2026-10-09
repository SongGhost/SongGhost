/**
 * The fact sheet for one song.
 * The band sheet is saved in memory and reused for the rest of the station.
 * MusicBrainz stays at one request a second. If time runs out, the claims
 * already in hand are what the host may say.
 */

import { isLiveVenueName } from "@/lib/catalog/recordingPlace";
import {
  isLaterEditionTitle,
  lookupMusicBrainzArtist,
  lookupMusicBrainzArtistProfile,
  lookupMusicBrainzRecordingIdentity,
  type MusicBrainzArtistProfile,
  type MusicBrainzRecordingIdentity,
} from "@/lib/catalog/musicbrainz";
import { lookupITunesTrack } from "@/lib/itunes";
import {
  isSensitiveText,
  makeClaim,
  memberClaim,
  originClaim,
  type SheetClaim,
} from "./claims";
import { wikipediaClaimsFor, wikipediaStoryFor, wikidataBandClaims, wikidataPersonOrigin } from "./wiki";
import { officialHost, pickAllowlistedArticle, pickGeniusLink, readLinkedPage } from "./article";
import { readSourcePack, writeSourcePack } from "./sourceStore";
import type { SourcePassage } from "./types";
import { specificCreditRole, spokenCredit } from "./variety";

export type BreakSheet = {
  claims: SheetClaim[];
  nextClaims: SheetClaim[];
  passages: SourcePassage[];
  artistId?: string;
  recordingId?: string;
  sources: Array<{ name: string; url: string }>;
};

type SheetBox = {
  claims: SheetClaim[];
  passages: SourcePassage[];
  artistId?: string;
  recordingId?: string;
};

const bandSheets = new Map<string, SheetClaim[]>();
const bandJobs = new Map<string, Promise<SheetClaim[]>>();
const jobs = new Map<string, { box: SheetBox; promise: Promise<void> }>();

function spokenArtistName(requested: string, profileName: string): string {
  const asked = requested.replace(/\s+/g, " ").trim();
  const found = profileName.replace(/\s+/g, " ").trim();
  if (!found) return asked;
  if (asked && found.toLowerCase() === asked.toLowerCase()) return asked;
  return found;
}

function songKey(artist: string, title: string, album?: string): string {
  return [artist, title, album ?? ""].map((part) => part.trim().toLowerCase()).join("::");
}

function rosterNames(claims: readonly SheetClaim[]): string[] {
  const names: string[] = [];
  for (const claim of claims) {
    if (claim.topic !== "members") continue;
    const name = claim.names[0];
    if (name) names.push(name);
  }
  return names;
}

function addClaim(box: SheetBox, claim: SheetClaim | null, roster: readonly string[]) {
  if (!claim || isSensitiveText(claim.claim)) return;
  if (claim.id === "release:year") {
    const existing = box.claims.find((row) => row.id === "release:year");
    const nextYear = claim.years[0];
    if (existing && nextYear && existing.years[0] && existing.years[0] !== nextYear) {
      if (existing.sourceName === "iTunes" && claim.sourceName !== "iTunes") {
        box.claims = box.claims.filter((row) => row.id !== "release:year");
      } else {
        return;
      }
    }
  }
  if (box.claims.some((row) => row.id === claim.id)) return;
  const person = claim.names[0]?.toLowerCase() ?? "";
  const rosterSet = new Set(roster.map((name) => name.toLowerCase()));
  const aboutAPerson = claim.topic === "members" || /\bis from\b/i.test(claim.claim);
  if (aboutAPerson && rosterSet.size > 0 && person && !rosterSet.has(person)) return;
  const role = claim.id.split(":")[1] ?? "";
  if (
    claim.sourceName !== "MusicBrainz"
    && (role === "producer" || role === "studio" || role === "engineer")
    && box.claims.some((row) => row.sourceName === "MusicBrainz" && row.id.split(":")[1] === role)
  ) {
    return;
  }
  const locked = box.claims.find((row) =>
    row.sourceName === "MusicBrainz"
    && row.topic === claim.topic
    && claim.sourceName !== "MusicBrainz"
    && row.names.some((name) => claim.names.some((other) => other.toLowerCase() === name.toLowerCase())),
  );
  if (locked) {
    const yearClash = locked.years.length > 0 && claim.years.length > 0 && locked.years[0] !== claim.years[0];
    const placeClash = locked.places.length > 0 && claim.places.length > 0
      && locked.places[0]?.toLowerCase() !== claim.places[0]?.toLowerCase();
    if (yearClash || placeClash) return;
  }
  const place = claim.places[0] ?? "";
  if (/recorded at/i.test(claim.claim) && place && isLiveVenueName(place)) return;
  if (
    claim.sourceName !== "MusicBrainz"
    && box.claims.some((row) => row.sourceName === "MusicBrainz" && row.id.startsWith("song_story:"))
    && /\b(?:wrote|composed|lyrics)\b/i.test(claim.claim)
    && !/\b(?:based on|wrote the (?:intro|introduction|arrangement)|was written by|written by|members)\b/i.test(claim.claim)
  ) {
    return;
  }
  box.claims.push(claim);
}

function addPassage(box: SheetBox, passage: SourcePassage | null) {
  if (!passage?.text.trim() || !passage.url) return;
  if (box.passages.some((row) => row.url === passage.url)) return;
  box.passages.push(passage);
}

function addMany(box: SheetBox, claims: readonly SheetClaim[], roster: readonly string[]) {
  for (const claim of claims) addClaim(box, claim, roster);
}

function sourceLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host.endsWith("rollingstone.com")) return "Rolling Stone";
    if (host.endsWith("pitchfork.com")) return "Pitchfork";
    if (host.endsWith("nme.com")) return "NME";
    if (host.endsWith("allmusic.com")) return "AllMusic";
    if (host.endsWith("genius.com")) return "Genius";
    return host;
  } catch {
    return "Article";
  }
}

function bandClaimsFromProfile(profile: MusicBrainzArtistProfile, artistName: string): SheetClaim[] {
  const sourceUrl = `https://musicbrainz.org/artist/${profile.id}`;
  const claims: SheetClaim[] = [];
  const subject = spokenArtistName(artistName, profile.name);
  const isPerson = (profile.type ?? "").toLowerCase() === "person";
  const spokenName = subject.replace(/[.!?]+$/g, "");
  const placeOk = profile.beginArea
    && !/^(?:american|british|canadian|english|irish|australian|scottish|welsh)$/i.test(profile.beginArea.trim())
    ? profile.beginArea.trim()
    : "";
  const born = placeOk && profile.beginYear
    ? `${spokenName} was born in ${placeOk} in ${profile.beginYear}`
    : placeOk
      ? `${spokenName} is from ${placeOk}`
      : profile.beginYear
        ? `${spokenName} was born in ${profile.beginYear}`
        : "";
  const origin = isPerson
    ? (born
      ? makeClaim({
          id: `origin:born:${profile.id}`,
          claim: born,
          topic: "origin",
          names: [spokenName],
          places: placeOk ? [placeOk] : [],
          years: profile.beginYear ? [profile.beginYear] : [],
          sourceName: "MusicBrainz",
          sourceUrl,
          confidence: "high",
        })
      : null)
    : originClaim({
        subject,
        place: placeOk || undefined,
        year: profile.beginYear,
        sourceName: "MusicBrainz",
        sourceUrl,
        confidence: "high",
      });
  if (origin && (!isPerson || profile.beginArea || profile.beginYear)) claims.push(origin);
  for (const sibling of profile.siblings ?? []) {
    const pair = [spokenName, sibling].sort((a, b) => a.localeCompare(b)).join(":");
    const spoken = makeClaim({
      id: `connections:sibling:${pair.toLowerCase().replace(/[^a-z0-9:]+/g, "-")}`,
      claim: `${spokenName} and ${sibling} are siblings`,
      topic: "connections",
      names: [spokenName, sibling],
      sourceName: "MusicBrainz",
      sourceUrl,
      confidence: "high",
    });
    if (spoken) claims.push(spoken);
  }
  if (isPerson) return claims;
  for (const member of profile.members) {
    const spoken = memberClaim({
      name: member.name,
      instruments: member.instruments,
      beginYear: member.beginYear,
      endYear: member.ended ? member.endYear : undefined,
      formedYear: profile.beginYear,
      sourceName: "MusicBrainz",
      sourceUrl,
      confidence: "high",
    });
    if (spoken) claims.push(spoken);
  }
  return claims;
}

function speakNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function slugId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "credit";
}

function groupedRoleClaims(input: {
  credits: Array<{ name: string; qualifier: string }>;
  kind: "producer" | "engineer";
  title: string;
  sourceUrl: string;
}): SheetClaim[] {
  const groups = new Map<string, string[]>();
  for (const credit of input.credits) {
    const name = credit.name.trim();
    if (!name) continue;
    const key = credit.qualifier || "";
    const list = groups.get(key) ?? [];
    if (!list.some((item) => item.toLowerCase() === name.toLowerCase())) list.push(name);
    groups.set(key, list);
  }
  const claims: SheetClaim[] = [];
  for (const [qualifier, names] of groups) {
    if (names.length === 0) continue;
    const who = speakNames(names);
    const plural = names.length > 1;
    let claim = "";
    if (input.kind === "producer") {
      if (qualifier === "executive") claim = `${who} ${plural ? "were" : "was"} an executive producer on ${input.title}`;
      else if (qualifier === "additional") claim = `${who} ${plural ? "were" : "was"} an additional producer on ${input.title}`;
      else if (qualifier === "assistant") claim = `${who} ${plural ? "were" : "was"} the assistant producer on ${input.title}`;
      else if (qualifier === "associate") claim = `${who} ${plural ? "were" : "was"} an associate producer on ${input.title}`;
      else if (qualifier === "co-" || plural) claim = `${who} co-produced ${input.title}`;
      else claim = `${who} produced ${input.title}`;
    } else if (qualifier === "assistant") {
      claim = `${who} ${plural ? "were" : "was"} the assistant engineer on ${input.title}`;
    } else if (qualifier === "co-") {
      claim = plural ? `${who} were co-engineers on ${input.title}` : `${who} was a co-engineer on ${input.title}`;
    } else if (qualifier === "additional") {
      claim = `${who} ${plural ? "were" : "was"} an additional engineer on ${input.title}`;
    } else if (qualifier === "associate") {
      claim = `${who} ${plural ? "were" : "was"} an associate engineer on ${input.title}`;
    } else {
      claim = `${who} engineered ${input.title}`;
    }
    const spoken = makeClaim({
      id: `album_story:${input.kind}:${slugId(`${qualifier}:${who}`)}`,
      claim,
      topic: "album_story",
      names: [...names, input.title],
      sourceName: "MusicBrainz",
      sourceUrl: input.sourceUrl,
      confidence: "high",
    });
    if (spoken) claims.push(spoken);
  }
  return claims;
}

function isAnonymousCredit(name: string): boolean {
  const clean = name.replace(/[\[\]]/g, "").trim().toLowerCase();
  return !clean || /^(?:traditional|trad\.?|unknown|anonymous|public domain)$/.test(clean);
}

function workCreditClaims(
  credits: Array<{ name: string; role: string; qualifier: string }>,
  title: string,
  sourceUrl: string,
): SheetClaim[] {
  const hasSpecific = credits.some((credit) => credit.role === "composer" || credit.role === "lyricist");
  const groups = new Map<string, { role: string; qualifier: string; names: string[] }>();
  for (const credit of credits) {
    if (hasSpecific && credit.role === "writer") continue;
    if (isAnonymousCredit(credit.name) && credits.some((other) => other.role === credit.role && !isAnonymousCredit(other.name))) continue;
    const key = `${credit.role}::${credit.qualifier}`;
    const group = groups.get(key) ?? { role: credit.role, qualifier: credit.qualifier, names: [] };
    if (!group.names.some((name) => name.toLowerCase() === credit.name.toLowerCase())) group.names.push(credit.name);
    groups.set(key, group);
  }
  const claims: SheetClaim[] = [];
  for (const group of groups.values()) {
    const people = group.names.filter((name) => !isAnonymousCredit(name));
    const who = speakNames(people);
    const plural = people.length > 1;
    let claim = "";
    if (people.length === 0) {
      if (claims.some((row) => row.claim.includes("is a traditional song"))) continue;
      claim = `${title} is a traditional song`;
    } else if (group.role === "lyricist") claim = `${who} wrote the lyrics for ${title}`;
    else if (group.role === "composer") {
      claim = group.qualifier === "additional"
        ? `${who} ${plural ? "were" : "was"} an additional composer on ${title}`
        : `${who} composed ${title}`;
    } else if (group.role === "arranger") claim = `${who} arranged ${title}`;
    else if (group.role === "orchestrator") claim = `${who} orchestrated ${title}`;
    else if (group.role === "librettist") claim = `${who} wrote the libretto for ${title}`;
    else if (group.qualifier === "additional") claim = `${who} ${plural ? "were" : "was"} an additional writer on ${title}`;
    else claim = `${who} wrote ${title}`;
    if (people.length > 0 && group.qualifier === "assistant" && group.role === "composer") {
      claim = `${who} ${plural ? "were" : "was"} an assistant composer on ${title}`;
    }
    const spoken = makeClaim({
      id: `song_story:${group.role}:${slugId(`${group.qualifier}:${who}`)}`,
      claim,
      topic: "song_story",
      names: [...people, title],
      sourceName: "MusicBrainz",
      sourceUrl,
      confidence: "high",
    });
    if (spoken) claims.push(spoken);
  }
  return claims;
}

function creditsToClaims(
  identity: MusicBrainzRecordingIdentity,
  title: string,
  artist: string,
): SheetClaim[] {
  const recordingId = identity.recordingId;
  const sourceUrl = recordingId
    ? `https://musicbrainz.org/recording/${recordingId}`
    : `https://musicbrainz.org/search?query=${encodeURIComponent(`${artist} ${title}`)}&type=recording`;
  const claims: SheetClaim[] = [];
  const producerCredits = identity.producerCredits?.length
    ? identity.producerCredits
    : (identity.producer ?? "")
      .split(/\s*,\s*|\s+\band\s+/i)
      .map((name) => name.trim())
      .filter(Boolean)
      .filter((name) => name.toLowerCase() !== artist.trim().toLowerCase())
      .map((name) => ({ name, qualifier: "" }));
  claims.push(...groupedRoleClaims({
    credits: producerCredits,
    kind: "producer",
    title,
    sourceUrl,
  }));
  const studio = identity.recordingStudio?.trim();
  if (studio && !isLiveVenueName(studio)) {
    const extra = identity.recordingStudioAdditional ? "additionally " : "";
    const spoken = makeClaim({
      id: `album_story:studio:${studio.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      claim: `${title} was ${extra}recorded at ${studio}`,
      topic: "album_story",
      names: [title],
      places: [studio],
      sourceName: "MusicBrainz",
      sourceUrl,
      confidence: "high",
    });
    if (spoken) claims.push(spoken);
  }
  const engineerCredits = identity.engineerCredits?.length
    ? identity.engineerCredits
    : (identity.engineers ?? []).map((name) => ({ name, qualifier: "" }));
  claims.push(...groupedRoleClaims({
    credits: engineerCredits,
    kind: "engineer",
    title,
    sourceUrl,
  }));
  if (identity.workCredits?.length) {
    claims.push(...workCreditClaims(identity.workCredits, title, sourceUrl));
  }
  for (const guest of identity.guests) {
    const role = specificCreditRole(guest.role);
    if (!role) continue;
    const spoken = makeClaim({
      id: `connections:${guest.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${role.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      claim: spokenCredit(guest.name, role).replace(/[.!?]+$/g, ""),
      topic: "connections",
      names: [guest.name, title],
      instruments: role.split(",").map((part) => part.trim()),
      sourceName: "MusicBrainz",
      sourceUrl,
      confidence: "high",
    });
    if (spoken) claims.push(spoken);
  }
  if (identity.releaseYear) {
    const spoken = makeClaim({
      id: "release:year",
      claim: `${title} came out in ${identity.releaseYear}`,
      topic: "release",
      names: [title],
      years: [identity.releaseYear],
      numbers: [String(identity.releaseYear)],
      sourceName: "MusicBrainz",
      sourceUrl,
      confidence: "high",
    });
    if (spoken) claims.push(spoken);
  }
  if (identity.album?.trim()) {
    const album = identity.album.trim();
    const spoken = makeClaim({
      id: "release:album",
      claim: `${title} is on ${album}`,
      topic: "release",
      names: [title, album],
      sourceName: "MusicBrainz",
      sourceUrl,
      confidence: "high",
    });
    if (spoken) claims.push(spoken);
  }
  return claims;
}

function loadBandClaims(artistName: string): Promise<SheetClaim[]> {
  const key = artistName.trim().toLowerCase();
  const existing = bandJobs.get(key);
  if (existing) return existing;
  const job = (async () => {
    const identity = await lookupMusicBrainzArtist(artistName);
    if (!identity) return [];
    const cached = bandSheets.get(identity.id);
    if (cached) return cached;
    const profile = await lookupMusicBrainzArtistProfile(identity.id);
    if (!profile) return [];
    const box: SheetBox = { artistId: identity.id, claims: [], passages: [] };
    const mbClaims = bandClaimsFromProfile(profile, artistName);
    addMany(box, mbClaims, []);
    const roster = profile.members.map((member) => member.name);
    const isPerson = (profile.type ?? identity.type ?? "").toLowerCase() === "person";
    const spokenName = spokenArtistName(artistName, profile.name || artistName);
    const [wiki, data] = await Promise.all([
      wikipediaClaimsFor({
        subject: spokenName,
        kind: "band",
        titleHint: profile.wikipediaTitle,
        allowedPeople: roster,
      }).catch(() => [] as SheetClaim[]),
      profile.wikidataId
        ? (isPerson
          ? wikidataPersonOrigin({ qid: profile.wikidataId, name: spokenName })
          : wikidataBandClaims({
              qid: profile.wikidataId,
              bandName: spokenName,
              allowedPeople: roster.length ? roster : null,
            })
        ).catch(() => [] as SheetClaim[])
        : Promise.resolve([] as SheetClaim[]),
    ]);
    addMany(box, data, roster);
    addMany(box, wiki, roster.length ? roster : rosterNames(box.claims));
    const bandOnly = box.claims.filter((claim) =>
      claim.topic === "members" || claim.topic === "origin" || claim.topic === "band_said" || claim.topic === "connections",
    );
    const saved = bandOnly.length ? bandOnly : [...box.claims];
    bandSheets.set(identity.id, saved);
    return saved;
  })().catch(() => [] as SheetClaim[]);
  bandJobs.set(key, job);
  return job;
}

async function fillBand(box: SheetBox, artistName: string): Promise<void> {
  const claims = await loadBandClaims(artistName);
  if (claims.length === 0) {
    const identity = await lookupMusicBrainzArtist(artistName);
    if (identity) box.artistId = identity.id;
    return;
  }
  addMany(box, claims, rosterNames(claims));
  const identity = await lookupMusicBrainzArtist(artistName);
  if (identity) box.artistId = identity.id;
}

async function fillSong(box: SheetBox, artist: string, title: string, album?: string): Promise<void> {
  const itunesPromise = lookupITunesTrack(artist, title).catch(() => null);
  const recording = box.artistId
    ? await lookupMusicBrainzRecordingIdentity(artist, title, {
        artistId: box.artistId,
        studioMaster: true,
        ...(album ? { album } : {}),
      }).catch(() => null)
    : null;
  if (recording) {
    box.recordingId = recording.recordingId;
    addMany(box, creditsToClaims(recording, title, artist), rosterNames(box.claims));
  }
  const itunes = await itunesPromise;
  const itunesAlbum = itunes?.album?.replace(/\s+/g, " ").trim() ?? "";
  const itunesClean = Boolean(itunesAlbum) && !isLaterEditionTitle(itunesAlbum);
  const albumTitle = [album?.trim(), recording?.album?.trim(), itunesClean ? itunesAlbum : ""]
    .map((value) => value?.replace(/\s+/g, " ").trim() ?? "")
    .find((value) => value && !isLaterEditionTitle(value)) ?? "";
  if (!box.claims.some((claim) => claim.id === "release:year") && itunes?.releaseYear && itunesClean) {
    addClaim(box, makeClaim({
      id: "release:year",
      claim: `${title} came out in ${itunes.releaseYear}`,
      topic: "release",
      names: [title],
      years: [itunes.releaseYear],
      numbers: [String(itunes.releaseYear)],
      sourceName: "iTunes",
      sourceUrl: "https://itunes.apple.com",
      confidence: "high",
    }), []);
  }
  if (!box.claims.some((claim) => claim.id === "release:album") && albumTitle) {
    addClaim(box, makeClaim({
      id: "release:album",
      claim: `${title} is on ${albumTitle}`,
      topic: "release",
      names: [title, albumTitle],
      sourceName: recording?.album ? "MusicBrainz" : "iTunes",
      sourceUrl: recording?.recordingId
        ? `https://musicbrainz.org/recording/${recording.recordingId}`
        : "https://itunes.apple.com",
      confidence: "high",
    }), []);
  }
  if (itunes?.trackNumber && itunes.trackNumber > 0 && itunes.trackNumber < 100) {
    addClaim(box, makeClaim({
      id: "release:position",
      claim: `${title} is track ${itunes.trackNumber}`,
      topic: "release",
      names: [title],
      numbers: [String(itunes.trackNumber)],
      sourceName: "iTunes",
      sourceUrl: "https://itunes.apple.com",
      confidence: "high",
    }), []);
  }
  const roster = rosterNames(box.claims);
  let artistHost = "";
  if (box.artistId) {
    const profile = await lookupMusicBrainzArtistProfile(box.artistId).catch(() => null);
    artistHost = officialHost(profile?.officialUrl);
  }
  const [albumPage, songPage] = await Promise.all([
    albumTitle
      ? wikipediaStoryFor({
          subject: albumTitle,
          kind: "album",
          artistName: artist,
          allowedPeople: roster,
        }).catch(() => ({ claims: [] as SheetClaim[], passage: null, links: [] as string[] }))
      : Promise.resolve({ claims: [] as SheetClaim[], passage: null, links: [] as string[] }),
    wikipediaStoryFor({
      subject: title,
      kind: "song",
      artistName: artist,
      allowedPeople: roster,
    }).catch(() => ({ claims: [] as SheetClaim[], passage: null, links: [] as string[] })),
  ]);
  addMany(box, albumPage.claims, roster);
  addMany(box, songPage.claims, roster);
  for (const story of [songPage, albumPage]) {
    if (!story.passage) continue;
    addPassage(box, {
      sourceName: "Wikipedia",
      url: story.passage.url,
      title: story.passage.title,
      text: story.passage.text,
    });
  }
  const links = [...songPage.links, ...albumPage.links];
  const articleUrl = pickAllowlistedArticle(links, artistHost);
  if (articleUrl) {
    const text = await readLinkedPage(articleUrl, 320);
    addPassage(box, text ? {
      sourceName: sourceLabel(articleUrl),
      url: articleUrl,
      title: sourceLabel(articleUrl),
      text,
    } : null);
  }
  const geniusUrl = pickGeniusLink(links);
  if (geniusUrl) {
    const text = await readLinkedPage(geniusUrl, 120);
    addPassage(box, text ? {
      sourceName: "Genius",
      url: geniusUrl,
      title: "Meaning",
      text,
    } : null);
  }
}

function startJob(artist: string, title: string, album?: string): { box: SheetBox; promise: Promise<void> } {
  const key = songKey(artist, title, album);
  const existing = jobs.get(key);
  if (existing) return existing;
  const box: SheetBox = { claims: [], passages: [] };
  const promise = (async () => {
    const saved = readSourcePack(artist, title);
    if (saved) {
      box.claims = saved.claims;
      box.passages = saved.passages;
      return;
    }
    await fillBand(box, artist);
    await fillSong(box, artist, title, album);
    writeSourcePack(artist, title, box.claims, box.passages);
  })().catch(() => undefined);
  const job = { box, promise };
  jobs.set(key, job);
  return job;
}

function sourcesOf(claims: readonly SheetClaim[]): Array<{ name: string; url: string }> {
  const out: Array<{ name: string; url: string }> = [];
  const seen = new Set<string>();
  for (const claim of claims) {
    const key = `${claim.sourceName}::${claim.sourceUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: claim.sourceName, url: claim.sourceUrl });
  }
  return out;
}

/**
 * Wait up to `waitMs`, then return whatever is already true.
 * The lookup keeps going in the background so the next song can reuse it.
 */
export async function loadBreakSheet(input: {
  artist: string;
  title: string;
  album?: string;
  next?: { artist: string; title: string; album?: string };
  waitMs: number;
}): Promise<BreakSheet> {
  const artist = input.artist.trim();
  const title = input.title.trim();
  if (!artist || !title) {
    return { claims: [], nextClaims: [], passages: [], sources: [] };
  }
  const started = Date.now();
  const waitMs = Math.max(0, input.waitMs);
  const job = startJob(artist, title, input.album);
  const next = input.next?.artist?.trim() && input.next.title?.trim()
    ? startJob(input.next.artist, input.next.title, input.next.album)
    : null;
  await Promise.race([
    job.promise,
    new Promise<void>((resolve) => setTimeout(resolve, waitMs)),
  ]);
  const left = Math.max(0, waitMs - (Date.now() - started));
  if (next && left > 0) {
    await Promise.race([
      next.promise,
      new Promise<void>((resolve) => setTimeout(resolve, left)),
    ]);
  }
  return {
    claims: [...job.box.claims],
    nextClaims: next ? [...next.box.claims] : [],
    passages: [...job.box.passages],
    ...(job.box.artistId ? { artistId: job.box.artistId } : {}),
    ...(job.box.recordingId ? { recordingId: job.box.recordingId } : {}),
    sources: sourcesOf(job.box.claims),
  };
}

export function clearSheetCache(): void {
  bandSheets.clear();
  bandJobs.clear();
  jobs.clear();
}

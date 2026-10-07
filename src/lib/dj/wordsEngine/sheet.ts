/**
 * The fact sheet for one song.
 * The band sheet is saved in memory and reused for the rest of the station.
 * MusicBrainz stays at one request a second. If time runs out, the claims
 * already in hand are what the host may say.
 */

import { isLiveVenueName } from "@/lib/catalog/recordingPlace";
import {
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
import { wikipediaClaimsFor, wikidataBandClaims, wikidataPersonOrigin } from "./wiki";

export type BreakSheet = {
  claims: SheetClaim[];
  nextClaims: SheetClaim[];
  artistId?: string;
  recordingId?: string;
  sources: Array<{ name: string; url: string }>;
};

type SheetBox = {
  claims: SheetClaim[];
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
  box.claims.push(claim);
}

function addMany(box: SheetBox, claims: readonly SheetClaim[], roster: readonly string[]) {
  for (const claim of claims) addClaim(box, claim, roster);
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
  const producer = identity.producer?.trim();
  if (producer) {
    const people = producer
      .split(/\s*,\s*|\s+\band\s+/i)
      .map((name) => name.trim())
      .filter(Boolean);
    const named = people.filter((name) => name.toLowerCase() !== artist.trim().toLowerCase());
    const speakers = (named.length ? named : people).slice(0, 4);
    for (const name of speakers) {
      const spoken = makeClaim({
        id: `album_story:producer:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        claim: `${name} produced ${title}`,
        topic: "album_story",
        names: [name, title],
        sourceName: "MusicBrainz",
        sourceUrl,
        confidence: "high",
      });
      if (spoken) claims.push(spoken);
    }
  }
  const studio = identity.recordingStudio?.trim();
  if (studio && !isLiveVenueName(studio)) {
    const spoken = makeClaim({
      id: `album_story:studio:${studio.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      claim: `${title} was recorded at ${studio}`,
      topic: "album_story",
      names: [title],
      places: [studio],
      sourceName: "MusicBrainz",
      sourceUrl,
      confidence: "high",
    });
    if (spoken) claims.push(spoken);
  }
  for (const engineer of identity.engineers ?? []) {
    const spoken = makeClaim({
      id: `album_story:engineer:${engineer.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      claim: `${engineer} engineered ${title}`,
      topic: "album_story",
      names: [engineer, title],
      sourceName: "MusicBrainz",
      sourceUrl,
      confidence: "high",
    });
    if (spoken) claims.push(spoken);
  }
  for (const guest of identity.guests) {
    const spoken = makeClaim({
      id: `connections:${guest.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${guest.role.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      claim: `${guest.name} is credited on ${title} for ${guest.role}`,
      topic: "connections",
      names: [guest.name, title],
      instruments: guest.role.split(",").map((part) => part.trim()),
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
    const box: SheetBox = { artistId: identity.id, claims: [] };
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
  const albumTitle = album?.trim() || recording?.album?.trim() || itunes?.album?.trim() || "";
  if (!box.claims.some((claim) => claim.id === "release:year") && itunes?.releaseYear) {
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
  const [albumPage, songPage] = await Promise.all([
    albumTitle
      ? wikipediaClaimsFor({
          subject: albumTitle,
          kind: "album",
          artistName: artist,
          allowedPeople: roster,
        }).catch(() => [] as SheetClaim[])
      : Promise.resolve([] as SheetClaim[]),
    wikipediaClaimsFor({
      subject: title,
      kind: "song",
      artistName: artist,
      allowedPeople: roster,
    }).catch(() => [] as SheetClaim[]),
  ]);
  addMany(box, albumPage, roster);
  addMany(box, songPage, roster);
}

function startJob(artist: string, title: string, album?: string): { box: SheetBox; promise: Promise<void> } {
  const key = songKey(artist, title, album);
  const existing = jobs.get(key);
  if (existing) return existing;
  const box: SheetBox = { claims: [] };
  const promise = (async () => {
    await fillBand(box, artist);
    await fillSong(box, artist, title, album);
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
    return { claims: [], nextClaims: [], sources: [] };
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

/**
 * Lightweight MusicBrainz client — ISRC lookup and confirmed release-year
 * dating for era-lock admission. Never invents an ISRC or year.
 *
 * MusicBrainz asks for ≤ 1 request / second and a descriptive User-Agent.
 */

import { isLiveVenueName, isStudioRecordingPlace } from "@/lib/catalog/recordingPlace";
import { parseReleaseYear } from "@/lib/queue/builder";

const MUSICBRAINZ_ENDPOINT = "https://musicbrainz.org/ws/2";
const MIN_INTERVAL_MS = 1100;
const LOOKUP_CACHE_LIMIT = 256;

export type MusicBrainzRecording = {
  isrc?: string;
  releaseYear?: number;
  album?: string;
  /** Producer names from a recording's artist relationships. Absent when none were returned. */
  producer?: string;
  /** A "recorded at" place from a recording's place relationships. */
  recordingStudio?: string;
  /** Engineer names from a recording's artist relationships. */
  engineers?: string[];
  /** Producer credits with the qualifier MusicBrainz actually stored. */
  producerCredits?: MusicBrainzRoleCredit[];
  /** Engineer credits with the qualifier MusicBrainz actually stored. */
  engineerCredits?: MusicBrainzRoleCredit[];
  /** True when the only studio place is marked additional. */
  recordingStudioAdditional?: boolean;
};

export type MusicBrainzLookupOptions = {
  /**
   * Also read producer, engineer, and recorded-at place.
   * Uses MusicBrainz `inc=artist-rels+place-rels` on the recording lookup.
   * Default callers (catalog dating, play logs) stay on the short lookup.
   */
  includeRelationships?: boolean;
  /**
   * New words only. Prefer an official studio master.
   * Live and bootleg recordings are not used, so a concert place
   * cannot be filed as the studio for a studio-album track.
   */
  studioMaster?: boolean;
  /**
   * Album already known for this track (row or store lookup).
   * Credits are kept only when this recording is on that album.
   */
  album?: string;
};

type MbIsrc = string;
type MbReleaseGroup = {
  title?: string;
  "secondary-types"?: string[];
};
type MbRelease = {
  title?: string;
  date?: string;
  status?: string;
  "release-group"?: MbReleaseGroup;
};
type MbNamed = { name?: string; type?: string; disambiguation?: string };

type MbRelation = {
  type?: string;
  attributes?: string[];
  artist?: MbNamed;
  place?: MbNamed;
  work?: { id?: string; title?: string };
};

type MbRecording = {
  id?: string;
  title?: string;
  disambiguation?: string;
  firstReleaseDate?: string;
  "first-release-date"?: string;
  isrcs?: MbIsrc[];
  releases?: MbRelease[];
  relations?: MbRelation[];
  /** Present on some payloads. Never treated as a fact. */
  tags?: Array<{ name?: string }>;
};

type MbSearchResponse = {
  recordings?: MbRecording[];
} & MbRecording;

const lookupCache = new Map<string, MusicBrainzRecording | null>();
let lastRequestAt = 0;
let requestChain: Promise<void> = Promise.resolve();

function musicBrainzUserAgent(): string {
  return (
    process.env.MUSICBRAINZ_USER_AGENT?.trim() ||
    "SongHost/1.0 (https://songhost.app; statutory-radio catalog)"
  );
}

function lookupKey(artist: string, title: string): string {
  return `${artist.trim().toLowerCase()}::${title.trim().toLowerCase()}`;
}

function remember(key: string, value: MusicBrainzRecording | null): MusicBrainzRecording | null {
  if (lookupCache.size >= LOOKUP_CACHE_LIMIT) {
    const oldest = lookupCache.keys().next().value;
    if (oldest) lookupCache.delete(oldest);
  }
  lookupCache.set(key, value);
  return value;
}

function escapeLucene(value: string): string {
  return value.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&");
}

function pickReleaseYear(recording: MbRecording): number | undefined {
  const first =
    recording.firstReleaseDate ||
    recording["first-release-date"] ||
    recording.releases?.find((release) => release.date)?.date;
  return parseReleaseYear(first);
}

function foldTitle(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titlesMatch(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  return shorter.length >= 4 && longer.includes(shorter);
}

function albumSearchTerm(album: string | undefined): string {
  return (album ?? "")
    .replace(/[([{].*$/g, "")
    .replace(/\s+[-–—]\s+.*$/g, "")
    .trim();
}

function releaseLooksLive(release: MbRelease): boolean {
  const status = (release.status ?? "").trim().toLowerCase();
  if (status === "bootleg" || status === "pseudo-release") return true;
  const secondary = release["release-group"]?.["secondary-types"] ?? [];
  if (secondary.some((type) => type.trim().toLowerCase() === "live")) return true;
  return /\blive\b/i.test(release.title ?? "");
}

/** A concert take or a bootleg. Its place is not the studio album's studio. */
function isLiveOrBootlegRecording(recording: MbRecording): boolean {
  const disambiguation = cleanRelationName(recording.disambiguation).toLowerCase();
  if (/\blive\b/.test(disambiguation)) return true;
  const releases = recording.releases ?? [];
  if (releases.length === 0) return false;
  return releases.every(releaseLooksLive);
}

function releaseTitleMatches(recording: MbRecording, album: string): boolean {
  const hint = foldTitle(album);
  if (!hint) return false;
  return (recording.releases ?? []).some((release) => {
    if (releaseLooksLive(release)) return false;
    return titlesMatch(foldTitle(release.title), hint);
  });
}

function pickAlbum(recording: MbRecording, options?: MusicBrainzLookupOptions): string | undefined {
  if (options?.studioMaster) {
    const hint = albumSearchTerm(options.album);
    if (hint) {
      const match = recording.releases?.find(
        (release) => !releaseLooksLive(release) && titlesMatch(foldTitle(release.title), foldTitle(hint)),
      );
      return match?.title?.trim() || undefined;
    }
    const studioRelease = recording.releases?.find(
      (release) => release.title?.trim() && !releaseLooksLive(release),
    );
    return studioRelease?.title?.trim() || undefined;
  }
  const title = recording.releases?.find((release) => release.title?.trim())?.title?.trim();
  return title || undefined;
}

function chooseRecording(
  recordings: MbRecording[] | undefined,
  options: MusicBrainzLookupOptions,
): MbRecording | undefined {
  const list = recordings ?? [];
  if (!options.studioMaster) return list[0];
  const studioTakes = list.filter((recording) => !isLiveOrBootlegRecording(recording));
  if (studioTakes.length === 0) return undefined;
  const album = albumSearchTerm(options.album);
  if (!album) return studioTakes[0];
  return studioTakes.find((recording) => releaseTitleMatches(recording, album));
}

function recordingSearchQuery(
  title: string,
  artist: string,
  options: MusicBrainzLookupOptions,
): string {
  const parts = [
    `recording:"${escapeLucene(title)}"`,
    `AND artist:"${escapeLucene(artist)}"`,
  ];
  if (options.studioMaster) {
    parts.push("AND status:official", "AND NOT comment:live");
    const album = albumSearchTerm(options.album);
    if (album) parts.push(`AND release:"${escapeLucene(album)}"`);
  }
  return parts.join(" ");
}

function lookupCacheKey(
  artist: string,
  title: string,
  options: MusicBrainzLookupOptions,
): string {
  return [
    lookupKey(artist, title),
    options.includeRelationships ? "rels" : "short",
    options.studioMaster ? "studio" : "any",
    foldTitle(albumSearchTerm(options.album)),
  ].join("::");
}

function pickIsrc(recording: MbRecording): string | undefined {
  const isrc = recording.isrcs?.find((code) => typeof code === "string" && code.trim().length >= 12);
  return isrc?.trim().toUpperCase();
}

const MAX_RELATION_NAMES = 4;

function cleanRelationName(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function uniqueRelationNames(names: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const clean = cleanRelationName(name);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= MAX_RELATION_NAMES) break;
  }
  return out;
}

export type MusicBrainzRoleCredit = {
  name: string;
  /** assistant, co-, additional, executive, associate — empty when the source gives none. */
  qualifier: string;
};

export type MusicBrainzWorkCredit = {
  name: string;
  /** MusicBrainz relationship type: composer, lyricist, writer, arranger, orchestrator, librettist. */
  role: string;
  qualifier: string;
};

function relationQualifier(type: string, attributes: readonly string[]): string {
  const value = type.trim().toLowerCase();
  const attrs = attributes.map((item) => item.trim().toLowerCase());
  if (value.startsWith("assistant") || attrs.includes("assistant")) return "assistant";
  if (value.startsWith("co-") || value.startsWith("co ") || attrs.includes("co") || attrs.includes("co-")) return "co-";
  if (value.startsWith("additional") || attrs.includes("additional")) return "additional";
  if (value.includes("executive") || attrs.includes("executive")) return "executive";
  if (attrs.includes("associate") || value.startsWith("associate")) return "associate";
  return "";
}

function isEngineerRelation(type: string | undefined): boolean {
  const value = (type ?? "").trim().toLowerCase();
  return value === "engineer"
    || value.endsWith(" engineer")
    || value.endsWith("-engineer");
}

function isProducerRelation(type: string | undefined): boolean {
  const value = (type ?? "").trim().toLowerCase();
  return value === "producer" || value.endsWith(" producer") || value.endsWith("-producer");
}

function roleCredits(
  relations: readonly MbRelation[],
  keep: (type: string | undefined) => boolean,
): MusicBrainzRoleCredit[] {
  const out: MusicBrainzRoleCredit[] = [];
  const seen = new Set<string>();
  for (const rel of relations) {
    if (!keep(rel.type)) continue;
    const name = cleanRelationName(rel.artist?.name);
    if (!name) continue;
    const qualifier = relationQualifier(rel.type ?? "", rel.attributes ?? []);
    const key = `${name.toLowerCase()}::${qualifier}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, qualifier });
    if (out.length >= MAX_RELATION_NAMES) break;
  }
  return out;
}

/**
 * Producer, engineer, and recording place from a MusicBrainz recording payload.
 * Vocal, instrument, and tag lists are ignored. Genre is not a fact.
 */
export function readMusicBrainzRecordingCredits(
  recording: { relations?: MbRelation[] } | null | undefined,
): {
  producer?: string;
  recordingStudio?: string;
  recordingStudioAdditional?: boolean;
  engineers: string[];
  producerCredits: MusicBrainzRoleCredit[];
  engineerCredits: MusicBrainzRoleCredit[];
} {
  const relations = recording?.relations ?? [];
  const producerCredits = roleCredits(relations, isProducerRelation);
  const engineerCredits = roleCredits(relations, isEngineerRelation);
  const producers = uniqueRelationNames(producerCredits.map((credit) => credit.name));
  const engineers = uniqueRelationNames(engineerCredits.map((credit) => credit.name));
  const studios: Array<{ name: string; additional: boolean }> = [];
  for (const rel of relations) {
    if ((rel.type ?? "").trim().toLowerCase() !== "recorded at") continue;
    const name = cleanRelationName(rel.place?.name);
    if (!name) continue;
    if (!isStudioRecordingPlace({
      name,
      type: rel.place?.type,
      attributes: rel.attributes,
    })) {
      continue;
    }
    const extra = cleanRelationName(rel.place?.disambiguation);
    const extraIsPlace = extra && extra.length <= 40 && !/\d/.test(extra) && !isLiveVenueName(extra);
    const additional = (rel.attributes ?? []).some((item) => item.trim().toLowerCase() === "additional");
    studios.push({
      name: extraIsPlace ? `${name}, ${extra}` : name,
      additional,
    });
  }
  const chosen = studios.find((place) => !place.additional) ?? studios[0];
  return {
    ...(producers.length ? { producer: producers.join(", ") } : {}),
    ...(chosen ? { recordingStudio: chosen.name, recordingStudioAdditional: chosen.additional } : {}),
    engineers,
    producerCredits,
    engineerCredits,
  };
}

/** `inc` for a recording lookup. Relationship includes are opt-in. */
export function musicBrainzRecordingInc(includeRelationships: boolean): string {
  return includeRelationships
    ? "isrcs+releases+artist-rels+place-rels"
    : "isrcs+releases";
}

async function throttle(): Promise<void> {
  const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt));
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastRequestAt = Date.now();
}

async function musicBrainzGet<T = MbSearchResponse>(path: string, query: URLSearchParams): Promise<T | null> {
  const run = requestChain.then(async () => {
    await throttle();
    const url = `${MUSICBRAINZ_ENDPOINT}${path}?${query.toString()}`;
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": musicBrainzUserAgent(),
        },
        next: { revalidate: 3600 },
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch (error) {
      console.warn("[musicbrainz] request failed:", error);
      return null;
    }
  });

  requestChain = run.then(() => undefined, () => undefined);
  return run;
}

function recordedPlacesAreAllLive(recording: MbRecording): boolean {
  const places = (recording.relations ?? []).filter(
    (rel) => (rel.type ?? "").trim().toLowerCase() === "recorded at" && cleanRelationName(rel.place?.name),
  );
  if (places.length === 0) return false;
  return places.every((rel) => !isStudioRecordingPlace({
    name: rel.place?.name,
    type: rel.place?.type,
    attributes: rel.attributes,
  }));
}

function mapRecording(
  recording: MbRecording | undefined,
  options?: MusicBrainzLookupOptions,
): MusicBrainzRecording | null {
  if (!recording) return null;
  const isrc = pickIsrc(recording);
  const releaseYear = pickReleaseYear(recording);
  const album = pickAlbum(recording, options);
  const credits = readMusicBrainzRecordingCredits(recording);
  const albumHint = albumSearchTerm(options?.album);
  const creditsMatch = !options?.studioMaster
    || (!recordedPlacesAreAllLive(recording)
      && (!albumHint || releaseTitleMatches(recording, albumHint)));
  const producer = creditsMatch ? credits.producer : undefined;
  const recordingStudio = creditsMatch ? credits.recordingStudio : undefined;
  const recordingStudioAdditional = creditsMatch ? credits.recordingStudioAdditional : undefined;
  const engineers = creditsMatch ? credits.engineers : [];
  const producerCredits = creditsMatch ? credits.producerCredits : [];
  const engineerCredits = creditsMatch ? credits.engineerCredits : [];
  if (!isrc && !releaseYear && !album && !producer && !recordingStudio && engineers.length === 0) {
    return null;
  }
  return {
    ...(isrc ? { isrc } : {}),
    ...(releaseYear ? { releaseYear } : {}),
    ...(album ? { album } : {}),
    ...(producer ? { producer } : {}),
    ...(recordingStudio ? { recordingStudio } : {}),
    ...(recordingStudioAdditional ? { recordingStudioAdditional } : {}),
    ...(engineers.length ? { engineers } : {}),
    ...(producerCredits.length ? { producerCredits } : {}),
    ...(engineerCredits.length ? { engineerCredits } : {}),
  };
}

/**
 * Look up a recording by artist + title. Returns ISRC and/or a confirmed
 * first-release year when MusicBrainz has them — never a guessed date.
 * Pass `includeRelationships` to also read producer, engineer, and
 * recorded-at place from the recording's public relationship includes.
 */
export async function lookupMusicBrainzRecording(
  artist: string,
  title: string,
  options?: MusicBrainzLookupOptions,
): Promise<MusicBrainzRecording | null> {
  const cleanArtist = artist.trim();
  const cleanTitle = title.trim();
  if (!cleanArtist || !cleanTitle) return null;

  const lookupOptions: MusicBrainzLookupOptions = {
    includeRelationships: options?.includeRelationships === true,
    studioMaster: options?.studioMaster === true,
    ...(options?.album?.trim() ? { album: options.album } : {}),
  };
  const key = lookupCacheKey(cleanArtist, cleanTitle, lookupOptions);
  if (lookupCache.has(key)) return lookupCache.get(key) ?? null;

  const query = new URLSearchParams({
    query: recordingSearchQuery(cleanTitle, cleanArtist, lookupOptions),
    fmt: "json",
    limit: lookupOptions.studioMaster ? "10" : "1",
  });

  const data = await musicBrainzGet("/recording/", query);
  let recording = chooseRecording(data?.recordings, lookupOptions);
  if (!recording) return remember(key, null);

  const mbid = recording.id?.trim();
  const wantDetail = Boolean(mbid && (lookupOptions.includeRelationships || !pickIsrc(recording)));
  if (mbid && wantDetail) {
    const detail = await musicBrainzGet(`/recording/${encodeURIComponent(mbid)}`, new URLSearchParams({
      fmt: "json",
      inc: musicBrainzRecordingInc(lookupOptions.includeRelationships === true),
    }));
    if (detail) recording = { ...recording, ...detail };
  }

  return remember(key, mapRecording(recording, lookupOptions));
}

/** Attach MusicBrainz ISRC / year onto catalog rows that are missing them. */
export async function enrichTracksWithMusicBrainz<
  T extends {
    artist?: string;
    artists?: readonly string[];
    title?: string;
    name?: string;
    isrc?: string;
    releaseYear?: number;
    album?: string;
  },
>(
  tracks: readonly T[],
  options?: { limit?: number },
): Promise<T[]> {
  const budget = Math.max(0, options?.limit ?? 5);
  if (!budget) return [...tracks];

  const out = [...tracks];
  let used = 0;
  for (let i = 0; i < out.length && used < budget; i += 1) {
    const row = out[i];
    if (!row) continue;
    if (row.isrc?.trim() && row.releaseYear) continue;
    const title = (row.title ?? row.name ?? "").trim();
    const artist = (row.artist ?? row.artists?.[0] ?? "").trim();
    if (!title || !artist) continue;

    const meta = await lookupMusicBrainzRecording(artist, title);
    used += 1;
    if (!meta) continue;

    out[i] = {
      ...row,
      ...(meta.isrc && !row.isrc ? { isrc: meta.isrc } : {}),
      ...(meta.releaseYear && !row.releaseYear ? { releaseYear: meta.releaseYear } : {}),
      ...(meta.album && !row.album ? { album: meta.album } : {}),
    };
  }
  return out;
}

export type MusicBrainzArtistHit = {
  id?: string;
  name?: string;
  score?: number;
  type?: string;
  disambiguation?: string;
};

/**
 * Lock a band to one MusicBrainz artist.
 * The name must match exactly, so The National cannot become The National Parks.
 */
export function pickMusicBrainzArtist(
  query: string,
  hits: readonly MusicBrainzArtistHit[],
): MusicBrainzArtistHit | null {
  const want = foldTitle(query);
  if (!want) return null;
  const exact = hits.filter((hit) => foldTitle(hit.name) === want && Boolean(hit.id?.trim()));
  if (exact.length === 0) return null;
  const ranked = [...exact].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return ranked[0] ?? null;
}

export type MusicBrainzArtistIdentity = {
  id: string;
  name: string;
  disambiguation?: string;
  type?: string;
};

export type MusicBrainzMember = {
  name: string;
  id?: string;
  instruments: string[];
  beginYear?: number;
  endYear?: number;
  ended: boolean;
};

export type MusicBrainzArtistProfile = {
  id: string;
  name: string;
  type?: string;
  beginYear?: number;
  beginArea?: string;
  wikidataId?: string;
  wikipediaTitle?: string;
  members: MusicBrainzMember[];
  siblings?: string[];
};

export type MusicBrainzGuestCredit = {
  name: string;
  role: string;
};

export type MusicBrainzRecordingIdentity = MusicBrainzRecording & {
  recordingId?: string;
  artistId?: string;
  releaseGroupId?: string;
  guests: MusicBrainzGuestCredit[];
  /** Composer, lyricist, and writer credits from the linked work. Role is the MusicBrainz type. */
  workCredits?: MusicBrainzWorkCredit[];
};

const artistIdentityCache = new Map<string, MusicBrainzArtistIdentity | null>();
const artistProfileCache = new Map<string, MusicBrainzArtistProfile | null>();
const recordingIdentityCache = new Map<string, MusicBrainzRecordingIdentity | null>();

function yearFromDate(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.match(/\b(\d{4})\b/);
  if (!match) return undefined;
  const year = Number(match[1]);
  if (!Number.isInteger(year) || year < 1900 || year > 2035) return undefined;
  return year;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function readStringField(row: Record<string, unknown> | null, key: string): string {
  const value = row?.[key];
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function readMusicBrainzMembers(
  relations: unknown,
): MusicBrainzMember[] {
  if (!Array.isArray(relations)) return [];
  const members: MusicBrainzMember[] = [];
  const seen = new Set<string>();
  for (const entry of relations) {
    const rel = asRecord(entry);
    if (!rel) continue;
    const type = readStringField(rel, "type").toLowerCase();
    if (type !== "member of band") continue;
    const artist = asRecord(rel.artist);
    const name = readStringField(artist, "name");
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const attributes = Array.isArray(rel.attributes)
      ? rel.attributes.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    const ended = rel.ended === true || Boolean(readStringField(rel, "end"));
    members.push({
      name,
      ...(readStringField(artist, "id") ? { id: readStringField(artist, "id") } : {}),
      instruments: attributes.map((item) => item.trim()),
      ...(yearFromDate(rel.begin) ? { beginYear: yearFromDate(rel.begin) } : {}),
      ...(yearFromDate(rel.end) ? { endYear: yearFromDate(rel.end) } : {}),
      ended,
    });
    if (members.length >= 12) break;
  }
  return members;
}

export function readMusicBrainzSiblings(relations: unknown): string[] {
  if (!Array.isArray(relations)) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of relations) {
    const rel = asRecord(entry);
    if (!rel) continue;
    if (readStringField(rel, "type").toLowerCase() !== "sibling") continue;
    const artist = asRecord(rel.artist);
    const name = readStringField(artist, "name");
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= 4) break;
  }
  return names;
}

function wikipediaTitleFromUrl(resource: string): string | undefined {
  try {
    const url = new URL(resource);
    if (!url.hostname.endsWith("wikipedia.org")) return undefined;
    const marker = "/wiki/";
    const idx = url.pathname.indexOf(marker);
    if (idx < 0) return undefined;
    const title = decodeURIComponent(url.pathname.slice(idx + marker.length)).replace(/_/g, " ").trim();
    return title || undefined;
  } catch {
    return undefined;
  }
}

function wikidataIdFromUrl(resource: string): string | undefined {
  const match = resource.match(/wikidata\.org\/(?:wiki\/)?(Q\d+)/i);
  return match?.[1];
}

export function readMusicBrainzArtistLinks(relations: unknown): {
  wikidataId?: string;
  wikipediaTitle?: string;
} {
  if (!Array.isArray(relations)) return {};
  let wikidataId: string | undefined;
  let wikipediaTitle: string | undefined;
  for (const entry of relations) {
    const rel = asRecord(entry);
    const url = asRecord(rel?.url ?? null);
    const resource = readStringField(url, "resource");
    if (!resource) continue;
    wikidataId = wikidataId ?? wikidataIdFromUrl(resource);
    wikipediaTitle = wikipediaTitle ?? wikipediaTitleFromUrl(resource);
  }
  return {
    ...(wikidataId ? { wikidataId } : {}),
    ...(wikipediaTitle ? { wikipediaTitle } : {}),
  };
}

const GUEST_RELATION = new Set(["vocal", "instrument", "performer"]);

export function readMusicBrainzGuests(
  relations: unknown,
  bandName: string,
): MusicBrainzGuestCredit[] {
  if (!Array.isArray(relations)) return [];
  const band = foldTitle(bandName);
  const guests: MusicBrainzGuestCredit[] = [];
  const seen = new Set<string>();
  for (const entry of relations) {
    const rel = asRecord(entry);
    if (!rel) continue;
    const type = readStringField(rel, "type").toLowerCase();
    if (!GUEST_RELATION.has(type)) continue;
    const artist = asRecord(rel.artist);
    const name = readStringField(artist, "name");
    if (!name || foldTitle(name) === band) continue;
    const attributes = Array.isArray(rel.attributes)
      ? rel.attributes.filter((item): item is string => typeof item === "string")
      : [];
    const specific = attributes.map((item) => item.trim()).filter((item) => item && !/^(?:instrument|instruments|performer|guest|credit|additional|other)$/i.test(item));
    const role = specific.length
      ? specific.join(", ")
      : type === "vocal"
        ? "vocals"
        : "";
    if (!role) continue;
    const key = `${name.toLowerCase()}::${role.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    guests.push({ name, role });
    if (guests.length >= 6) break;
  }
  return guests;
}

const WORK_ROLES = new Set(["composer", "lyricist", "writer", "arranger", "orchestrator", "librettist"]);

/** Composer stays composer. Lyricist stays lyricist. A qualifier on the relationship is kept. */
export function readMusicBrainzWorkCredits(relations: unknown): MusicBrainzWorkCredit[] {
  if (!Array.isArray(relations)) return [];
  const out: MusicBrainzWorkCredit[] = [];
  const seen = new Set<string>();
  for (const entry of relations) {
    const rel = asRecord(entry);
    if (!rel) continue;
    const role = readStringField(rel, "type").toLowerCase();
    if (!WORK_ROLES.has(role)) continue;
    const artist = asRecord(rel.artist);
    const name = readStringField(artist, "name");
    if (!name) continue;
    const attributes = Array.isArray(rel.attributes)
      ? rel.attributes.filter((item): item is string => typeof item === "string")
      : [];
    const qualifier = relationQualifier(role, attributes);
    const key = `${role}::${qualifier}::${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, role, qualifier });
    if (out.length >= 8) break;
  }
  return out;
}

function artistCreditMatches(
  recording: Record<string, unknown>,
  artistId: string | undefined,
  artistName: string,
): boolean {
  const credits = recording["artist-credit"];
  if (!Array.isArray(credits) || credits.length === 0) return true;
  const wantName = foldTitle(artistName);
  return credits.some((entry) => {
    const credit = asRecord(entry);
    const artist = asRecord(credit?.artist ?? null);
    const id = readStringField(artist, "id");
    const name = readStringField(artist, "name") || readStringField(credit, "name");
    if (artistId && id === artistId) return true;
    return foldTitle(name) === wantName;
  });
}

export type MusicBrainzBrowseSong = {
  recordingId: string;
  title: string;
  artist: string;
  disambiguation?: string;
  durationMs?: number;
};

type MbBrowseCredit = { name?: string; artist?: { name?: string } };
type MbBrowseRecording = {
  id?: string;
  title?: string;
  length?: number;
  disambiguation?: string;
  "artist-credit"?: MbBrowseCredit[];
};
type MbBrowseResponse = {
  "recording-count"?: number;
  recordings?: MbBrowseRecording[];
};

function browseCreditName(recording: MbBrowseRecording): string {
  const credits = recording["artist-credit"] ?? [];
  const names = credits
    .map((credit) => credit.artist?.name?.trim() || credit.name?.trim() || "")
    .filter(Boolean);
  return names.join(", ");
}

/**
 * Page an artist's recordings. MusicBrainz browse allows `limit` up to 100
 * and an `offset` up to `recording-count`.
 */
export async function browseMusicBrainzRecordings(
  artistId: string,
  limit = 25,
  offset = 0,
): Promise<{ songs: MusicBrainzBrowseSong[]; rawCount: number; total: number } | null> {
  const id = artistId.trim();
  if (!id) return null;
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit) || 1));
  const safeOffset = Math.max(0, Math.floor(offset) || 0);
  const data = await musicBrainzGet<MbBrowseResponse>(
    "/recording",
    new URLSearchParams({
      artist: id,
      fmt: "json",
      limit: String(safeLimit),
      offset: String(safeOffset),
    }),
  );
  if (!data) return null;
  const recordings = data.recordings ?? [];
  const songs: MusicBrainzBrowseSong[] = [];
  for (const recording of recordings) {
    const title = recording.title?.trim();
    const recordingId = recording.id?.trim();
    const artist = browseCreditName(recording);
    if (!title || !recordingId || !artist) continue;
    const disambiguation = recording.disambiguation?.trim();
    songs.push({
      recordingId,
      title,
      artist,
      ...(disambiguation ? { disambiguation } : {}),
      ...(typeof recording.length === "number" && recording.length > 0
        ? { durationMs: recording.length }
        : {}),
    });
  }
  return {
    songs,
    rawCount: recordings.length,
    total: typeof data["recording-count"] === "number" ? data["recording-count"] : recordings.length,
  };
}

export async function lookupMusicBrainzArtist(
  name: string,
): Promise<MusicBrainzArtistIdentity | null> {
  const clean = name.trim();
  if (!clean) return null;
  const key = `artist::${foldTitle(clean)}`;
  if (artistIdentityCache.has(key)) return artistIdentityCache.get(key) ?? null;
  const data = await musicBrainzGet<{ artists?: MusicBrainzArtistHit[] }>(
    "/artist/",
    new URLSearchParams({
      query: `artist:"${escapeLucene(clean)}"`,
      fmt: "json",
      limit: "8",
    }),
  );
  if (!data) return null;
  const hit = pickMusicBrainzArtist(clean, data.artists ?? []);
  const identity = hit?.id && hit.name
    ? {
        id: hit.id,
        name: hit.name,
        ...(hit.disambiguation ? { disambiguation: hit.disambiguation } : {}),
        ...(hit.type ? { type: hit.type } : {}),
      }
    : null;
  artistIdentityCache.set(key, identity);
  return identity;
}

export async function lookupMusicBrainzArtistProfile(
  artistId: string,
): Promise<MusicBrainzArtistProfile | null> {
  const id = artistId.trim();
  if (!id) return null;
  if (artistProfileCache.has(id)) return artistProfileCache.get(id) ?? null;
  const data = await musicBrainzGet<Record<string, unknown>>(
    `/artist/${encodeURIComponent(id)}`,
    new URLSearchParams({
      fmt: "json",
      inc: "artist-rels+url-rels",
    }),
  );
  if (!data) return null;
  const life = asRecord(data["life-span"]);
  const area = asRecord(data["begin-area"]);
  const links = readMusicBrainzArtistLinks(data.relations);
  const profile: MusicBrainzArtistProfile = {
    id,
    name: readStringField(data, "name"),
    ...(readStringField(data, "type") ? { type: readStringField(data, "type") } : {}),
    ...(yearFromDate(life?.begin) ? { beginYear: yearFromDate(life?.begin) } : {}),
    ...(readStringField(area, "name") ? { beginArea: readStringField(area, "name") } : {}),
    ...links,
    members: readMusicBrainzMembers(data.relations),
    siblings: readMusicBrainzSiblings(data.relations),
  };
  artistProfileCache.set(id, profile);
  return profile;
}

/**
 * Studio-master recording locked to the artist id when we have one.
 * Live and bootleg places stay out, same as the existing credit lookup.
 */
export async function lookupMusicBrainzRecordingIdentity(
  artist: string,
  title: string,
  options?: MusicBrainzLookupOptions & { artistId?: string },
): Promise<MusicBrainzRecordingIdentity | null> {
  const cleanArtist = artist.trim();
  const cleanTitle = title.trim();
  if (!cleanArtist || !cleanTitle) return null;
  const lookupOptions: MusicBrainzLookupOptions = {
    includeRelationships: true,
    studioMaster: options?.studioMaster !== false,
    ...(options?.album?.trim() ? { album: options.album } : {}),
  };
  const key = `id::${lookupCacheKey(cleanArtist, cleanTitle, lookupOptions)}::${options?.artistId ?? ""}`;
  if (recordingIdentityCache.has(key)) return recordingIdentityCache.get(key) ?? null;

  const data = await musicBrainzGet<{ recordings?: MbRecording[] }>(
    "/recording/",
    new URLSearchParams({
      query: recordingSearchQuery(cleanTitle, cleanArtist, lookupOptions),
      fmt: "json",
      limit: "10",
    }),
  );
  if (!data) return null;
  const recordings = (data.recordings ?? []).filter((recording) => {
    const row = recording as unknown as Record<string, unknown>;
    return artistCreditMatches(row, options?.artistId, cleanArtist);
  });
  let recording = chooseRecording(recordings, lookupOptions);
  if (!recording?.id) {
    recordingIdentityCache.set(key, null);
    return null;
  }
  const detail = await musicBrainzGet<MbRecording>(
    `/recording/${encodeURIComponent(recording.id)}`,
    new URLSearchParams({
      fmt: "json",
      inc: `${musicBrainzRecordingInc(true)}+work-rels`,
    }),
  );
  if (detail) recording = { ...recording, ...detail };
  const workId = (recording.relations ?? [])
    .map((rel) => ((rel.type ?? "").trim().toLowerCase() === "performance" ? rel.work?.id?.trim() ?? "" : ""))
    .find((id) => id.length > 0) ?? "";
  let workCredits: MusicBrainzWorkCredit[] = [];
  if (workId) {
    const work = await musicBrainzGet<Record<string, unknown>>(
      `/work/${encodeURIComponent(workId)}`,
      new URLSearchParams({ fmt: "json", inc: "artist-rels" }),
    );
    workCredits = readMusicBrainzWorkCredits(work?.relations);
  }
  const mapped = mapRecording(recording, lookupOptions);
  const releaseGroup = recording.releases?.find((release) => !releaseLooksLive(release))?.["release-group"] as
    | { id?: string }
    | undefined;
  const identity: MusicBrainzRecordingIdentity = {
    ...(mapped ?? {}),
    recordingId: recording.id,
    ...(options?.artistId ? { artistId: options.artistId } : {}),
    ...(releaseGroup?.id ? { releaseGroupId: releaseGroup.id } : {}),
    guests: readMusicBrainzGuests(recording.relations, cleanArtist),
    ...(workCredits.length ? { workCredits } : {}),
  };
  recordingIdentityCache.set(key, identity);
  return identity;
}

export function clearMusicBrainzCache(): void {
  lookupCache.clear();
  artistIdentityCache.clear();
  artistProfileCache.clear();
  recordingIdentityCache.clear();
}

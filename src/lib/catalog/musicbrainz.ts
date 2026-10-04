/**
 * Lightweight MusicBrainz client — ISRC lookup and confirmed release-year
 * dating for era-lock admission. Never invents an ISRC or year.
 *
 * MusicBrainz asks for ≤ 1 request / second and a descriptive User-Agent.
 */

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
};

export type MusicBrainzLookupOptions = {
  /**
   * Also read producer, engineer, and recorded-at place.
   * Uses MusicBrainz `inc=artist-rels+place-rels` on the recording lookup.
   * Default callers (catalog dating, play logs) stay on the short lookup.
   */
  includeRelationships?: boolean;
};

type MbIsrc = string;
type MbRelease = { title?: string; date?: string };
type MbNamed = { name?: string; disambiguation?: string };

type MbRelation = {
  type?: string;
  attributes?: string[];
  artist?: MbNamed;
  place?: MbNamed;
};

type MbRecording = {
  id?: string;
  title?: string;
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

function pickAlbum(recording: MbRecording): string | undefined {
  const title = recording.releases?.find((release) => release.title?.trim())?.title?.trim();
  return title || undefined;
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

function isEngineerRelation(type: string | undefined): boolean {
  const value = (type ?? "").trim().toLowerCase();
  return value === "engineer" || value.endsWith(" engineer");
}

/**
 * Producer, engineer, and recording place from a MusicBrainz recording payload.
 * Vocal, instrument, and tag lists are ignored. Genre is not a fact.
 */
export function readMusicBrainzRecordingCredits(
  recording: { relations?: MbRelation[] } | null | undefined,
): { producer?: string; recordingStudio?: string; engineers: string[] } {
  const relations = recording?.relations ?? [];
  const producers = uniqueRelationNames(
    relations
      .filter((rel) => (rel.type ?? "").trim().toLowerCase() === "producer")
      .map((rel) => rel.artist?.name ?? ""),
  );
  const engineers = uniqueRelationNames(
    relations
      .filter((rel) => isEngineerRelation(rel.type))
      .map((rel) => rel.artist?.name ?? ""),
  );
  let recordingStudio: string | undefined;
  for (const rel of relations) {
    if ((rel.type ?? "").trim().toLowerCase() !== "recorded at") continue;
    const name = cleanRelationName(rel.place?.name);
    if (!name) continue;
    const extra = cleanRelationName(rel.place?.disambiguation);
    recordingStudio = extra && extra.length <= 40 && !/\d/.test(extra)
      ? `${name}, ${extra}`
      : name;
    break;
  }
  return {
    ...(producers.length ? { producer: producers.join(", ") } : {}),
    ...(recordingStudio ? { recordingStudio } : {}),
    engineers,
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

async function musicBrainzGet(path: string, query: URLSearchParams): Promise<MbSearchResponse | null> {
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
      return (await res.json()) as MbSearchResponse;
    } catch (error) {
      console.warn("[musicbrainz] request failed:", error);
      return null;
    }
  });

  requestChain = run.then(() => undefined, () => undefined);
  return run;
}

function mapRecording(recording: MbRecording | undefined): MusicBrainzRecording | null {
  if (!recording) return null;
  const isrc = pickIsrc(recording);
  const releaseYear = pickReleaseYear(recording);
  const album = pickAlbum(recording);
  const credits = readMusicBrainzRecordingCredits(recording);
  if (
    !isrc
    && !releaseYear
    && !album
    && !credits.producer
    && !credits.recordingStudio
    && credits.engineers.length === 0
  ) {
    return null;
  }
  return {
    ...(isrc ? { isrc } : {}),
    ...(releaseYear ? { releaseYear } : {}),
    ...(album ? { album } : {}),
    ...(credits.producer ? { producer: credits.producer } : {}),
    ...(credits.recordingStudio ? { recordingStudio: credits.recordingStudio } : {}),
    ...(credits.engineers.length ? { engineers: credits.engineers } : {}),
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

  const includeRelationships = options?.includeRelationships === true;
  const key = lookupKey(cleanArtist, cleanTitle) + (includeRelationships ? "::rels" : "");
  if (lookupCache.has(key)) return lookupCache.get(key) ?? null;

  const query = new URLSearchParams({
    query: `recording:"${escapeLucene(cleanTitle)}" AND artist:"${escapeLucene(cleanArtist)}"`,
    fmt: "json",
    limit: "1",
  });

  const data = await musicBrainzGet("/recording/", query);
  let recording = data?.recordings?.[0];
  const mbid = recording?.id?.trim();
  const wantDetail = Boolean(recording && mbid && (includeRelationships || !pickIsrc(recording)));
  if (recording && mbid && wantDetail) {
    const detail = await musicBrainzGet(`/recording/${encodeURIComponent(mbid)}`, new URLSearchParams({
      fmt: "json",
      inc: musicBrainzRecordingInc(includeRelationships),
    }));
    if (detail) recording = { ...recording, ...detail };
  }

  return remember(key, mapRecording(recording));
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

export function clearMusicBrainzCache(): void {
  lookupCache.clear();
}

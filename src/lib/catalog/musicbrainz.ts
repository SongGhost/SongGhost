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
};

type MbIsrc = string;
type MbRelease = { title?: string; date?: string };
type MbRecording = {
  id?: string;
  title?: string;
  firstReleaseDate?: string;
  "first-release-date"?: string;
  isrcs?: MbIsrc[];
  releases?: MbRelease[];
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
  if (!isrc && !releaseYear && !album) return null;
  return {
    ...(isrc ? { isrc } : {}),
    ...(releaseYear ? { releaseYear } : {}),
    ...(album ? { album } : {}),
  };
}

/**
 * Look up a recording by artist + title. Returns ISRC and/or a confirmed
 * first-release year when MusicBrainz has them — never a guessed date.
 */
export async function lookupMusicBrainzRecording(
  artist: string,
  title: string,
): Promise<MusicBrainzRecording | null> {
  const cleanArtist = artist.trim();
  const cleanTitle = title.trim();
  if (!cleanArtist || !cleanTitle) return null;

  const key = lookupKey(cleanArtist, cleanTitle);
  if (lookupCache.has(key)) return lookupCache.get(key) ?? null;

  const query = new URLSearchParams({
    query: `recording:"${escapeLucene(cleanTitle)}" AND artist:"${escapeLucene(cleanArtist)}"`,
    fmt: "json",
    limit: "1",
  });

  const data = await musicBrainzGet("/recording/", query);
  let recording = data?.recordings?.[0];
  const mbid = recording?.id?.trim();
  if (recording && mbid && !pickIsrc(recording)) {
    const detail = await musicBrainzGet(`/recording/${encodeURIComponent(mbid)}`, new URLSearchParams({
      fmt: "json",
      inc: "isrcs+releases",
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

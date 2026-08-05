import type { StationTrack } from "@/data/stations";
import { isValidRadioTrack } from "@/lib/queue/builder";
import { isAcceptableCatalogTrack } from "@/lib/track-quality";
import { isValidYouTubeVideoId } from "@/lib/youtube/ids";

type YouTubeSearchItem = {
  id: { videoId: string };
  snippet: { title: string; channelTitle: string };
};

type YouTubeVideoStatusItem = {
  id?: string;
  status?: {
    embeddable?: boolean;
    privacyStatus?: string;
  };
};

type YouTubeVideoDetailsItem = {
  id?: string;
  contentDetails?: { duration?: string };
  status?: {
    embeddable?: boolean;
    privacyStatus?: string;
  };
};

/** Search hit with optional duration for catalog quality gating. */
export type YouTubeSearchHit = StationTrack & {
  durationSeconds?: number;
};

/** YouTube Data API Music category — excludes sermons, podcasts, vlogs, etc. */
export const YOUTUBE_MUSIC_CATEGORY_ID = "10";

const INNERTUBE_CLIENT = {
  clientName: "WEB",
  clientVersion: "2.20240101.00.00",
};

const embeddableCache = new Map<string, boolean>();
const EMBEDDABLE_CACHE_MAX = 500;

function cleanVideoTitle(title: string): string {
  return title
    .replace(/\s*\(official.*?\)/gi, "")
    .replace(/\s*\[official.*?\]/gi, "")
    .replace(/\s*-\s*official.*$/gi, "")
    .trim();
}

function parseInnertubeTitle(field: unknown): string {
  if (!field || typeof field !== "object") return "";
  const runs = (field as { runs?: { text?: string }[] }).runs;
  return runs?.[0]?.text?.trim() ?? (field as { simpleText?: string }).simpleText?.trim() ?? "";
}

/** Parse "3:45" / "1:02:03" length labels from Innertube. */
export function parseClockDuration(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const parts = trimmed.split(":").map((part) => Number(part));
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n))) {
    return undefined;
  }
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
}

/** Parse YouTube Data API ISO-8601 durations (e.g. PT3M45S, PT1H2M3S). */
export function parseIso8601Duration(iso: string): number | undefined {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(iso.trim());
  if (!match) return undefined;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  if (![hours, minutes, seconds].every(Number.isFinite)) return undefined;
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Prefer official music uploads / YouTube Music Topic channels over livestreams,
 * sermons, and unrelated hijacks that share a title keyword.
 */
export function buildMusicSearchQueries(artist: string, title: string): string[] {
  const cleanArtist = artist.trim();
  const cleanTitle = title.trim();
  const base = `${cleanArtist} - ${cleanTitle}`;
  return [`${base} Official Audio`, `${base} Topic`];
}

function readInnertubeLengthSeconds(video: Record<string, unknown>): number | undefined {
  const lengthText = video.lengthText;
  if (!lengthText || typeof lengthText !== "object") return undefined;
  const simple = (lengthText as { simpleText?: string }).simpleText;
  if (typeof simple === "string") return parseClockDuration(simple);
  return undefined;
}

function extractVideosFromInnertube(data: unknown): YouTubeSearchHit[] {
  const tracks: YouTubeSearchHit[] = [];
  const seen = new Set<string>();

  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    const obj = node as Record<string, unknown>;
    if (obj.videoRenderer && typeof obj.videoRenderer === "object") {
      const video = obj.videoRenderer as Record<string, unknown>;
      const videoId = typeof video.videoId === "string" ? video.videoId : "";
      if (!videoId || seen.has(videoId) || !isValidYouTubeVideoId(videoId)) return;

      const title = parseInnertubeTitle(video.title) || "Unknown";
      const artist =
        parseInnertubeTitle(video.ownerText) ||
        parseInnertubeTitle(video.longBylineText) ||
        "Unknown";
      const durationSeconds = readInnertubeLengthSeconds(video);

      seen.add(videoId);
      tracks.push({
        youtubeId: videoId,
        title: cleanVideoTitle(title) || title,
        artist,
        durationSeconds,
      });
      return;
    }

    for (const value of Object.values(obj)) walk(value);
  };

  walk(data);
  return tracks;
}

async function searchInnertube(query: string, maxResults: number): Promise<YouTubeSearchHit[]> {
  try {
    const res = await fetch("https://www.youtube.com/youtubei/v1/search?prettyPrint=false", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({
        context: { client: INNERTUBE_CLIENT },
        query,
      }),
      next: { revalidate: 300 },
    });

    if (!res.ok) return [];
    const data = await res.json();
    return filterCatalogHits(extractVideosFromInnertube(data)).slice(0, maxResults);
  } catch {
    return [];
  }
}

async function fetchVideoDurations(
  videoIds: string[],
  apiKey: string,
): Promise<Map<string, number>> {
  const durations = new Map<string, number>();
  if (!videoIds.length) return durations;

  const params = new URLSearchParams({
    part: "contentDetails",
    id: videoIds.join(","),
    key: apiKey,
  });

  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`,
      { next: { revalidate: 3600 } },
    );
    if (!res.ok) return durations;

    const data = (await res.json()) as { items?: YouTubeVideoDetailsItem[] };
    for (const item of data.items ?? []) {
      const id = item.id;
      const iso = item.contentDetails?.duration;
      if (!id || !iso) continue;
      const seconds = parseIso8601Duration(iso);
      if (seconds !== undefined) durations.set(id, seconds);
    }
  } catch {
    // Duration enrichment is best-effort; title blacklist still applies.
  }

  return durations;
}

function filterCatalogHits(hits: YouTubeSearchHit[]): YouTubeSearchHit[] {
  return hits.filter(
    (hit) =>
      isAcceptableCatalogTrack({
        title: hit.title,
        durationSeconds: hit.durationSeconds,
      }) && isValidRadioTrack(hit.title, hit.artist),
  );
}

async function searchYouTubeApi(query: string, maxResults: number): Promise<YouTubeSearchHit[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return [];

  // Over-fetch so duration/title rejects still leave a full candidate pool.
  const fetchCount = Math.min(Math.max(maxResults * 2, maxResults), 50);
  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    videoEmbeddable: "true",
    videoCategoryId: YOUTUBE_MUSIC_CATEGORY_ID,
    maxResults: String(fetchCount),
    order: "relevance",
    q: query,
    key: apiKey,
  });

  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/search?${params.toString()}`,
    { next: { revalidate: 3600 } },
  );
  if (!res.ok) return [];

  const data = (await res.json()) as { items?: YouTubeSearchItem[] };
  const tracks: YouTubeSearchHit[] = [];
  const seen = new Set<string>();

  for (const item of data.items ?? []) {
    const videoId = item.id?.videoId;
    if (!videoId || seen.has(videoId) || !isValidYouTubeVideoId(videoId)) continue;
    seen.add(videoId);
    tracks.push({
      youtubeId: videoId,
      title: cleanVideoTitle(item.snippet.title) || item.snippet.title,
      artist: item.snippet.channelTitle,
    });
  }

  const durations = await fetchVideoDurations(
    tracks.map((t) => t.youtubeId),
    apiKey,
  );
  for (const track of tracks) {
    const seconds = durations.get(track.youtubeId);
    if (seconds !== undefined) track.durationSeconds = seconds;
  }

  return filterCatalogHits(tracks).slice(0, maxResults);
}

export async function searchYouTubeVideos(
  query: string,
  maxResults = 10,
): Promise<YouTubeSearchHit[]> {
  const apiResults = await searchYouTubeApi(query, maxResults);
  if (apiResults.length) return apiResults;
  return searchInnertube(query, maxResults);
}

async function checkEmbeddableViaApi(videoId: string, apiKey: string): Promise<boolean> {
  const params = new URLSearchParams({
    part: "status",
    id: videoId,
    key: apiKey,
  });

  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`,
      { next: { revalidate: 3600 } },
    );
    if (!res.ok) return false;

    const data = (await res.json()) as { items?: YouTubeVideoStatusItem[] };
    const item = data.items?.[0];
    return item?.status?.embeddable === true && item.status.privacyStatus === "public";
  } catch {
    return false;
  }
}

async function checkEmbeddableViaOEmbed(videoId: string): Promise<boolean> {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${videoId}`,
  )}&format=json`;

  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    return res.ok;
  } catch {
    return false;
  }
}

/** Verify a video ID is embeddable in third-party players before queueing it. */
export async function isEmbeddableYouTubeVideo(videoId: string): Promise<boolean> {
  if (!isValidYouTubeVideoId(videoId)) return false;

  const cached = embeddableCache.get(videoId);
  if (cached !== undefined) return cached;

  const apiKey = process.env.YOUTUBE_API_KEY;
  const embeddable = apiKey
    ? await checkEmbeddableViaApi(videoId, apiKey)
    : await checkEmbeddableViaOEmbed(videoId);

  if (embeddableCache.size >= EMBEDDABLE_CACHE_MAX) {
    const oldest = embeddableCache.keys().next().value;
    if (oldest) embeddableCache.delete(oldest);
  }
  embeddableCache.set(videoId, embeddable);
  return embeddable;
}

export function markVideoUnembeddable(videoId: string): void {
  if (!isValidYouTubeVideoId(videoId)) return;
  embeddableCache.set(videoId, false);
}

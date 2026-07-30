import type { StationTrack } from "@/data/stations";
import { scoreVideoMatch } from "@/lib/track-quality";
import { isValidYouTubeVideoId } from "@/lib/youtube";

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

function extractVideosFromInnertube(data: unknown): StationTrack[] {
  const tracks: StationTrack[] = [];
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

      seen.add(videoId);
      tracks.push({
        youtubeId: videoId,
        title: cleanVideoTitle(title) || title,
        artist,
      });
      return;
    }

    for (const value of Object.values(obj)) walk(value);
  };

  walk(data);
  return tracks;
}

async function searchInnertube(query: string, maxResults: number): Promise<StationTrack[]> {
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
    return extractVideosFromInnertube(data).slice(0, maxResults);
  } catch {
    return [];
  }
}

async function searchYouTubeApi(query: string, maxResults: number): Promise<StationTrack[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return [];

  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    videoEmbeddable: "true",
    maxResults: String(Math.min(maxResults, 50)),
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
  const tracks: StationTrack[] = [];
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

  return tracks;
}

export async function searchYouTubeVideos(
  query: string,
  maxResults = 10,
): Promise<StationTrack[]> {
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

export async function resolveTrackVideoId(artist: string, title: string): Promise<string | null> {
  const results = await searchYouTubeVideos(`${artist} ${title} official`, 8);
  if (!results.length) return null;

  const ranked = [...results].sort(
    (a, b) => scoreVideoMatch(b, artist, title) - scoreVideoMatch(a, artist, title),
  );

  for (const candidate of ranked) {
    const videoId = candidate.youtubeId?.trim();
    if (!isValidYouTubeVideoId(videoId)) continue;
    if (scoreVideoMatch(candidate, artist, title) <= 0) continue;
    if (await isEmbeddableYouTubeVideo(videoId)) return videoId;
  }

  return null;
}

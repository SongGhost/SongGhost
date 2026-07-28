import type { StationTrack } from "@/data/stations";

type YouTubeSearchItem = {
  id: { videoId: string };
  snippet: { title: string; channelTitle: string };
};

const INNERTUBE_CLIENT = {
  clientName: "WEB",
  clientVersion: "2.20240101.00.00",
};

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
      if (!videoId || seen.has(videoId)) return;

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
    if (!videoId || seen.has(videoId)) continue;
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

export async function resolveTrackVideoId(artist: string, title: string): Promise<string | null> {
  const results = await searchYouTubeVideos(`${artist} ${title} official`, 3);
  return results[0]?.youtubeId ?? null;
}

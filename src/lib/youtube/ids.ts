export function extractYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([\w-]{11})/,
    /^([\w-]{11})$/,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

/** YouTube video IDs are always 11 characters from this alphabet. */
export function isValidYouTubeVideoId(videoId: string | undefined | null): videoId is string {
  return typeof videoId === "string" && /^[\w-]{11}$/.test(videoId.trim());
}

/** YouTube CDN thumbnail quality ladders. Prefer `hq` for cards; `maxres` is not always published. */
export type YouTubeThumbQuality = "default" | "mq" | "hq" | "sd" | "maxres";

const THUMB_FILE: Record<YouTubeThumbQuality, string> = {
  default: "default.jpg",
  mq: "mqdefault.jpg",
  hq: "hqdefault.jpg",
  sd: "sddefault.jpg",
  maxres: "maxresdefault.jpg",
};

export function getYouTubeThumbnail(
  videoId: string,
  quality: YouTubeThumbQuality = "hq",
): string {
  return `https://i.ytimg.com/vi/${videoId}/${THUMB_FILE[quality]}`;
}

/**
 * When a YouTube CDN thumb 404s, step down one quality tier:
 * hqdefault.jpg → mqdefault.jpg → default.jpg.
 * Higher published files (maxres / sd) enter the ladder at hq.
 * Returns null when the URL is not i.ytimg.com or the ladder is exhausted.
 */
const YT_THUMB_FALLBACK_FILES = ["hqdefault.jpg", "mqdefault.jpg", "default.jpg"] as const;

const YT_THUMB_FILE_RANK: Record<string, number> = {
  "maxresdefault.jpg": -2,
  "sddefault.jpg": -1,
  "hqdefault.jpg": 0,
  "mqdefault.jpg": 1,
  "default.jpg": 2,
};

export function nextYouTubeThumbnailFallback(src: string): string | null {
  const trimmed = src.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.hostname !== "i.ytimg.com") return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 3 || parts[0] !== "vi") return null;

  const videoId = parts[1];
  const file = parts[2];
  if (!videoId || !file) return null;

  const rank = YT_THUMB_FILE_RANK[file];
  const nextIndex = rank === undefined ? 0 : rank < 0 ? 0 : rank + 1;
  if (nextIndex >= YT_THUMB_FALLBACK_FILES.length) return null;

  return `https://i.ytimg.com/vi/${videoId}/${YT_THUMB_FALLBACK_FILES[nextIndex]}`;
}

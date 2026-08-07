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

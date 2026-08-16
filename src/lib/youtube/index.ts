export {
  extractYouTubeId,
  getYouTubeThumbnail,
  isValidYouTubeVideoId,
  nextYouTubeThumbnailFallback,
} from "@/lib/youtube/ids";

export {
  buildMusicSearchQueries,
  isEmbeddableYouTubeVideo,
  markVideoUnembeddable,
  parseClockDuration,
  parseIso8601Duration,
  searchYouTubeVideos,
  YOUTUBE_MUSIC_CATEGORY_ID,
  type YouTubeSearchHit,
} from "@/lib/youtube/youtube-search";

export {
  catalogDurationFromMs,
  isDurationWithinTolerance,
  MAX_DURATION_MISMATCH_SEC,
  resolveTrackVideoId,
} from "@/lib/youtube/resolver";

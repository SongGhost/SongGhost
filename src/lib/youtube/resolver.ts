import { isValidRadioTrack } from "@/lib/queue/builder";
import {
  durationMsToSeconds,
  isAcceptableCatalogTrack,
  scoreVideoMatch,
} from "@/lib/track-quality";
import { isValidYouTubeVideoId } from "@/lib/youtube/ids";
import {
  buildMusicSearchQueries,
  isEmbeddableYouTubeVideo,
  searchYouTubeVideos,
  type YouTubeSearchHit,
} from "@/lib/youtube/youtube-search";

/** Max absolute difference between catalog and YouTube duration before reject. */
export const MAX_DURATION_MISMATCH_SEC = 25;

/**
 * True when YouTube length is close enough to the catalog length, or when
 * either side is unknown (so title/embed gates can still accept a candidate).
 */
export function isDurationWithinTolerance(
  youtubeDurationSec: number | undefined,
  catalogDurationSec: number | undefined,
): boolean {
  if (
    catalogDurationSec == null ||
    !Number.isFinite(catalogDurationSec) ||
    catalogDurationSec <= 0
  ) {
    return true;
  }
  if (
    youtubeDurationSec == null ||
    !Number.isFinite(youtubeDurationSec) ||
    youtubeDurationSec <= 0
  ) {
    return true;
  }
  return Math.abs(youtubeDurationSec - catalogDurationSec) <= MAX_DURATION_MISMATCH_SEC;
}

async function pickEmbeddableMatch(
  results: YouTubeSearchHit[],
  artist: string,
  title: string,
  excludeIds: ReadonlySet<string>,
  catalogDurationSec: number | undefined,
): Promise<string | null> {
  if (!results.length) return null;

  const ranked = [...results].sort(
    (a, b) => scoreVideoMatch(b, artist, title) - scoreVideoMatch(a, artist, title),
  );

  for (const candidate of ranked) {
    const videoId = candidate.youtubeId?.trim();
    if (!isValidYouTubeVideoId(videoId)) continue;
    if (excludeIds.has(videoId)) continue;
    if (
      !isAcceptableCatalogTrack({
        title: candidate.title,
        durationSeconds: candidate.durationSeconds,
      })
    ) {
      continue;
    }
    if (!isValidRadioTrack(candidate.title, candidate.artist)) continue;
    if (!isDurationWithinTolerance(candidate.durationSeconds, catalogDurationSec)) {
      continue;
    }
    if (scoreVideoMatch(candidate, artist, title) <= 0) continue;
    if (await isEmbeddableYouTubeVideo(videoId)) return videoId;
  }

  return null;
}

/**
 * Resolve a catalog track to an embeddable YouTube video id.
 *
 * Searches Official Audio first, then Topic-channel wording. When a catalog
 * duration is known, candidates whose length differs by more than
 * {@link MAX_DURATION_MISMATCH_SEC} are skipped in favor of the next hit.
 */
export async function resolveTrackVideoId(
  artist: string,
  title: string,
  excludeIds?: ReadonlySet<string>,
  catalogDurationSec?: number,
): Promise<string | null> {
  const excluded = excludeIds ?? new Set<string>();
  const queries = buildMusicSearchQueries(artist, title);

  for (const query of queries) {
    // Over-fetch so rejected longform / blacklist / duration mismatches fall
    // through to the next candidate.
    const results = await searchYouTubeVideos(query, 20);
    const match = await pickEmbeddableMatch(
      results,
      artist,
      title,
      excluded,
      catalogDurationSec,
    );
    if (match) return match;
  }

  return null;
}

/** Convenience: accept iTunes-style milliseconds for the duration gate. */
export function catalogDurationFromMs(
  durationMs: number | null | undefined,
): number | undefined {
  return durationMsToSeconds(durationMs);
}

/**
 * Which YouTube id should be queued.
 *
 * Signal: YouTube Data API `videos.list` with `part=status,contentDetails`
 * (the same API this app already uses to confirm an embed). Not a third-party
 * scrape.
 *
 * - playable: public, embeddable, and not age-gated or region-locked.
 * - restricted: embeddable, but limited to some countries. It may still play
 *   here, so it waits behind a clean alternative. If nothing playable is left,
 *   it still queues — we do not invent a different song.
 * - blocked: embedding is off, the video is not public, the upload failed,
 *   it is age-gated (an unsigned embed sits on UNSTARTED), or this session
 *   already proved the id will not start. Drop it.
 * - uncertain: the check did not answer (slow, error, or no listing).
 *   Keep the candidate so a slow lookup cannot empty the station.
 */

export type PlaybackVerdict = "playable" | "restricted" | "blocked" | "uncertain";

export type YouTubeListing = {
  status?: {
    embeddable?: boolean;
    privacyStatus?: string;
    uploadStatus?: string;
  };
  contentDetails?: {
    regionRestriction?: { allowed?: string[]; blocked?: string[] };
    contentRating?: { ytRating?: string };
  };
};

const DEAD_UPLOAD = new Set(["deleted", "failed", "rejected"]);

export function verdictFromYouTubeListing(
  item: YouTubeListing | null | undefined,
): PlaybackVerdict {
  const status = item?.status;
  if (!status) return "uncertain";

  const upload = status.uploadStatus?.toLowerCase();
  if (upload && DEAD_UPLOAD.has(upload)) return "blocked";
  if (status.embeddable === false) return "blocked";
  if (status.privacyStatus && status.privacyStatus !== "public") return "blocked";
  if (status.embeddable !== true || status.privacyStatus !== "public") return "uncertain";

  const rating = item?.contentDetails?.contentRating?.ytRating;
  if (rating === "ytAgeRestricted") return "blocked";

  const region = item?.contentDetails?.regionRestriction;
  const regionLocked =
    (region?.allowed?.length ?? 0) > 0 || (region?.blocked?.length ?? 0) > 0;
  if (regionLocked) return "restricted";

  return "playable";
}

/**
 * Playable ids first. Known-dead and blocked ids are left out.
 * Restricted and uncertain ids stay, behind anything playable, in their
 * original order. An empty verdict map keeps the list (the check did not answer).
 */
export function preferPlayableCandidates<T extends { youtubeId?: string }>(
  items: readonly T[],
  verdicts: ReadonlyMap<string, PlaybackVerdict>,
  deadIds?: ReadonlySet<string>,
): T[] {
  const playable: T[] = [];
  const fallback: T[] = [];

  for (const item of items) {
    const id = item.youtubeId?.trim() ?? "";
    if (!id) {
      fallback.push(item);
      continue;
    }
    if (deadIds?.has(id)) continue;

    const verdict = verdicts.get(id) ?? "uncertain";
    if (verdict === "blocked") continue;
    if (verdict === "playable") playable.push(item);
    else fallback.push(item);
  }

  if (playable.length === 0) return fallback;
  return [...playable, ...fallback];
}

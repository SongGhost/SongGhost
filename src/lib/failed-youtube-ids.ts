const STORAGE_KEY = "songhost:failed-youtube-ids";
const LEGACY_STORAGE_KEY = "songghost:failed-youtube-ids";
const MAX_IDS = 120;

export function getFailedYoutubeIds(): Set<string> {
  if (typeof window === "undefined") return new Set();

  try {
    let raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      raw = sessionStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) {
        sessionStorage.setItem(STORAGE_KEY, raw);
      }
    }
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function recordFailedYoutubeId(videoId: string): void {
  if (typeof window === "undefined" || !videoId.trim()) return;

  const ids = getFailedYoutubeIds();
  ids.add(videoId.trim());
  const trimmed = [...ids].slice(-MAX_IDS);
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

/** Body field or query param. Arrays and comma strings both count. */
export function parseFailedYoutubeIds(value: unknown): Set<string> {
  if (typeof value === "string") return parseFailedYoutubeIdsParam(value);
  if (!Array.isArray(value)) return new Set();
  return parseFailedYoutubeIdsParam(
    value.filter((id): id is string => typeof id === "string").join(","),
  );
}

/** Spread onto a launch body so the next queue skips ids that already failed. */
export function failedYoutubeIdFields(): { excludeYoutubeIds?: string[] } {
  const excludeYoutubeIds = [...getFailedYoutubeIds()];
  return excludeYoutubeIds.length ? { excludeYoutubeIds } : {};
}

export function withFailedYoutubeIds(body: unknown): unknown {
  const extra = failedYoutubeIdFields();
  if (!extra.excludeYoutubeIds) return body;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return { ...body, ...extra };
  }
  return extra;
}

export function parseFailedYoutubeIdsParam(value: string | null): Set<string> {
  if (!value?.trim()) return new Set();
  return new Set(
    value
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

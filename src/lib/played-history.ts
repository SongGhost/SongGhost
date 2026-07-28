const STORAGE_KEY = "songghost-played-history";
const MAX_HISTORY = 100;

export function loadPlayedHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function savePlayedHistory(ids: string[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(0, MAX_HISTORY)));
}

export function addToPlayedHistory(youtubeId: string): string[] {
  const current = loadPlayedHistory();
  const filtered = current.filter((id) => id !== youtubeId);
  const updated = [youtubeId, ...filtered].slice(0, MAX_HISTORY);
  savePlayedHistory(updated);
  return updated;
}

export function filterUnplayedTracks<T extends { youtubeId: string }>(
  tracks: T[],
  playedIds: string[],
): T[] {
  const played = new Set(playedIds);
  return tracks.filter((t) => !played.has(t.youtubeId));
}

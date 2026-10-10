import type { Station } from "@/data/stations";
import { getYouTubeThumbnail } from "@/lib/youtube";

/** FNV-1a 32-bit. Deterministic; no Math.random. */
export function hashStationId(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function uniqueUrls(urls: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const url = raw?.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/** Same station, same day, same sleeve. The next day moves through the pool. */
export function pickDailySleeve(
  urls: readonly string[],
  stationId: string,
  daySeed: number,
): string | null {
  const pool = uniqueUrls(urls);
  if (pool.length === 0) return null;
  const n = pool.length;
  const idx = ((hashStationId(stationId) + daySeed) % n + n) % n;
  return pool[idx] ?? null;
}

/**
 * Idle-card artwork.
 * An uploaded `coverUrl` stays put. Otherwise the daily sleeve comes from the
 * album-art pool. A first paint with no pool may use one YouTube thumb.
 */
export function stationArtworkUrl(
  station: Station,
  daySeed: number,
  artPool?: readonly string[],
): string | null {
  const cover = station.coverUrl?.trim();
  if (cover) return cover;

  const fromPool = pickDailySleeve(artPool ?? [], station.id, daySeed);
  if (fromPool) return fromPool;

  const tracksWithYt = station.tracks.filter((t) => t.youtubeId?.trim());
  if (tracksWithYt.length > 0) {
    const n = tracksWithYt.length;
    const idx = ((hashStationId(station.id) + daySeed) % n + n) % n;
    return getYouTubeThumbnail(tracksWithYt[idx]!.youtubeId.trim(), "hq");
  }

  const lead = station.youtubeVideoId?.trim();
  return lead ? getYouTubeThumbnail(lead, "hq") : null;
}

/**
 * The station that is on the air shows the song that is playing.
 * Idle cards use the daily sleeve.
 */
export function resolveCardArtwork(input: {
  station: Station;
  daySeed: number;
  artPool?: readonly string[];
  isOnAir?: boolean;
  nowPlayingArtwork?: string | null;
}): string | null {
  const live = input.nowPlayingArtwork?.trim();
  if (input.isOnAir && live) return live;
  return stationArtworkUrl(input.station, input.daySeed, input.artPool);
}

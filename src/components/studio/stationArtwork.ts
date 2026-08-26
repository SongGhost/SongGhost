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

/**
 * Idle-card artwork for decade / genre / saved stations.
 * Custom `coverUrl` is fixed. Otherwise pick a YouTube thumb from a
 * deterministic daily seed so the same station + day always matches.
 */
export function stationArtworkUrl(
  station: Station,
  daySeed: number,
): string | null {
  const cover = station.coverUrl?.trim();
  if (cover) return cover;

  const tracksWithYt = station.tracks.filter((t) => t.youtubeId?.trim());
  if (tracksWithYt.length > 0) {
    const n = tracksWithYt.length;
    const idx = ((hashStationId(station.id) + daySeed) % n + n) % n;
    return getYouTubeThumbnail(tracksWithYt[idx]!.youtubeId.trim(), "hq");
  }

  const lead = station.youtubeVideoId?.trim();
  return lead ? getYouTubeThumbnail(lead, "hq") : null;
}

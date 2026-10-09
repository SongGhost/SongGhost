/**
 * Great-song titles for one artist.
 * Last.fm play counts pick them. An empty Last.fm list uses the iTunes titles
 * the caller already found. A short list stays short.
 */

import { filterGreatSongs, type LastFmTopTrack } from "@/lib/catalog/lastfm";
import { orderQueue, type Rng } from "@/lib/track-shuffle";

export function shuffleTitles(titles: readonly string[], rng: Rng = Math.random): string[] {
  const cleaned = titles.map((title) => title.trim()).filter(Boolean);
  if (cleaned.length <= 1) return cleaned;
  return orderQueue(
    cleaned.map((title) => ({
      item: title,
      rank: Number.POSITIVE_INFINITY,
      tier: 2 as const,
      isPrimaryArtist: false,
    })),
    rng,
  ).map((entry) => entry.item);
}

function looseTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function titlesLooselyMatch(a: string, b: string): boolean {
  const left = looseTitle(a);
  const right = looseTitle(b);
  return Boolean(left) && left === right;
}

export function pickGreatTitles(
  tracks: readonly LastFmTopTrack[],
  count: number,
  options?: { pinned?: string; spare?: number; rng?: Rng },
): { chosen: string[]; spare: string[] } {
  const pin = options?.pinned?.trim() ?? "";
  const great = filterGreatSongs(tracks)
    .map((track) => track.title.trim())
    .filter(Boolean);
  const rest = great.filter((title) => !pin || !titlesLooselyMatch(title, pin));
  const shuffled = shuffleTitles(rest, options?.rng);
  const wanted = Math.max(0, pin ? count - 1 : count);
  const spareCount = Math.max(0, options?.spare ?? 4);
  const chosen = shuffled.slice(0, wanted);
  const spare = shuffled.slice(wanted, wanted + spareCount);
  return { chosen: pin ? [pin, ...chosen].slice(0, count) : chosen, spare };
}

/** iTunes titles when Last.fm returned nothing. Same shuffle and spare rule. */
export function pickFallbackTitles(
  titles: readonly string[],
  count: number,
  options?: { pinned?: string; spare?: number; rng?: Rng },
): { chosen: string[]; spare: string[] } {
  const asTracks = titles
    .map((title) => title.trim())
    .filter(Boolean)
    .map((title, index) => ({ title, playcount: 1000 - index }));
  return pickGreatTitles(asTracks, count, options);
}

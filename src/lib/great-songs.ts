/**
 * Great-song titles for one artist.
 * Last.fm play counts pick them. Hits are the top of what people play.
 * One deep cut may replace a later hit. An empty Last.fm list uses the
 * iTunes titles the caller already found. A short list stays short.
 */

import { filterGreatSongs, type LastFmTopTrack } from "@/lib/catalog/lastfm";
import { isAcceptableArtistRadioTrack } from "@/lib/track-quality";
import { orderQueue, type Rng } from "@/lib/track-shuffle";

/** Songs inside the play-count floor that count as the songs people know. */
export const HIT_POOL_SIZE = 8;

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

function playableTracks(tracks: readonly LastFmTopTrack[]): LastFmTopTrack[] {
  const out: LastFmTopTrack[] = [];
  for (const track of tracks) {
    const title = track.title.trim();
    if (!title || !isAcceptableArtistRadioTrack(title)) continue;
    out.push({ title, playcount: track.playcount });
  }
  return out;
}

/**
 * Hits are the top 8 songs still inside the 20% floor.
 * Deep cuts are the rest of that floor. Junk titles are already gone.
 */
export function splitHitPool(tracks: readonly LastFmTopTrack[]): {
  hits: LastFmTopTrack[];
  deep: LastFmTopTrack[];
} {
  const great = filterGreatSongs(playableTracks(tracks));
  return {
    hits: great.slice(0, HIT_POOL_SIZE),
    deep: great.slice(HIT_POOL_SIZE),
  };
}

export function pickGreatTitles(
  tracks: readonly LastFmTopTrack[],
  count: number,
  options?: { pinned?: string; spare?: number; rng?: Rng },
): { chosen: string[]; spare: string[] } {
  const pin = options?.pinned?.trim() ?? "";
  const hits = splitHitPool(tracks)
    .hits.map((track) => track.title.trim())
    .filter(Boolean);
  const rest = hits.filter((title) => !pin || !titlesLooselyMatch(title, pin));
  const shuffled = shuffleTitles(rest, options?.rng);
  const wanted = Math.max(0, pin ? count - 1 : count);
  const spareCount = Math.max(0, options?.spare ?? 4);
  const chosen = shuffled.slice(0, wanted);
  const spare = shuffled.slice(wanted, wanted + spareCount);
  return { chosen: pin ? [pin, ...chosen].slice(0, count) : chosen, spare };
}

export type HourTitle = {
  artist: string;
  title: string;
  alt?: string[];
};

function artistKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * One deep cut in the whole hour. It replaces a later hit for an artist
 * who already has a hit earlier. An artist who appears once is left alone.
 * An empty deep list leaves the hour as it is.
 */
export function placeOneDeepCut<T extends HourTitle>(
  songs: readonly T[],
  deepByArtist: ReadonlyMap<string, readonly string[]>,
  rng: Rng = Math.random,
): T[] {
  const deep = new Map<string, string[]>();
  for (const [name, titles] of deepByArtist) {
    const key = artistKey(name);
    const bucket = deep.get(key) ?? [];
    for (const title of titles) {
      const trimmed = title.trim();
      if (trimmed) bucket.push(trimmed);
    }
    if (bucket.length) deep.set(key, bucket);
  }

  const out = songs.map((song) => ({ ...song, alt: song.alt ? [...song.alt] : undefined }));
  const firstAt = new Map<string, number>();
  const eligible: number[] = [];
  for (let index = 0; index < out.length; index += 1) {
    const key = artistKey(out[index]?.artist ?? "");
    if (!key) continue;
    if (!firstAt.has(key)) {
      firstAt.set(key, index);
      continue;
    }
    const candidates = (deep.get(key) ?? []).filter((title) => {
      return !out.some(
        (song) => artistKey(song.artist) === key && titlesLooselyMatch(song.title, title),
      );
    });
    if (candidates.length) eligible.push(index);
  }
  if (!eligible.length) return out;

  const slot = eligible[Math.min(eligible.length - 1, Math.floor(rng() * eligible.length))] ?? -1;
  const song = slot >= 0 ? out[slot] : undefined;
  if (!song) return out;
  const key = artistKey(song.artist);
  const candidates = (deep.get(key) ?? []).filter((title) => {
    return !out.some(
      (entry) => artistKey(entry.artist) === key && titlesLooselyMatch(entry.title, title),
    );
  });
  if (!candidates.length) return out;
  const picked =
    candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))] ?? "";
  if (!picked) return out;
  const replaced = song.title;
  song.title = picked;
  const alt = [replaced, ...(song.alt ?? [])].filter(
    (title, index, list) =>
      title.trim() &&
      !titlesLooselyMatch(title, picked) &&
      list.findIndex((item) => titlesLooselyMatch(item, title)) === index,
  );
  song.alt = alt;
  return out;
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

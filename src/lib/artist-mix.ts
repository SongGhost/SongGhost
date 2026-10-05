/**
 * Artist Mix launch rules.
 * The seed artist opens. A short neighbor list still plays.
 * Asking again prefers different neighbors from the same feel, when any are left.
 */

import { itunesTitlesMatch } from "@/lib/itunes";
import { primaryArtistName } from "@/lib/queue/statutory-rules";
import { artistNamesMatch, normalizeArtistName } from "@/lib/track-quality";

/**
 * How many same-feel neighbors one launch uses, so the next launch can move on.
 * Wide enough that one station is more than the old five-name circle.
 */
export const MIX_NEIGHBOR_TAKE = 12;

/** A mix opens on one playable song by the seed. The rest of the payload is neighbors. */
export const MIX_SEED_SONGS = 1;

/** Few songs per neighbor so more artists fit in one station. */
export const MIX_SONGS_PER_NEIGHBOR = 2;

const STORAGE_PREFIX = "songhost-mix-neighbors:";

const memory = new Map<string, string[]>();

export function mixNeighborKey(artist: string): string {
  return normalizeArtistName(artist);
}

export function trackIsSeedArtist(trackArtist: string, seedArtist: string): boolean {
  const seed = seedArtist.trim();
  const credited = trackArtist.trim();
  if (!seed || !credited) return false;
  if (artistNamesMatch(credited, seed)) return true;
  const primary = primaryArtistName(credited);
  return Boolean(primary) && primary !== credited && artistNamesMatch(primary, seed);
}

export function mixOpensOnSeed(
  tracks: readonly { artist: string }[],
  seedArtist: string,
): boolean {
  const lead = tracks[0];
  return Boolean(lead) && trackIsSeedArtist(lead.artist, seedArtist);
}

export function pinSeedArtistFirst<T extends { artist: string }>(
  tracks: readonly T[],
  seedArtist: string,
): T[] {
  const index = tracks.findIndex((track) => trackIsSeedArtist(track.artist, seedArtist));
  if (index <= 0) return [...tracks];
  return [tracks[index], ...tracks.slice(0, index), ...tracks.slice(index + 1)];
}

/**
 * Songs Mix / Songs Radio opener.
 * Slot 0 is the exact song the listener picked. A different song by the same
 * artist does not count. If that song is missing, the queue is empty.
 */
export function pinExactSongFirst<T extends { title: string; artist: string }>(
  tracks: readonly T[],
  seedArtist: string,
  seedTitle: string,
): T[] {
  const title = seedTitle.trim();
  if (!title) return [];
  const index = tracks.findIndex(
    (track) => itunesTitlesMatch(track.title, title) && trackIsSeedArtist(track.artist, seedArtist),
  );
  if (index < 0) return [];
  if (index === 0) return [...tracks];
  return [tracks[index], ...tracks.slice(0, index), ...tracks.slice(index + 1)];
}

/**
 * Artist Mix opener.
 * Slot 0 is a track by the seed. Neighbors stay behind it.
 * Shuffle, preview clips, and "first playable" may reorder the tail.
 * They cannot put a neighbor in front. No playable seed track means no queue.
 */
export function openOnPlayableSeed<T extends { artist: string }>(
  tracks: readonly T[],
  seedArtist: string,
  isPlayable?: (track: T) => boolean,
): T[] {
  const pool = isPlayable ? tracks.filter((track) => isPlayable(track)) : [...tracks];
  const index = pool.findIndex((track) => trackIsSeedArtist(track.artist, seedArtist));
  if (index < 0) return [];
  if (index === 0) return pool;
  return [pool[index], ...pool.slice(0, index), ...pool.slice(index + 1)];
}

/**
 * Same-feel names for this launch.
 * Skips neighbors used last time when others are left. If every name was just
 * used, the same short list plays again — it does not come back empty.
 * This is a new slice of the query, not a shuffle of the previous slice.
 */
export function selectFreshNeighbors(
  sameFeel: readonly string[],
  previous: readonly string[] = [],
  take = MIX_NEIGHBOR_TAKE,
): string[] {
  const cleaned = sameFeel.map((name) => name.trim()).filter(Boolean);
  if (cleaned.length === 0 || take <= 0) return [];

  const avoid = new Set(previous.map((name) => normalizeArtistName(name)).filter(Boolean));
  const fresh = avoid.size
    ? cleaned.filter((name) => !avoid.has(normalizeArtistName(name)))
    : cleaned;
  const pool = fresh.length > 0 ? fresh : cleaned;
  return pool.slice(0, take);
}

export function parseMixNeighborParam(value: string | null | undefined): string[] {
  if (!value?.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of value.split("|")) {
    const name = part.trim();
    const key = normalizeArtistName(name);
    if (!name || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function formatMixNeighborParam(names: readonly string[]): string {
  return parseMixNeighborParam(names.join("|")).join("|");
}

export function neighborNamesFromTracks(
  seedArtist: string,
  tracks: readonly { artist: string }[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const track of tracks) {
    const name = primaryArtistName(track.artist).trim() || track.artist.trim();
    const key = normalizeArtistName(name);
    if (!name || !key || seen.has(key)) continue;
    if (trackIsSeedArtist(name, seedArtist)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function mergeMixNeighbors(existing: readonly string[], incoming: readonly string[]): string[] {
  return neighborNamesFromTracks("", [
    ...existing.map((artist) => ({ artist })),
    ...incoming.map((artist) => ({ artist })),
  ]);
}

export function recallMixNeighbors(artist: string): string[] {
  return [...(memory.get(mixNeighborKey(artist)) ?? [])];
}

export function rememberMixNeighbors(artist: string, neighbors: readonly string[]): string[] {
  const key = mixNeighborKey(artist);
  if (!key) return [];
  const next = neighborNamesFromTracks(artist, neighbors.map((artistName) => ({ artist: artistName })));
  memory.set(key, next);
  return next;
}

export function clearMixNeighborMemory(): void {
  memory.clear();
}

export function readStoredMixNeighbors(artist: string): string[] {
  if (typeof window === "undefined" || !window.sessionStorage) return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + mixNeighborKey(artist));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parseMixNeighborParam(parsed.filter((name) => typeof name === "string").join("|"));
  } catch {
    return [];
  }
}

export function storeMixNeighbors(artist: string, neighbors: readonly string[]): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  const key = mixNeighborKey(artist);
  if (!key) return;
  try {
    const next = neighborNamesFromTracks(artist, neighbors.map((artistName) => ({ artist: artistName })));
    window.sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(next));
  } catch {
    // Private browsing can refuse storage. The request still sends whatever we had.
  }
}

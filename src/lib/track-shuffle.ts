import type { StationTrack } from "@/data/stations";
import { normalizeArtistName } from "@/lib/track-quality";

/**
 * Server-internal wrapper carrying the iTunes popularity signal alongside an item.
 * Generic because ordering runs on raw iTunes songs (before the expensive YouTube
 * resolve) and again on resolved `StationTrack`s.
 *
 * Kept out of `StationTrack` so the shared client type (queue, play history, liked
 * tracks) stays free of transport-only fields.
 */
export type Ranked<T> = {
  item: T;
  /** 0-based iTunes search index. `Infinity` for catalog-only deep cuts with no popularity signal. */
  rank: number;
  tier: 1 | 2;
  isPrimaryArtist: boolean;
};

export type RankedTrack = Ranked<StationTrack>;

export type Rng = () => number;

/** Anything orderable needs an artist for the adjacency rule. */
export type Artisted = { artist: string };

/** Rank 0-9 are the recognizable hits used for starter selection. */
export const TIER_1_SIZE = 10;

/**
 * Flattens the popularity curve so rank 0 is favored but never dominant.
 * `Infinity` rank yields 0, keeping deep cuts out of weighted starter draws.
 */
function rankWeight(rank: number): number {
  if (!Number.isFinite(rank)) return 0;
  return 1 / (Math.max(0, rank) + 2);
}

export function stationTrackIdentity(track: StationTrack): string {
  return (
    track.youtubeId?.trim() ||
    (track.itunesTrackId ? `preview:${track.itunesTrackId}` : "") ||
    track.streamUrl?.trim() ||
    track.previewUrl?.trim() ||
    `${track.artist}::${track.title}`
  );
}

/** Full-length on-air media only. iTunes/Spotify 30s `previewUrl` is browse-only. */
export function isPlayableStationTrack(track: StationTrack): boolean {
  return Boolean(track.youtubeId?.trim() || track.streamUrl?.trim());
}

/** Assigns tier by popularity rank. Returns a new array; input is not mutated. */
export function splitTiers<T>(ranked: readonly Ranked<T>[]): Ranked<T>[] {
  return ranked.map((entry) => ({
    ...entry,
    tier: entry.isPrimaryArtist && entry.rank < TIER_1_SIZE ? 1 : 2,
  }));
}

/**
 * Draws one entry with probability proportional to its rank weight.
 * Falls back to a uniform pick when every candidate has zero weight.
 */
export function weightedSample<T>(
  candidates: readonly Ranked<T>[],
  rng: Rng = Math.random,
): Ranked<T> | undefined {
  if (candidates.length === 0) return undefined;

  const total = candidates.reduce((sum, entry) => sum + rankWeight(entry.rank), 0);
  if (total <= 0) {
    return candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))];
  }

  let threshold = rng() * total;
  for (const entry of candidates) {
    threshold -= rankWeight(entry.rank);
    if (threshold <= 0) return entry;
  }

  return candidates[candidates.length - 1];
}

/**
 * Picks the session opener from Tier 1 so playback starts on a recognizable hit
 * without always landing on the #1 API result.
 */
export function selectStarter<T>(
  ranked: readonly Ranked<T>[],
  rng: Rng = Math.random,
  options?: {
    avoidIds?: ReadonlySet<string>;
    identify?: (item: T) => string;
    isPlayable?: (item: T) => boolean;
  },
): Ranked<T> | undefined {
  if (ranked.length === 0) return undefined;

  const isPlayable = options?.isPlayable;
  const playable = isPlayable ? ranked.filter((entry) => isPlayable(entry.item)) : [...ranked];
  const pool = playable.length > 0 ? playable : [...ranked];

  const tier1 = pool.filter((entry) => entry.tier === 1);
  const preferred = tier1.length > 0 ? tier1 : pool;

  const identify = options?.identify;
  const avoid = options?.avoidIds;
  if (avoid?.size && identify) {
    const fresh = preferred.filter((entry) => !avoid.has(identify(entry.item)));
    if (fresh.length > 0) return weightedSample(fresh, rng);
  }

  return weightedSample(preferred, rng);
}

/**
 * Weighted shuffle: repeated weighted draws without replacement, so hits cluster
 * toward the front while deep cuts still surface anywhere in the queue.
 */
export function orderQueue<T>(
  ranked: readonly Ranked<T>[],
  rng: Rng = Math.random,
): Ranked<T>[] {
  const remaining = [...ranked];
  const out: Ranked<T>[] = [];

  while (remaining.length > 0) {
    const total = remaining.reduce((sum, entry) => sum + rankWeight(entry.rank), 0);

    if (total <= 0) {
      for (let i = remaining.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
      }
      out.push(...remaining);
      break;
    }

    let threshold = rng() * total;
    let picked = remaining.length - 1;
    for (let i = 0; i < remaining.length; i++) {
      threshold -= rankWeight(remaining[i].rank);
      if (threshold <= 0) {
        picked = i;
        break;
      }
    }

    out.push(remaining[picked]);
    remaining.splice(picked, 1);
  }

  return out;
}

/**
 * Reorders so no two consecutive tracks share an artist, pulling the earliest
 * eligible track forward at each step so the weighted ordering is disturbed as
 * little as possible.
 *
 * Index 0 is pinned, keeping a chosen starter in place. An artist holding more
 * than half the remaining slots is forced out early — without that, a greedy pass
 * drains the other artists and strands a block of duplicates at the tail. When no
 * valid arrangement exists (a single-artist playlist), tracks pass through in
 * order rather than being dropped.
 */
export function repairArtistAdjacency<T extends Artisted>(items: readonly T[]): T[] {
  if (items.length <= 1) return [...items];

  const remaining = items.map((item) => ({ item, artist: normalizeArtistName(item.artist) }));
  const out: T[] = [];

  // Pin the starter so ordering decisions can never displace it.
  const first = remaining.shift();
  if (!first) return [];
  out.push(first.item);
  let lastArtist = first.artist;

  while (remaining.length > 0) {
    const counts = new Map<string, number>();
    for (const entry of remaining) {
      counts.set(entry.artist, (counts.get(entry.artist) ?? 0) + 1);
    }

    let pickIndex = remaining.findIndex((entry) => entry.artist !== lastArtist);

    // An artist needing at least every other remaining slot must be placed now,
    // or the tail strands a block of duplicates.
    for (const [artist, count] of counts) {
      if (artist === lastArtist) continue;
      if (count * 2 > remaining.length) {
        pickIndex = remaining.findIndex((entry) => entry.artist === artist);
        break;
      }
    }

    // Every remaining track is by the current artist — unavoidable repeat.
    if (pickIndex < 0) pickIndex = 0;

    const [picked] = remaining.splice(pickIndex, 1);
    out.push(picked.item);
    lastArtist = picked.artist;
  }

  return out;
}

/** Wraps items that carry no popularity signal of their own. */
export function toRanked<T>(
  items: readonly T[],
  options?: { startRank?: number; isPrimaryArtist?: boolean },
): Ranked<T>[] {
  const start = options?.startRank ?? 0;
  const isPrimaryArtist = options?.isPrimaryArtist ?? true;

  return splitTiers(
    items.map((item, index) => ({
      item,
      rank: start + index,
      tier: 1 as const,
      isPrimaryArtist,
    })),
  );
}

/**
 * Full ordering pipeline: Tier 1 starter, weighted-shuffled tail, adjacency repair.
 * Length is preserved unless `payloadSize` trims the result.
 */
export function buildOrderedQueue<T extends Artisted>(
  ranked: readonly Ranked<T>[],
  options?: {
    rng?: Rng;
    payloadSize?: number;
    avoidStarterIds?: ReadonlySet<string>;
    identify?: (item: T) => string;
    isPlayable?: (item: T) => boolean;
  },
): T[] {
  const rng = options?.rng ?? Math.random;
  const tiered = splitTiers(ranked);
  if (tiered.length === 0) return [];

  const starter = selectStarter(tiered, rng, {
    avoidIds: options?.avoidStarterIds,
    identify: options?.identify,
    isPlayable: options?.isPlayable,
  });
  if (!starter) return [];

  const rest = tiered.filter((entry) => entry !== starter);
  const ordered = [starter, ...orderQueue(rest, rng)].map((entry) => entry.item);
  const repaired = repairArtistAdjacency(ordered);

  const size = options?.payloadSize;
  return size && size > 0 ? repaired.slice(0, size) : repaired;
}

/** `buildOrderedQueue` preconfigured for resolved station tracks. */
export function buildOrderedStationQueue(
  ranked: readonly RankedTrack[],
  options?: { rng?: Rng; payloadSize?: number; avoidStarterIds?: ReadonlySet<string> },
): StationTrack[] {
  return buildOrderedQueue(ranked, {
    ...options,
    identify: stationTrackIdentity,
    isPlayable: isPlayableStationTrack,
  });
}

/**
 * Artist Mix launch rules.
 * The seed artist opens. A short neighbor list still plays.
 * Asking again prefers different neighbors from the same feel, when any are left.
 */

import { itunesTitlesMatch } from "@/lib/itunes";
import { primaryArtistName } from "@/lib/queue/statutory-rules";
import { artistNamesMatch, normalizeArtistName } from "@/lib/track-quality";
import { orderQueue, repairArtistAdjacency, type Rng } from "@/lib/track-shuffle";

/**
 * How many same-feel neighbors the older slice helper takes.
 * The live draw uses the tier counts below, not this number.
 */
export const MIX_NEIGHBOR_TAKE = 12;

/** Wide station length for mode `mixed`. Artist-only keeps its own cap of 30. */
export const MIX_STATION_SIZE = 50;

/** Seed artist songs on a wide station, including song 1. */
export const MIX_SEED_SONGS = 8;

export const MIX_CLOSE_ARTISTS = 6;
export const MIX_PEER_ARTISTS = 8;
export const MIX_DEEP_ARTISTS = 8;
export const MIX_CLOSE_SONGS = 3;
export const MIX_PEER_SONGS = 2;
export const MIX_DEEP_SONGS = 1;

/** Closest names carried from the previous launch when the close band has room. */
export const MIX_KEEP_CLOSE = 3;

/** Close slots are not cut below this when that many closest names exist. */
export const MIX_CLOSE_MIN = 4;

/** Scene stations have no seed block. The extra 8 songs become 8 more deep acts. */
export const SCENE_CLOSE_ARTISTS = 6;
export const SCENE_PEER_ARTISTS = 8;
export const SCENE_DEEP_ARTISTS = 16;
export const SCENE_CLOSE_SONGS = 3;
export const SCENE_PEER_SONGS = 2;
export const SCENE_DEEP_SONGS = 1;

/** At most this many flagged side projects or direct collaborators in one draw. */
export const MIX_ECOSYSTEM_CAP = 3;

const STORAGE_PREFIX = "songhost-mix-neighbors:";
const POOL_STORAGE_PREFIX = "songhost-mix-pool:";
const POOL_NAME_CAP = 40;

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

const castMemory = new Map<string, NeighborhoodCast>();

export function recallNeighborhoodCast(artist: string): NeighborhoodCast | null {
  const cast = castMemory.get(mixNeighborKey(artist));
  if (!cast) return null;
  return {
    close: [...cast.close],
    peer: [...cast.peer],
    deep: [...cast.deep],
  };
}

export function rememberNeighborhoodCast(artist: string, cast: NeighborhoodCast): void {
  const key = mixNeighborKey(artist);
  if (!key) return;
  castMemory.set(key, {
    close: [...cast.close],
    peer: [...cast.peer],
    deep: [...cast.deep],
  });
}

export function clearMixNeighborMemory(): void {
  memory.clear();
  castMemory.clear();
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

export type MixPoolName = {
  name: string;
  match?: number;
  ecosystem?: boolean;
};

export type NeighborhoodCast = {
  close: string[];
  peer: string[];
  deep: string[];
};

export type PreviousCast = {
  close?: readonly string[];
  peer?: readonly string[];
  deep?: readonly string[];
  used?: readonly string[];
};

export type StoredMixPool = {
  pool: MixPoolName[];
  at: number;
  close: string[];
  peer: string[];
  deep: string[];
};

export type PlannedTitle = {
  artist: string;
  title: string;
};

const CLOSE_BAND = 10;
const PEER_BAND_END = 25;

function asPool(pool: readonly (string | MixPoolName)[]): MixPoolName[] {
  const seen = new Set<string>();
  const out: MixPoolName[] = [];
  for (const entry of pool) {
    const name = (typeof entry === "string" ? entry : entry.name).trim();
    const key = normalizeArtistName(name);
    if (!name || !key || seen.has(key)) continue;
    seen.add(key);
    if (typeof entry === "string") {
      out.push({ name });
    } else {
      out.push({
        name,
        ...(typeof entry.match === "number" ? { match: entry.match } : {}),
        ...(entry.ecosystem ? { ecosystem: true } : {}),
      });
    }
  }
  return out;
}

function shufflePool(names: readonly MixPoolName[], rng: Rng): MixPoolName[] {
  if (names.length <= 1) return [...names];
  return orderQueue(
    names.map((item) => ({
      item,
      rank: Number.POSITIVE_INFINITY,
      tier: 2 as const,
      isPrimaryArtist: false,
    })),
    rng,
  ).map((entry) => entry.item);
}

function sameNameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const keys = new Set(right.map((name) => normalizeArtistName(name)));
  return left.every((name) => keys.has(normalizeArtistName(name)));
}

function notYet(
  names: readonly MixPoolName[],
  blocked: ReadonlySet<string>,
): MixPoolName[] {
  return names.filter((entry) => !blocked.has(normalizeArtistName(entry.name)));
}

/**
 * Shuffle a band, then take names. Flagged ecosystem names stop after the
 * shared cap. When the model sent no flags, the cap is not applied.
 */
function takeFromBand(
  band: readonly MixPoolName[],
  count: number,
  blocked: ReadonlySet<string>,
  rng: Rng,
  flags: ReadonlySet<string>,
  flagBudget: { left: number },
  enforceFlags: boolean,
): MixPoolName[] {
  if (count <= 0 || band.length === 0) return [];
  const fresh = shufflePool(notYet(band, blocked), rng);
  const repeats = shufflePool(
    band.filter((entry) => blocked.has(normalizeArtistName(entry.name))),
    rng,
  );
  const ordered = fresh.length >= count ? fresh : [...fresh, ...repeats];
  const out: MixPoolName[] = [];
  for (const entry of ordered) {
    if (out.length >= count) break;
    const key = normalizeArtistName(entry.name);
    if (out.some((picked) => normalizeArtistName(picked.name) === key)) continue;
    const flagged = enforceFlags && (entry.ecosystem || flags.has(key));
    if (flagged && flagBudget.left <= 0) continue;
    if (flagged) flagBudget.left -= 1;
    out.push(entry);
  }
  return out;
}

function namesOf(entries: readonly MixPoolName[]): string[] {
  return entries.map((entry) => entry.name);
}

/**
 * One hour from a best-first pool.
 * Close band is ranks 1–10, peers 11–25, deep the rest.
 * The second launch keeps the 3 best previous close names and moves the deep shelf first.
 */
export function drawNeighborhood(
  pool: readonly (string | MixPoolName)[],
  previous: PreviousCast = {},
  rng: Rng = Math.random,
  targets: { close: number; peer: number; deep: number } = {
    close: MIX_CLOSE_ARTISTS,
    peer: MIX_PEER_ARTISTS,
    deep: MIX_DEEP_ARTISTS,
  },
): NeighborhoodCast {
  const ranked = asPool(pool);
  const closeBand = ranked.slice(0, CLOSE_BAND);
  const peerBand = ranked.slice(CLOSE_BAND, PEER_BAND_END);
  const deepBand = ranked.slice(PEER_BAND_END);
  const enforceFlags = ranked.some((entry) => entry.ecosystem);
  const flags = new Set(
    ranked.filter((entry) => entry.ecosystem).map((entry) => normalizeArtistName(entry.name)),
  );
  const flagBudget = { left: enforceFlags ? MIX_ECOSYSTEM_CAP : Number.POSITIVE_INFINITY };

  const previousClose = asPool(previous.close ?? []);
  const keptClose = closeBand
    .filter((entry) =>
      previousClose.some((kept) => artistNamesMatch(kept.name, entry.name)),
    )
    .slice(0, MIX_KEEP_CLOSE);

  const used = new Set<string>();
  for (const name of [
    ...(previous.used ?? []),
    ...(previous.close ?? []),
    ...(previous.peer ?? []),
    ...(previous.deep ?? []),
  ]) {
    const key = normalizeArtistName(name);
    if (key) used.add(key);
  }
  for (const entry of keptClose) used.add(normalizeArtistName(entry.name));

  const closeNeed = Math.max(0, Math.min(targets.close, closeBand.length) - keptClose.length);
  const closeFresh = takeFromBand(
    notYet(closeBand, new Set(keptClose.map((entry) => normalizeArtistName(entry.name)))),
    closeNeed,
    used,
    rng,
    flags,
    flagBudget,
    enforceFlags,
  );
  let close = [...keptClose, ...closeFresh];
  if (close.length < Math.min(targets.close, MIX_CLOSE_MIN) && closeBand.length >= MIX_CLOSE_MIN) {
    const more = takeFromBand(
      closeBand,
      Math.min(targets.close, MIX_CLOSE_MIN) - close.length,
      new Set(close.map((entry) => normalizeArtistName(entry.name))),
      rng,
      flags,
      flagBudget,
      enforceFlags,
    );
    close = [...close, ...more];
  }
  if (close.length < targets.close) {
    const fromPeer = takeFromBand(
      peerBand,
      targets.close - close.length,
      new Set([...used, ...close.map((entry) => normalizeArtistName(entry.name))]),
      rng,
      flags,
      flagBudget,
      enforceFlags,
    );
    close = [...close, ...fromPeer];
  }
  if (close.length > targets.close) close = close.slice(0, targets.close);

  const taken = new Set(close.map((entry) => normalizeArtistName(entry.name)));
  const peerCandidates = peerBand.filter((entry) => !taken.has(normalizeArtistName(entry.name)));
  let peer = takeFromBand(peerCandidates, targets.peer, used, rng, flags, flagBudget, enforceFlags);
  if (
    previous.peer &&
    previous.peer.length > 0 &&
    sameNameSet(namesOf(peer), previous.peer) &&
    peer.length === previous.peer.length
  ) {
    peer = peer.slice(0, Math.max(0, peer.length - 1));
  }
  for (const entry of peer) taken.add(normalizeArtistName(entry.name));

  const deepCandidates = deepBand.filter((entry) => !taken.has(normalizeArtistName(entry.name)));
  let deep = takeFromBand(deepCandidates, targets.deep, used, rng, flags, flagBudget, enforceFlags);
  if (
    previous.deep &&
    previous.deep.length > 0 &&
    sameNameSet(namesOf(deep), previous.deep) &&
    deep.length === previous.deep.length
  ) {
    deep = deep.slice(0, Math.max(0, deep.length - 1));
  }

  return {
    close: namesOf(close),
    peer: namesOf(peer),
    deep: namesOf(deep),
  };
}

export function drawSceneNeighborhood(
  pool: readonly (string | MixPoolName)[],
  previous: PreviousCast = {},
  rng: Rng = Math.random,
): NeighborhoodCast {
  return drawNeighborhood(pool, previous, rng, {
    close: SCENE_CLOSE_ARTISTS,
    peer: SCENE_PEER_ARTISTS,
    deep: SCENE_DEEP_ARTISTS,
  });
}

export function plannedMixCounts(cast: NeighborhoodCast): {
  seed: number;
  close: number;
  peer: number;
  deep: number;
  total: number;
} {
  const close = cast.close.length * MIX_CLOSE_SONGS;
  const peer = cast.peer.length * MIX_PEER_SONGS;
  const deep = cast.deep.length * MIX_DEEP_SONGS;
  return {
    seed: MIX_SEED_SONGS,
    close,
    peer,
    deep,
    total: MIX_SEED_SONGS + close + peer + deep,
  };
}

export function plannedSceneCounts(cast: NeighborhoodCast): {
  close: number;
  peer: number;
  deep: number;
  total: number;
} {
  const close = cast.close.length * SCENE_CLOSE_SONGS;
  const peer = cast.peer.length * SCENE_PEER_SONGS;
  const deep = cast.deep.length * SCENE_DEEP_SONGS;
  return { close, peer, deep, total: close + peer + deep };
}

function roundRobin(
  artists: readonly { artist: string; titles: readonly string[] }[],
): PlannedTitle[] {
  const queues = artists.map((entry) => ({
    artist: entry.artist,
    titles: [...entry.titles],
  }));
  const out: PlannedTitle[] = [];
  let pending = true;
  while (pending) {
    pending = false;
    for (const queue of queues) {
      const title = queue.titles.shift();
      if (!title) continue;
      pending = true;
      out.push({ artist: queue.artist, title });
    }
  }
  return out;
}

function cycleNeighbors(input: {
  close: readonly { artist: string; titles: readonly string[] }[];
  peer: readonly { artist: string; titles: readonly string[] }[];
  deep: readonly { artist: string; titles: readonly string[] }[];
}): PlannedTitle[] {
  const buckets = {
    close: roundRobin(input.close),
    peer: roundRobin(input.peer),
    deep: roundRobin(input.deep),
  };
  const order = ["close", "peer", "close", "peer", "deep"] as const;
  const out: PlannedTitle[] = [];
  let pending = true;
  while (pending) {
    pending = false;
    for (const tier of order) {
      const next = buckets[tier].shift();
      if (!next) continue;
      pending = true;
      out.push(next);
    }
  }
  return out;
}

function placeSeedSongs(neighbors: readonly PlannedTitle[], seeds: readonly PlannedTitle[]): PlannedTitle[] {
  if (seeds.length === 0) return [...neighbors];
  const total = neighbors.length + seeds.length;
  const slots: Array<PlannedTitle | null> = Array.from({ length: total }, () => null);
  const seedAt = new Set<number>();

  for (let i = 0; i < seeds.length; i += 1) {
    let slot = i * 6;
    if (slot >= slots.length) slot = slots.length;
    while (slot < slots.length && (slots[slot] || seedAt.has(slot - 1))) slot += 1;
    if (slot >= slots.length) {
      slots.push(seeds[i] ?? null);
      seedAt.add(slots.length - 1);
      continue;
    }
    slots[slot] = seeds[i] ?? null;
    seedAt.add(slot);
  }

  let cursor = 0;
  for (let i = 0; i < slots.length && cursor < neighbors.length; i += 1) {
    if (slots[i]) continue;
    slots[i] = neighbors[cursor] ?? null;
    cursor += 1;
  }
  while (cursor < neighbors.length) {
    slots.push(neighbors[cursor] ?? null);
    cursor += 1;
  }

  return slots.filter((song): song is PlannedTitle => Boolean(song?.title && song.artist));
}

/**
 * Neighbor songs first, in the close / peer / close / peer / deep cycle.
 * Seed songs land about every six positions. Index 0 stays the pin.
 * The same artist does not play twice in a row.
 */
export function weaveNeighborhood(input: {
  seedArtist: string;
  seedSongs: readonly { title: string }[];
  close: readonly { artist: string; titles: readonly string[] }[];
  peer: readonly { artist: string; titles: readonly string[] }[];
  deep: readonly { artist: string; titles: readonly string[] }[];
}): PlannedTitle[] {
  const seedArtist = input.seedArtist.trim();
  const seeds = input.seedSongs
    .map((song) => ({ artist: seedArtist, title: song.title.trim() }))
    .filter((song) => song.artist && song.title)
    .slice(0, MIX_SEED_SONGS);
  const neighbors = cycleNeighbors(input);
  const placed = placeSeedSongs(neighbors, seeds);
  if (placed.length === 0) return [];
  return repairArtistAdjacency(placed);
}

/** Scene weave. No artist gets a seed block. Song 1 is the first close song. */
export function weaveScene(input: {
  close: readonly { artist: string; titles: readonly string[] }[];
  peer: readonly { artist: string; titles: readonly string[] }[];
  deep: readonly { artist: string; titles: readonly string[] }[];
}): PlannedTitle[] {
  const placed = cycleNeighbors(input);
  if (placed.length === 0) return [];
  return repairArtistAdjacency(placed);
}

export function formatStoredPoolParam(pool: readonly MixPoolName[]): string {
  return JSON.stringify(
    asPool(pool)
      .slice(0, POOL_NAME_CAP)
      .map((entry) => ({
        name: entry.name,
        ...(typeof entry.match === "number" ? { match: entry.match } : {}),
        ...(entry.ecosystem ? { ecosystem: true } : {}),
      })),
  );
}

export function parseStoredPoolParam(value: string | null | undefined): MixPoolName[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return asPool(
      parsed.filter((row): row is MixPoolName => Boolean(row) && typeof row === "object"),
    ).slice(0, POOL_NAME_CAP);
  } catch {
    return [];
  }
}

export function readStoredMixPool(artist: string): StoredMixPool | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(POOL_STORAGE_PREFIX + mixNeighborKey(artist));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredMixPool>;
    const pool = Array.isArray(parsed.pool) ? asPool(parsed.pool).slice(0, POOL_NAME_CAP) : [];
    const at = typeof parsed.at === "number" ? parsed.at : 0;
    if (!pool.length || !at) return null;
    return {
      pool,
      at,
      close: parseMixNeighborParam((parsed.close ?? []).join("|")),
      peer: parseMixNeighborParam((parsed.peer ?? []).join("|")),
      deep: parseMixNeighborParam((parsed.deep ?? []).join("|")),
    };
  } catch {
    return null;
  }
}

export function storeMixPool(artist: string, value: StoredMixPool): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  const key = mixNeighborKey(artist);
  if (!key) return;
  try {
    const next: StoredMixPool = {
      pool: asPool(value.pool).slice(0, POOL_NAME_CAP),
      at: value.at,
      close: parseMixNeighborParam(value.close.join("|")),
      peer: parseMixNeighborParam(value.peer.join("|")),
      deep: parseMixNeighborParam(value.deep.join("|")),
    };
    window.localStorage.setItem(POOL_STORAGE_PREFIX + key, JSON.stringify(next));
    storeMixNeighbors(artist, [...next.close, ...next.peer, ...next.deep]);
  } catch {
    // Private browsing can refuse storage. The request still works.
  }
}

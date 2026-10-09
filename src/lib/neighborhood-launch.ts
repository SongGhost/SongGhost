/**
 * Builds the songs for a wide neighborhood, an artist-only hour, or a scene.
 * Song 1 resolves before the rest. Beat 1 can start once it and a short tail
 * are playable. Beat 2 finishes the same planned titles.
 */

import type { StationTrack } from "@/data/stations";
import {
  MIX_CLOSE_SONGS,
  MIX_DEEP_SONGS,
  MIX_PEER_SONGS,
  MIX_SEED_SONGS,
  SCENE_CLOSE_SONGS,
  SCENE_DEEP_SONGS,
  SCENE_PEER_SONGS,
  drawNeighborhood,
  drawSceneNeighborhood,
  mixOpensOnSeed,
  pinExactSongFirst,
  trackIsSeedArtist,
  weaveNeighborhood,
  weaveScene,
  type MixPoolName,
  type NeighborhoodCast,
  type PlannedTitle,
  type PreviousCast,
} from "@/lib/artist-mix";
import { ARTIST_RADIO_PAYLOAD_SIZE, findTracksInLibrary } from "@/lib/artist-radio";
import { fetchLastFmTopTracks } from "@/lib/catalog/lastfm";
import { pickFallbackTitles, pickGreatTitles } from "@/lib/great-songs";
import {
  itunesArtistsMatch,
  itunesSongToStationTrack,
  itunesTitlesMatch,
  lookupITunesSongById,
  lookupITunesTrack,
  searchSongsByArtistStrict,
  type ITunesSong,
} from "@/lib/itunes";
import { assembleMixNeighbors, type MixNeighborDeps } from "@/lib/mix-neighbors";
import { isAcceptableArtistRadioTrack } from "@/lib/track-quality";
import { preferPlayableCandidates } from "@/lib/youtube/playability";
import { classifyYouTubePlayback } from "@/lib/youtube/youtube-search";
import { isValidYouTubeVideoId } from "@/lib/youtube";
import { resolveTrackVideoId } from "@/lib/youtube-search";

export const BEAT1_FOLLOWING = 14;
export const BEAT1_BUDGET_MS = 8_000;

export type PlannedSlot = PlannedTitle & { alt?: string[] };

export type PinnedSeed = {
  title: string;
  itunesTrackId?: number;
};

export type NeighborhoodLaunch = {
  tracks: StationTrack[];
  tailPlan: PlannedSlot[];
  pool: MixPoolName[];
  cast: NeighborhoodCast;
};

const TITLE_CONCURRENCY = 8;

async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Math.min(concurrency, items.length);

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index] as T);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

async function titlesForArtist(
  artist: string,
  count: number,
  pinned?: string,
): Promise<{ titles: string[]; spare: string[] }> {
  if (count <= 0) return { titles: [], spare: [] };
  try {
    const top = await fetchLastFmTopTracks(artist, 30);
    if (top.length) {
      const picked = pickGreatTitles(top, count, { pinned, spare: 4 });
      return { titles: picked.chosen, spare: picked.spare };
    }
  } catch {
    // Last.fm off or empty falls through to iTunes.
  }
  try {
    const songs = await searchSongsByArtistStrict(artist, Math.max(count + 4, 12));
    const picked = pickFallbackTitles(
      songs.map((song) => song.title),
      count,
      { pinned, spare: 4 },
    );
    return { titles: picked.chosen, spare: picked.spare };
  } catch {
    return { titles: pinned ? [pinned] : [], spare: [] };
  }
}

function slotsFrom(
  woven: readonly PlannedTitle[],
  spareByArtist: ReadonlyMap<string, string[]>,
): PlannedSlot[] {
  return woven.map((song) => ({
    artist: song.artist,
    title: song.title,
    alt: spareByArtist.get(song.artist.toLowerCase()) ?? [],
  }));
}

async function resolveSong(
  song: ITunesSong,
  seen: Set<string>,
  excludeYoutubeIds: ReadonlySet<string>,
): Promise<StationTrack | null> {
  if (!isAcceptableArtistRadioTrack(song.title, { durationMs: song.durationMs })) return null;
  const youtubeId = await resolveTrackVideoId(
    song.artist,
    song.title,
    excludeYoutubeIds,
    song.durationMs != null ? song.durationMs / 1000 : undefined,
  );
  if (!youtubeId || seen.has(youtubeId)) return null;
  const track = itunesSongToStationTrack(song, youtubeId);
  if (!track?.youtubeId) return null;
  seen.add(youtubeId);
  return track;
}

async function resolveTitle(
  artist: string,
  title: string,
  seen: Set<string>,
  excludeYoutubeIds: ReadonlySet<string>,
  pinned?: PinnedSeed | null,
): Promise<StationTrack | null> {
  let song: ITunesSong | null = null;
  if (pinned?.itunesTrackId && itunesTitlesMatch(title, pinned.title)) {
    song = await lookupITunesSongById(pinned.itunesTrackId, { title, artist });
  }
  if (!song) song = await lookupITunesTrack(artist, title);
  if (!song) return null;
  if (!itunesTitlesMatch(song.title, title) || !itunesArtistsMatch(song.artist, artist)) return null;
  return resolveSong(song, seen, excludeYoutubeIds);
}

async function resolveSlot(
  slot: PlannedSlot,
  seen: Set<string>,
  excludeYoutubeIds: ReadonlySet<string>,
  usedTitles: Set<string>,
  options?: { exact?: boolean; pinned?: PinnedSeed | null },
): Promise<StationTrack | null> {
  const titles = options?.exact ? [slot.title] : [slot.title, ...(slot.alt ?? [])];
  for (const title of titles) {
    const key = `${slot.artist.toLowerCase()}::${title.toLowerCase()}`;
    if (usedTitles.has(key)) continue;
    const track = await resolveTitle(slot.artist, title, seen, excludeYoutubeIds, options?.pinned);
    if (!track) continue;
    usedTitles.add(key);
    return track;
  }
  return null;
}

async function resolveBeat(
  slots: readonly PlannedSlot[],
  seen: Set<string>,
  excludeYoutubeIds: ReadonlySet<string>,
  options: {
    deadline: number;
    following: number;
    exactFirst?: boolean;
    pinned?: PinnedSeed | null;
  },
): Promise<{ tracks: StationTrack[]; rest: PlannedSlot[] }> {
  if (slots.length === 0) return { tracks: [], rest: [] };
  const usedTitles = new Set<string>();
  const first = await resolveSlot(slots[0] as PlannedSlot, seen, excludeYoutubeIds, usedTitles, {
    exact: options.exactFirst,
    pinned: options.pinned,
  });
  if (!first) return { tracks: [], rest: [] };
  if (options.exactFirst) first.openerLock = true;

  const tracks = [first];
  let index = 1;
  while (index < slots.length && tracks.length < 1 + options.following && Date.now() < options.deadline) {
    const batch = slots.slice(index, index + 6);
    index += batch.length;
    const resolved = await Promise.all(
      batch.map((slot) => resolveSlot(slot, seen, excludeYoutubeIds, usedTitles, { pinned: options.pinned })),
    );
    for (const track of resolved) {
      if (track) tracks.push(track);
    }
  }
  return { tracks, rest: slots.slice(index) };
}

async function resolveAll(
  slots: readonly PlannedSlot[],
  seen: Set<string>,
  excludeYoutubeIds: ReadonlySet<string>,
  pinned?: PinnedSeed | null,
): Promise<StationTrack[]> {
  const usedTitles = new Set<string>();
  const tracks: StationTrack[] = [];
  for (const slot of slots) {
    const track = await resolveSlot(slot, seen, excludeYoutubeIds, usedTitles, { pinned });
    if (track) tracks.push(track);
  }
  return tracks;
}

async function libraryFallbackTracks(
  artistName: string,
  seen: Set<string>,
  excludeYoutubeIds: ReadonlySet<string>,
): Promise<StationTrack[]> {
  const out: StationTrack[] = [];
  const queued = new Set<string>();
  for (const track of findTracksInLibrary(artistName)) {
    if (!isAcceptableArtistRadioTrack(track.title)) continue;
    if (!track.youtubeId || !isValidYouTubeVideoId(track.youtubeId)) continue;
    if (seen.has(track.youtubeId) || excludeYoutubeIds.has(track.youtubeId)) continue;
    if (queued.has(track.youtubeId)) continue;
    queued.add(track.youtubeId);
    out.push(track);
  }
  let kept = out;
  try {
    const verdicts = await classifyYouTubePlayback(out.map((track) => track.youtubeId));
    if (verdicts.size > 0) kept = preferPlayableCandidates(out, verdicts, excludeYoutubeIds);
  } catch {
    kept = out;
  }
  for (const track of kept) seen.add(track.youtubeId);
  return kept;
}

function spareMap(
  groups: readonly { artist: string; spare: string[] }[],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const group of groups) out.set(group.artist.toLowerCase(), group.spare);
  return out;
}

async function planGroups(
  names: readonly string[],
  count: number,
): Promise<{ artist: string; titles: string[]; spare: string[] }[]> {
  return mapPool(names, TITLE_CONCURRENCY, async (artist) => {
    const planned = await titlesForArtist(artist, count);
    return { artist, titles: planned.titles, spare: planned.spare };
  });
}

export async function buildMixedNeighborhood(input: {
  artistName: string;
  pinned?: PinnedSeed | null;
  excludeYoutubeIds?: ReadonlySet<string>;
  previous?: PreviousCast;
  previousNames?: readonly string[];
  poolDeps?: MixNeighborDeps;
  beat?: "1" | "2";
  plan?: readonly PlannedSlot[];
  now?: () => number;
}): Promise<NeighborhoodLaunch> {
  const artistName = input.artistName.trim();
  const exclude = input.excludeYoutubeIds ?? new Set<string>();
  const seen = new Set<string>();
  const now = input.now ?? Date.now;

  if (input.beat === "2") {
    const tracks = await resolveAll(input.plan ?? [], seen, exclude, input.pinned);
    return { tracks, tailPlan: [], pool: [], cast: { close: [], peer: [], deep: [] } };
  }

  const pool = await assembleMixNeighbors(artistName, input.previousNames ?? [], input.poolDeps);
  const cast = drawNeighborhood(pool, input.previous ?? {});
  const artistsKnownAt = now();

  const seedPlan = await titlesForArtist(
    artistName,
    MIX_SEED_SONGS,
    input.pinned?.title,
  );
  const [close, peer, deep] = await Promise.all([
    planGroups(cast.close, MIX_CLOSE_SONGS),
    planGroups(cast.peer, MIX_PEER_SONGS),
    planGroups(cast.deep, MIX_DEEP_SONGS),
  ]);

  const woven = weaveNeighborhood({
    seedArtist: artistName,
    seedSongs: seedPlan.titles.map((title) => ({ title })),
    close,
    peer,
    deep,
  });
  const slots = slotsFrom(woven, spareMap([
    { artist: artistName, spare: seedPlan.spare },
    ...close,
    ...peer,
    ...deep,
  ]));

  if (slots.length === 0 || (input.pinned && !itunesTitlesMatch(slots[0]?.title ?? "", input.pinned.title))) {
    return { tracks: [], tailPlan: [], pool, cast };
  }

  const beat = await resolveBeat(slots, seen, exclude, {
    deadline: artistsKnownAt + BEAT1_BUDGET_MS,
    following: BEAT1_FOLLOWING,
    exactFirst: Boolean(input.pinned),
    pinned: input.pinned,
  });

  if (!mixOpensOnSeed(beat.tracks, artistName)) {
    return { tracks: [], tailPlan: [], pool, cast };
  }

  return { tracks: beat.tracks, tailPlan: beat.rest, pool, cast };
}

export async function buildArtistOnlyStation(input: {
  artistName: string;
  pinned?: PinnedSeed | null;
  excludeYoutubeIds?: ReadonlySet<string>;
}): Promise<StationTrack[]> {
  const artistName = input.artistName.trim();
  const exclude = input.excludeYoutubeIds ?? new Set<string>();
  const seen = new Set<string>();
  const planned = await titlesForArtist(
    artistName,
    ARTIST_RADIO_PAYLOAD_SIZE,
    input.pinned?.title,
  );
  const slots: PlannedSlot[] = [
    ...planned.titles.map((title) => ({ artist: artistName, title, alt: planned.spare })),
  ];
  let tracks = await resolveAll(slots, seen, exclude, input.pinned);
  tracks = tracks.filter((track) => trackIsSeedArtist(track.artist, artistName));
  if (input.pinned) {
    const opener = tracks.find((track) => itunesTitlesMatch(track.title, input.pinned?.title ?? ""));
    if (!opener) return [];
    opener.openerLock = true;
    tracks = pinExactSongFirst(tracks, artistName, input.pinned.title);
    tracks = [
      tracks[0] as StationTrack,
      ...tracks.slice(1).filter((track) => trackIsSeedArtist(track.artist, artistName)),
    ];
  }
  if (tracks.length < 8) {
    tracks.push(...(await libraryFallbackTracks(artistName, seen, exclude)));
    tracks = tracks.filter((track) => trackIsSeedArtist(track.artist, artistName));
  }
  return tracks.slice(0, ARTIST_RADIO_PAYLOAD_SIZE);
}

export async function buildSceneNeighborhood(input: {
  pool: readonly MixPoolName[];
  previous?: PreviousCast;
  excludeYoutubeIds?: ReadonlySet<string>;
  beat?: "1" | "2";
  plan?: readonly PlannedSlot[];
  now?: () => number;
}): Promise<{ tracks: StationTrack[]; tailPlan: PlannedSlot[]; cast: NeighborhoodCast }> {
  const exclude = input.excludeYoutubeIds ?? new Set<string>();
  const seen = new Set<string>();
  const now = input.now ?? Date.now;

  if (input.beat === "2") {
    const tracks = await resolveAll(input.plan ?? [], seen, exclude);
    return { tracks, tailPlan: [], cast: { close: [], peer: [], deep: [] } };
  }

  const cast = drawSceneNeighborhood(input.pool, input.previous ?? {});
  const artistsKnownAt = now();
  const [close, peer, deep] = await Promise.all([
    planGroups(cast.close, SCENE_CLOSE_SONGS),
    planGroups(cast.peer, SCENE_PEER_SONGS),
    planGroups(cast.deep, SCENE_DEEP_SONGS),
  ]);
  const woven = weaveScene({ close, peer, deep });
  const slots = slotsFrom(woven, spareMap([...close, ...peer, ...deep]));
  const beat = await resolveBeat(slots, seen, exclude, {
    deadline: artistsKnownAt + BEAT1_BUDGET_MS,
    following: BEAT1_FOLLOWING,
  });
  return { tracks: beat.tracks, tailPlan: beat.rest, cast };
}

/**
 * Two-tier persistence for the live station queue.
 *
 * Spotify Connect keeps playing across a refresh; React must hydrate the same
 * `stationId` + queue **before** `syncIndexToPlayingTrack` runs, or the lookup
 * misses against a fallback preset and the Playlist / Broadcast Log desync.
 *
 * Keys (sessionStorage — tab lifetime):
 * - `songhost_active_station_id`
 * - `songhost_active_queue`
 *
 * Keys (localStorage — cross-tab / restart snapshot):
 * - `songhost:last_session` `{ stationId, station, queue, currentIndex }`
 *
 * Boot precedence: sessionStorage → `songhost:last_session` → `lastStationId`
 * lookup → Heavy Rotation fallback.
 */

import type { Station, StationTrack } from "@/data/stations";
import { normalizeSpotifyTrackId } from "@/lib/audio/legacy/spotifyRemote";

export const ACTIVE_STATION_ID_STORAGE_KEY = "songhost_active_station_id";
export const ACTIVE_QUEUE_STORAGE_KEY = "songhost_active_queue";
/** Cross-tab snapshot so search launches survive a new tab or browser restart. */
export const LAST_SESSION_STORAGE_KEY = "songhost:last_session";

/** Pre-sessionStorage blob — read once as a migrate-on-hydrate fallback. */
const LEGACY_LOCAL_QUEUE_KEY = "songghost:session-queue";

/** Cap persisted queue length so sessionStorage stays bounded. */
export const SESSION_QUEUE_PERSIST_MAX = 40;

export type PersistedSessionQueue = {
  stationId: string;
  queue: StationTrack[];
  currentIndex: number;
  nowPlayingTrack: StationTrack | null;
  /** Compact station snapshot so custom launches (artist/song/curator) survive refresh. */
  station?: Station | null;
};

function canUseSessionStorage(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.sessionStorage?.getItem === "function"
  );
}

function canUseLocalStorage(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.localStorage?.getItem === "function"
  );
}

export function cloneSessionTrack(track: StationTrack): StationTrack {
  const out: StationTrack = {
    youtubeId: track.youtubeId?.trim() ?? "",
    title: track.title?.trim() ?? "",
    artist: track.artist?.trim() ?? "",
  };
  if (typeof track.previewUrl === "string" && track.previewUrl.trim()) {
    out.previewUrl = track.previewUrl.trim();
  }
  if (typeof track.itunesTrackId === "number" && Number.isFinite(track.itunesTrackId)) {
    out.itunesTrackId = track.itunesTrackId;
  }
  if (typeof track.album === "string" && track.album.trim()) {
    out.album = track.album.trim();
  }
  if (
    typeof track.releaseYear === "number" &&
    Number.isInteger(track.releaseYear) &&
    track.releaseYear > 0
  ) {
    out.releaseYear = track.releaseYear;
  }
  if (typeof track.spotifyId === "string" && track.spotifyId.trim()) {
    out.spotifyId = track.spotifyId.trim();
  }
  if (typeof track.introDuration === "number" && Number.isFinite(track.introDuration)) {
    out.introDuration = track.introDuration;
  }
  if (track.explicit === true) out.explicit = true;
  return out;
}

export function isSessionPlayableTrack(
  track: StationTrack | null | undefined,
): track is StationTrack {
  if (!track) return false;
  const title = track.title?.trim() ?? "";
  const artist = track.artist?.trim() ?? "";
  if (!title || !artist) return false;
  return Boolean(
    track.youtubeId?.trim() ||
      track.previewUrl?.trim() ||
      track.spotifyId?.trim(),
  );
}

function cloneStationSnapshot(station: Station): Station {
  const tracks = Array.isArray(station.tracks)
    ? station.tracks
        .filter(isSessionPlayableTrack)
        .map(cloneSessionTrack)
        .slice(0, SESSION_QUEUE_PERSIST_MAX)
    : [];

  const out: Station = {
    id: station.id.trim(),
    name: station.name?.trim() || station.id.trim(),
    frequency:
      typeof station.frequency === "number" && Number.isFinite(station.frequency)
        ? station.frequency
        : 0,
    category: station.category === "decades" ? "decades" : "genres",
    defaultPersonaId: station.defaultPersonaId,
    accentColor: station.accentColor?.trim() || "#2992cf",
    youtubeVideoId: station.youtubeVideoId?.trim() || tracks[0]?.youtubeId || "",
    tracks,
    description: station.description?.trim() || "",
  };
  if (typeof station.coverUrl === "string" && station.coverUrl.trim()) {
    out.coverUrl = station.coverUrl.trim();
  }
  if (typeof station.youtubePlaylistId === "string" && station.youtubePlaylistId.trim()) {
    out.youtubePlaylistId = station.youtubePlaylistId.trim();
  }
  return out;
}

function parseQueueBlob(raw: string): PersistedSessionQueue | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedSessionQueue>;
    const stationId =
      typeof parsed.stationId === "string" ? parsed.stationId.trim() : "";

    const queue = Array.isArray(parsed.queue)
      ? parsed.queue
          .filter(isSessionPlayableTrack)
          .map(cloneSessionTrack)
          .slice(0, SESSION_QUEUE_PERSIST_MAX)
      : [];
    const nowPlayingTrack = isSessionPlayableTrack(parsed.nowPlayingTrack)
      ? cloneSessionTrack(parsed.nowPlayingTrack)
      : null;
    const currentIndex =
      typeof parsed.currentIndex === "number" &&
      Number.isInteger(parsed.currentIndex) &&
      parsed.currentIndex >= 0
        ? parsed.currentIndex
        : 0;

    const station =
      parsed.station &&
      typeof parsed.station === "object" &&
      typeof parsed.station.id === "string" &&
      parsed.station.id.trim()
        ? cloneStationSnapshot(parsed.station)
        : null;

    const resolvedId = stationId || station?.id?.trim() || "";
    if (!resolvedId && !queue.length && !nowPlayingTrack) return null;

    return {
      stationId: resolvedId,
      queue,
      currentIndex,
      nowPlayingTrack,
      station,
    };
  } catch {
    return null;
  }
}

function readSessionStorageQueue(): PersistedSessionQueue | null {
  if (!canUseSessionStorage()) return null;
  try {
    const fromSession = window.sessionStorage.getItem(ACTIVE_QUEUE_STORAGE_KEY);
    if (!fromSession) return null;
    const parsed = parseQueueBlob(fromSession);
    if (!parsed) return null;
    const idKey = window.sessionStorage
      .getItem(ACTIVE_STATION_ID_STORAGE_KEY)
      ?.trim();
    if (idKey) parsed.stationId = idKey;
    return parsed;
  } catch {
    return null;
  }
}

function readLastSessionSnapshot(): PersistedSessionQueue | null {
  if (!canUseLocalStorage()) return null;
  try {
    const raw = window.localStorage.getItem(LAST_SESSION_STORAGE_KEY);
    if (!raw) return null;
    return parseQueueBlob(raw);
  } catch {
    return null;
  }
}

function writeLastSessionSnapshot(payload: PersistedSessionQueue): void {
  if (!canUseLocalStorage()) return;
  try {
    window.localStorage.setItem(LAST_SESSION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota / private mode — cross-tab hydrate is best-effort.
  }
}

function buildPersistedPayload(snapshot: PersistedSessionQueue): PersistedSessionQueue | null {
  const stationId = snapshot.stationId?.trim();
  if (!stationId) return null;
  return {
    stationId,
    queue: snapshot.queue
      .filter(isSessionPlayableTrack)
      .map(cloneSessionTrack)
      .slice(0, SESSION_QUEUE_PERSIST_MAX),
    currentIndex: Math.max(0, snapshot.currentIndex),
    nowPlayingTrack: isSessionPlayableTrack(snapshot.nowPlayingTrack)
      ? cloneSessionTrack(snapshot.nowPlayingTrack)
      : null,
    station: snapshot.station ? cloneStationSnapshot(snapshot.station) : snapshot.station,
  };
}

function peekPersistedSessionQueue(): PersistedSessionQueue | null {
  return readSessionStorageQueue() ?? readLastSessionSnapshot();
}

export function readPersistedActiveStationId(): string | null {
  if (canUseSessionStorage()) {
    try {
      const fromKey = window.sessionStorage.getItem(ACTIVE_STATION_ID_STORAGE_KEY)?.trim();
      if (fromKey) return fromKey;
    } catch {
      // Private mode / blocked storage.
    }
  }
  return peekPersistedSessionQueue()?.stationId?.trim() || null;
}

export function readPersistedSessionQueue(): PersistedSessionQueue | null {
  if (typeof window === "undefined") return null;

  const fromSession = readSessionStorageQueue();
  if (fromSession) return fromSession;

  const lastSession = readLastSessionSnapshot();
  if (lastSession) {
    // Promote onto this tab's sessionStorage so refresh stays tab-scoped.
    writePersistedSessionQueue(lastSession);
    return lastSession;
  }

  if (!canUseLocalStorage()) return null;
  try {
    const legacy = window.localStorage.getItem(LEGACY_LOCAL_QUEUE_KEY);
    if (!legacy) return null;
    const parsed = parseQueueBlob(legacy);
    if (parsed) {
      // Migrate onto the spec keys so the next refresh hits sessionStorage.
      writePersistedSessionQueue(parsed);
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writePersistedSessionQueue(snapshot: PersistedSessionQueue): void {
  const payload = buildPersistedPayload(snapshot);
  if (!payload) return;

  if (canUseSessionStorage()) {
    try {
      window.sessionStorage.setItem(ACTIVE_STATION_ID_STORAGE_KEY, payload.stationId);
      window.sessionStorage.setItem(ACTIVE_QUEUE_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Quota / private mode — session hydrate is best-effort.
    }
  }

  writeLastSessionSnapshot(payload);
}

export type PersistActiveStationOptions = {
  /**
   * Explicit station select / new `queueGeneration`. Drops the cached queue
   * offset so a same-id relaunch cannot resume at a stale `currentIndex`.
   * Omit on quiet session restore so the offline cache can rehydrate.
   */
  resetPlayhead?: boolean;
};

/**
 * Stamp the active station id. Local storage is an offline cache only —
 * explicit launches MUST pass `{ resetPlayhead: true }` so a new session
 * never inherits a prior `currentIndex`. Quiet restore keeps the snapshot.
 */
export function persistActiveStation(
  station: Station,
  options?: PersistActiveStationOptions,
): void {
  const existing = peekPersistedSessionQueue();
  const sameStation = existing?.stationId === station.id;
  const resetPlayhead = Boolean(options?.resetPlayhead) || !sameStation;
  writePersistedSessionQueue({
    stationId: station.id,
    queue: resetPlayhead ? [] : (existing?.queue ?? []),
    currentIndex: resetPlayhead ? 0 : (existing?.currentIndex ?? 0),
    nowPlayingTrack: resetPlayhead ? null : (existing?.nowPlayingTrack ?? null),
    station,
  });
}

export type PlayingTrackAlignTo = {
  spotifyId?: string | null;
  title?: string;
  artist?: string;
  /** Relinked playable id from the Web Playback SDK (`linked_from.id`). */
  linkedFromId?: string | null;
  /** Raw SDK / Web API `linked_from` object when callers have not flattened it. */
  linked_from?: { id?: string | null; uri?: string | null } | null;
};

function catalogIdsEquivalent(left: string, right: string): boolean {
  const a = left.trim();
  const b = right.trim();
  if (!a || !b) return false;
  if (a === b) return true;
  const aId = normalizeSpotifyTrackId(a);
  const bId = normalizeSpotifyTrackId(b);
  return Boolean(aId && bId && aId === bId);
}

function playingCatalogIds(alignTo: PlayingTrackAlignTo): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined | null) => {
    const value = raw?.trim() || "";
    if (!value || seen.has(value)) return;
    seen.add(value);
    ids.push(value);
    const normalized = normalizeSpotifyTrackId(value);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      ids.push(normalized);
    }
  };
  push(alignTo.spotifyId);
  push(alignTo.linkedFromId);
  push(alignTo.linked_from?.id);
  push(alignTo.linked_from?.uri);
  return ids;
}

export function findQueueIndexForPlayingTrack(
  tracks: readonly StationTrack[],
  alignTo: PlayingTrackAlignTo,
): number {
  const playingIds = playingCatalogIds(alignTo);
  const title = alignTo.title?.trim().toLowerCase() || "";
  const artist = alignTo.artist?.trim().toLowerCase() || "";
  return tracks.findIndex((track) => {
    const trackSpotify = track.spotifyId?.trim() || "";
    if (
      trackSpotify &&
      playingIds.some((id) => catalogIdsEquivalent(id, trackSpotify))
    ) {
      return true;
    }
    if (!title || !artist) return false;
    return (
      track.title.trim().toLowerCase() === title &&
      track.artist.trim().toLowerCase() === artist
    );
  });
}

export function playingTrackToStationTrack(
  playing: PlayingTrackAlignTo,
): StationTrack | null {
  const title = playing.title?.trim() ?? "";
  const artist = playing.artist?.trim() ?? "";
  const spotifyId = playing.spotifyId?.trim() ?? "";
  if (!title || !artist) return null;
  const out: StationTrack = { youtubeId: "", title, artist };
  if (spotifyId) out.spotifyId = spotifyId;
  return out;
}

/**
 * Tab-scoped persistence for the live station queue.
 *
 * Spotify Connect keeps playing across a refresh; React must hydrate the same
 * `stationId` + queue **before** `syncIndexToPlayingTrack` runs, or the lookup
 * misses against a fallback preset and the Playlist / Broadcast Log desync.
 *
 * Keys (sessionStorage):
 * - `songhost_active_station_id`
 * - `songhost_active_queue`
 */

import type { Station, StationTrack } from "@/data/stations";

export const ACTIVE_STATION_ID_STORAGE_KEY = "songhost_active_station_id";
export const ACTIVE_QUEUE_STORAGE_KEY = "songhost_active_queue";

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

export function readPersistedActiveStationId(): string | null {
  if (!canUseSessionStorage()) return null;
  try {
    const fromKey = window.sessionStorage.getItem(ACTIVE_STATION_ID_STORAGE_KEY)?.trim();
    if (fromKey) return fromKey;
  } catch {
    // Private mode / blocked storage.
  }
  return readPersistedSessionQueue()?.stationId?.trim() || null;
}

export function readPersistedSessionQueue(): PersistedSessionQueue | null {
  if (typeof window === "undefined") return null;

  try {
    if (canUseSessionStorage()) {
      const fromSession = window.sessionStorage.getItem(ACTIVE_QUEUE_STORAGE_KEY);
      if (fromSession) {
        const parsed = parseQueueBlob(fromSession);
        if (parsed) {
          const idKey = window.sessionStorage
            .getItem(ACTIVE_STATION_ID_STORAGE_KEY)
            ?.trim();
          if (idKey && !parsed.stationId) parsed.stationId = idKey;
          else if (idKey) parsed.stationId = idKey;
          return parsed;
        }
      }
    }
  } catch {
    // Fall through to legacy localStorage.
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
  if (!canUseSessionStorage()) return;
  const stationId = snapshot.stationId?.trim();
  if (!stationId) return;

  const payload: PersistedSessionQueue = {
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

  try {
    window.sessionStorage.setItem(ACTIVE_STATION_ID_STORAGE_KEY, stationId);
    window.sessionStorage.setItem(ACTIVE_QUEUE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota / private mode — session hydrate is best-effort.
  }
}

/** Stamp the active station id (+ optional snapshot) without clobbering a live queue. */
export function persistActiveStation(station: Station): void {
  const existing = readPersistedSessionQueue();
  writePersistedSessionQueue({
    stationId: station.id,
    queue: existing?.stationId === station.id ? existing.queue : [],
    currentIndex:
      existing?.stationId === station.id ? existing.currentIndex : 0,
    nowPlayingTrack:
      existing?.stationId === station.id ? existing.nowPlayingTrack : null,
    station,
  });
}

export type PlayingTrackAlignTo = {
  spotifyId?: string | null;
  title?: string;
  artist?: string;
};

export function findQueueIndexForPlayingTrack(
  tracks: readonly StationTrack[],
  alignTo: PlayingTrackAlignTo,
): number {
  const spotifyId = alignTo.spotifyId?.trim() || "";
  const title = alignTo.title?.trim().toLowerCase() || "";
  const artist = alignTo.artist?.trim().toLowerCase() || "";
  return tracks.findIndex((track) => {
    const trackSpotify = track.spotifyId?.trim() || "";
    if (spotifyId && trackSpotify && spotifyId === trackSpotify) return true;
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

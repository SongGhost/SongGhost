import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Station, StationTrack } from "@/data/stations";
import {
  ACTIVE_QUEUE_STORAGE_KEY,
  ACTIVE_STATION_ID_STORAGE_KEY,
  LAST_SESSION_STORAGE_KEY,
  findQueueIndexForPlayingTrack,
  persistActiveStation,
  readPersistedActiveStationId,
  readPersistedSessionQueue,
  writePersistedSessionQueue,
} from "../session-persistence";

function installStorageStub(): void {
  const session = new Map<string, string>();
  const local = new Map<string, string>();
  const make = (store: Map<string, string>) => ({
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  (globalThis as { window?: unknown }).window = {
    sessionStorage: make(session),
    localStorage: make(local),
  };
}

beforeEach(() => {
  installStorageStub();
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

const track: StationTrack = {
  youtubeId: "",
  title: "Dreams",
  artist: "Fleetwood Mac",
  spotifyId: "spotify-dreams",
};

const station: Station = {
  id: "album-deep-dive-rumours",
  name: "Rumours",
  frequency: 102.1,
  category: "genres",
  defaultPersonaId: "warm-companion",
  accentColor: "#C4882A",
  youtubeVideoId: "",
  tracks: [track],
  description: "Full album",
};

describe("writePersistedSessionQueue", () => {
  it("dual-writes tab sessionStorage and localStorage last-session snapshot", () => {
    writePersistedSessionQueue({
      stationId: station.id,
      queue: [track],
      currentIndex: 0,
      nowPlayingTrack: track,
      station,
    });

    expect(window.sessionStorage.getItem(ACTIVE_STATION_ID_STORAGE_KEY)).toBe(
      station.id,
    );
    const sessionBlob = JSON.parse(
      window.sessionStorage.getItem(ACTIVE_QUEUE_STORAGE_KEY) ?? "{}",
    ) as { stationId?: string; queue?: StationTrack[] };
    expect(sessionBlob.stationId).toBe(station.id);
    expect(sessionBlob.queue?.[0]?.spotifyId).toBe("spotify-dreams");

    const lastSession = JSON.parse(
      window.localStorage.getItem(LAST_SESSION_STORAGE_KEY) ?? "{}",
    ) as { stationId?: string; station?: Station; queue?: StationTrack[]; currentIndex?: number };
    expect(lastSession.stationId).toBe(station.id);
    expect(lastSession.station?.name).toBe("Rumours");
    expect(lastSession.queue?.[0]?.spotifyId).toBe("spotify-dreams");
    expect(lastSession.currentIndex).toBe(0);
  });
});

describe("readPersistedSessionQueue", () => {
  it("falls back to songhost:last_session when sessionStorage is empty", () => {
    writePersistedSessionQueue({
      stationId: station.id,
      queue: [track],
      currentIndex: 0,
      nowPlayingTrack: track,
      station,
    });
    window.sessionStorage.removeItem(ACTIVE_STATION_ID_STORAGE_KEY);
    window.sessionStorage.removeItem(ACTIVE_QUEUE_STORAGE_KEY);

    const restored = readPersistedSessionQueue();
    expect(restored?.stationId).toBe(station.id);
    expect(restored?.queue[0]?.spotifyId).toBe("spotify-dreams");
    expect(restored?.station?.id).toBe(station.id);
    expect(readPersistedActiveStationId()).toBe(station.id);
  });
});

describe("persistActiveStation", () => {
  it("dual-writes the station snapshot into last-session", () => {
    persistActiveStation(station);
    const lastSession = JSON.parse(
      window.localStorage.getItem(LAST_SESSION_STORAGE_KEY) ?? "{}",
    ) as { stationId?: string; station?: Station };
    expect(lastSession.stationId).toBe(station.id);
    expect(lastSession.station?.name).toBe("Rumours");
    expect(window.sessionStorage.getItem(ACTIVE_STATION_ID_STORAGE_KEY)).toBe(
      station.id,
    );
  });

  it("drops a stale currentIndex when resetPlayhead starts a new session", () => {
    writePersistedSessionQueue({
      stationId: station.id,
      queue: [track],
      currentIndex: 6,
      nowPlayingTrack: track,
      station,
    });

    persistActiveStation(station, { resetPlayhead: true });

    const restored = readPersistedSessionQueue();
    expect(restored?.stationId).toBe(station.id);
    expect(restored?.queue).toEqual([]);
    expect(restored?.currentIndex).toBe(0);
    expect(restored?.nowPlayingTrack).toBeNull();
  });

  it("keeps the cached playhead on quiet restore (no resetPlayhead)", () => {
    writePersistedSessionQueue({
      stationId: station.id,
      queue: [track],
      currentIndex: 6,
      nowPlayingTrack: track,
      station,
    });

    persistActiveStation(station);

    const restored = readPersistedSessionQueue();
    expect(restored?.currentIndex).toBe(6);
    expect(restored?.queue[0]?.spotifyId).toBe("spotify-dreams");
  });
});

describe("findQueueIndexForPlayingTrack", () => {
  const originalId = "7hanhZrUArC9qUerln4jh1";
  const relinkId = "6rqhFgbbKwnb9MLmUQDhG6";
  const tracks: StationTrack[] = [
    {
      youtubeId: "",
      title: "Dreams",
      artist: "Fleetwood Mac",
      spotifyId: originalId,
    },
    {
      youtubeId: "",
      title: "Go Your Own Way",
      artist: "Fleetwood Mac",
      spotifyId: "cccccccccccccccccccccc",
    },
  ];

  it("matches a bare catalog id against a spotify:track URI", () => {
    expect(
      findQueueIndexForPlayingTrack(tracks, {
        spotifyId: `spotify:track:${originalId}`,
      }),
    ).toBe(0);
  });

  it("matches linkedFromId / linked_from when the live id is a relink", () => {
    expect(
      findQueueIndexForPlayingTrack(tracks, {
        spotifyId: relinkId,
        linkedFromId: originalId,
      }),
    ).toBe(0);
    expect(
      findQueueIndexForPlayingTrack(tracks, {
        spotifyId: relinkId,
        linked_from: { id: originalId },
      }),
    ).toBe(0);
  });

  it("falls back to lowercase title + artist equality", () => {
    expect(
      findQueueIndexForPlayingTrack(tracks, {
        spotifyId: "dddddddddddddddddddddd",
        title: "GO YOUR OWN WAY",
        artist: "fleetwood mac",
      }),
    ).toBe(1);
  });

  it("returns -1 when neither catalog id nor title/artist match", () => {
    expect(
      findQueueIndexForPlayingTrack(tracks, {
        spotifyId: relinkId,
        title: "The Chain",
        artist: "Fleetwood Mac",
      }),
    ).toBe(-1);
  });
});

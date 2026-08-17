import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Station, StationTrack } from "@/data/stations";
import {
  ACTIVE_QUEUE_STORAGE_KEY,
  ACTIVE_STATION_ID_STORAGE_KEY,
  LAST_SESSION_STORAGE_KEY,
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
  defaultPersonaId: "kira-nova",
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
});

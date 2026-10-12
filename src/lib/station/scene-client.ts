import type { StationTrack } from "@/data/stations";
import type { PlaylistBuildUpdate } from "@/lib/station/playlist-progress";
import {
  formatMixNeighborParam,
  readStoredMixPool,
  storeMixPool,
  type MixPoolName,
  type NeighborhoodCast,
} from "@/lib/artist-mix";
import { stationPoolKey } from "@/lib/station/scene-hour";

const ART_PREFIX = "songhost-station-art:";
const ART_CAP = 24;

export function readStationArt(stationId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ART_PREFIX + stationId.trim());
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((url): url is string => typeof url === "string" && url.trim().length > 0);
  } catch {
    return [];
  }
}

export function storeStationArt(stationId: string, urls: readonly string[]): void {
  if (typeof window === "undefined") return;
  const id = stationId.trim();
  if (!id) return;
  const seen = new Set<string>();
  const next: string[] = [];
  for (const url of [...readStationArt(id), ...urls]) {
    const trimmed = url.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    next.push(trimmed);
    if (next.length >= ART_CAP) break;
  }
  if (next.length === 0) return;
  try {
    window.localStorage.setItem(ART_PREFIX + id, JSON.stringify(next));
    window.dispatchEvent(new Event("songhost-station-art"));
  } catch {
    // Private browsing can refuse storage. The card still has today's sleeve.
  }
}

export function rememberStationHour(
  stationId: string,
  value: {
    pool?: readonly MixPoolName[];
    poolAt?: number;
    cast?: NeighborhoodCast;
    art?: readonly string[];
  },
): void {
  const pool = value.pool ?? [];
  const at = value.poolAt && value.poolAt > 0 ? value.poolAt : Date.now();
  if (pool.length > 0) {
    storeMixPool(stationPoolKey(stationId), {
      pool: pool.map((entry) => ({ ...entry })),
      at,
      close: value.cast?.close ?? [],
      peer: value.cast?.peer ?? [],
      deep: value.cast?.deep ?? [],
    });
  }
  if (value.art?.length) storeStationArt(stationId, value.art);
}

/** Attach the cached pool so a warm station does not call the model again. */
export function withStationPoolParams(stationId: string, params: URLSearchParams): void {
  const stored = readStoredMixPool(stationPoolKey(stationId));
  if (!stored) return;
  params.set("pool", JSON.stringify(stored.pool));
  params.set("poolAt", String(stored.at));
  if (stored.close.length) params.set("lastClose", formatMixNeighborParam(stored.close));
  if (stored.peer.length) params.set("lastPeer", formatMixNeighborParam(stored.peer));
  if (stored.deep.length) params.set("lastDeep", formatMixNeighborParam(stored.deep));
  const used = [...stored.close, ...stored.peer, ...stored.deep];
  if (used.length) params.set("lastUsed", formatMixNeighborParam(used));
}

export type CatalogHourFetch =
  | { ok: true; tracks: StationTrack[] }
  | { ok: false };

type CatalogHourBody = {
  tracks?: StationTrack[];
  pool?: MixPoolName[];
  poolAt?: number;
  cast?: NeighborhoodCast;
  art?: string[];
  stage?: PlaylistBuildUpdate["stage"];
  songs?: number;
};

function rememberHourBody(stationId: string, data: CatalogHourBody): CatalogHourFetch {
  if (!Array.isArray(data.tracks) || data.tracks.length === 0) return { ok: false };
  rememberStationHour(stationId, data);
  return { ok: true, tracks: data.tracks };
}

/** Read newline-delimited build events. The last ready line is the hour. */
export async function readPlaylistBuildStream(
  body: ReadableStream<Uint8Array>,
  onProgress?: (update: PlaylistBuildUpdate) => void,
): Promise<CatalogHourBody | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let ready: CatalogHourBody | null = null;
  const take = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const event = JSON.parse(trimmed) as CatalogHourBody;
    const stage = event.stage;
    if (stage === "lineup" || stage === "songs" || stage === "polish" || stage === "ready" || stage === "error") {
      onProgress?.({ stage, songs: typeof event.songs === "number" ? event.songs : 0 });
    }
    if (stage === "error") ready = null;
    if (stage === "ready") ready = event;
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) take(line);
  }
  if (buffer.trim()) take(buffer);
  return ready;
}

/**
 * The catalog hour, or a failure.
 * An empty body is a failure. Callers must not substitute one starter song.
 * Pass `onProgress` to follow stages and the song count while the hour is built.
 */
export async function fetchCatalogSceneHour(
  stationId: string,
  era: string,
  onProgress?: (update: PlaylistBuildUpdate) => void,
): Promise<CatalogHourFetch> {
  const params = new URLSearchParams({
    stationId,
    era,
    allowExplicit: "true",
  });
  if (onProgress) params.set("stream", "1");
  withStationPoolParams(stationId, params);
  try {
    const res = await fetch(`/api/station-tracks?${params.toString()}`);
    if (!res.ok) return { ok: false };
    if (onProgress && res.body) {
      const data = await readPlaylistBuildStream(res.body, onProgress);
      if (!data) return { ok: false };
      return rememberHourBody(stationId, data);
    }
    const data = (await res.json()) as CatalogHourBody;
    return rememberHourBody(stationId, data);
  } catch {
    return { ok: false };
  }
}

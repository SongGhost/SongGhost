import type { Station, StationTrack } from "@/data/stations";
import { withFailedYoutubeIds } from "@/lib/failed-youtube-ids";
import type { EraLock } from "@/types/station";

export type InspiredFailureNotice = {
  title: string;
  detail: string;
};

export type InspiredLaunchPayload = {
  station: Station;
  tracks: StationTrack[];
  eraLock?: EraLock;
  energy?: number;
  catalogDepth?: number;
  decades?: string[];
  genres?: string[];
};

/**
 * The air the moment an Inspired station is chosen, before its playlist returns.
 * The previous queue is dropped. Nothing keeps playing.
 */
export function inspiredYieldState(stationName: string): {
  isPlaying: false;
  queue: [];
  currentIndex: 0;
  queueReady: false;
  nowPlaying: {
    title: string;
    artist: string;
    albumArt: "";
    youtubeId: "";
  };
} {
  const name = stationName.trim() || "Inspired station";
  return {
    isPlaying: false,
    queue: [],
    currentIndex: 0,
    queueReady: false,
    nowPlaying: {
      title: name,
      artist: "Inspired",
      albumArt: "",
      youtubeId: "",
    },
  };
}

/** Plain sentence for the deck when an Inspired station does not start. */
export function inspiredFailureNotice(
  stationName: string,
  apiError?: string,
): InspiredFailureNotice {
  const name = stationName.trim() || "that station";
  const api = apiError?.trim() ?? "";
  const title = `Couldn't start ${name}`;
  if (/network/i.test(api)) {
    return {
      title,
      detail: "That station didn't start. Check the connection and try again.",
    };
  }
  if (/no tracks/i.test(api)) {
    return {
      title,
      detail: `No songs turned up for ${name}. Nothing is playing.`,
    };
  }
  return {
    title,
    detail: "That station didn't start. Nothing is playing.",
  };
}

/**
 * Inspired station click that still needs a playlist. Takes the current
 * station off the air before `/api/station/generate` returns. A failed or
 * empty response never calls `onLaunch`.
 */
export async function performInspiredStationClick(input: {
  stationName: string;
  body: unknown;
  fetchImpl?: typeof fetch;
  onYield: (stationName: string) => void;
  onLaunch: (data: InspiredLaunchPayload) => void;
}): Promise<{ ok: true } | { ok: false; notice: InspiredFailureNotice }> {
  const name = input.stationName.trim() || "Inspired station";
  input.onYield(name);

  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl("/api/station/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(withFailedYoutubeIds(input.body)),
    });
    const data = (await res.json().catch(() => null)) as {
      station?: Station;
      tracks?: StationTrack[];
      eraLock?: EraLock;
      energy?: number;
      catalogDepth?: number;
      decades?: string[];
      genres?: string[];
      error?: string;
    } | null;
    const tracks = data?.tracks;
    const error = typeof data?.error === "string" ? data.error : undefined;
    if (!res.ok || !data?.station || !Array.isArray(tracks) || tracks.length === 0) {
      return {
        ok: false,
        notice: inspiredFailureNotice(
          name,
          error || (!res.ok ? `Inspired station generate failed (${res.status})` : "No tracks found"),
        ),
      };
    }
    input.onLaunch({
      station: data.station,
      tracks,
      eraLock: data.eraLock,
      energy: data.energy,
      catalogDepth: data.catalogDepth,
      decades: data.decades,
      genres: data.genres,
    });
    return { ok: true };
  } catch {
    return {
      ok: false,
      notice: inspiredFailureNotice(name, "Network error - try again"),
    };
  }
}

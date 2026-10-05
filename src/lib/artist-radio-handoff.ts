import type { ArtistRadioResult } from "@/lib/artist-radio";
import { mixOpensOnSeed } from "@/lib/artist-mix";

export type ArtistRadioFailureNotice = {
  title: string;
  detail: string;
};

/**
 * The air the moment Artist Radio is clicked, before /api/artist-radio returns.
 * The previous queue is dropped. Nothing keeps playing.
 */
export function artistRadioYieldState(artistName: string, stationLabel = "Artist Radio"): {
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
  const name = artistName.trim();
  const label = stationLabel.trim() || "Artist Radio";
  return {
    isPlaying: false,
    queue: [],
    currentIndex: 0,
    queueReady: false,
    nowPlaying: {
      title: name,
      artist: label,
      albumArt: "",
      youtubeId: "",
    },
  };
}

/**
 * Plain sentence for the deck when the lookup does not start a station.
 * A thin mix is still a station. This notice is only for a lookup that failed.
 */
export function artistRadioFailureNotice(
  artistName: string,
  apiError?: string,
  stationLabel = "Artist Radio",
): ArtistRadioFailureNotice {
  const name = artistName.trim() || "that artist";
  const label = stationLabel.trim() || "Artist Radio";
  const api = apiError?.trim() ?? "";
  const title = `Couldn't start ${name}`;
  if (/playable seed/i.test(api)) {
    return {
      title,
      detail: `No playable song by ${name} to open this mix. Nothing is playing.`,
    };
  }
  if (/no tracks found/i.test(api)) {
    return {
      title,
      detail: `No songs turned up for ${name}. Nothing is playing.`,
    };
  }
  if (/network/i.test(api)) {
    return {
      title,
      detail: `${label} didn't start. Check the connection and try again.`,
    };
  }
  return {
    title,
    detail: `${label} didn't start. Nothing is playing.`,
  };
}

/**
 * A home-chip or other real station start bumps the epoch. A lookup that
 * began earlier must not launch or wipe that newer station.
 */
export function artistRadioClickStillCurrent(
  epochAtClick: number,
  epochNow: number,
): boolean {
  return epochAtClick === epochNow;
}

/**
 * Artist Radio click. Takes the current station off the air before the
 * lookup returns. A failed response never calls `onLaunch`.
 */
export async function performArtistRadioClick(input: {
  artistName: string;
  requestUrl: string;
  fetchImpl?: typeof fetch;
  stationLabel?: string;
  onYield: (artistName: string, stationLabel?: string) => void;
  onLaunch: (result: ArtistRadioResult) => void;
}): Promise<{ ok: true } | { ok: false; notice: ArtistRadioFailureNotice }> {
  const name = input.artistName.trim();
  const label = input.stationLabel?.trim() || "Artist Radio";
  if (!name) {
    return {
      ok: false,
      notice: artistRadioFailureNotice("", "Missing artist name", label),
    };
  }

  input.onYield(name, label);

  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(input.requestUrl);
    const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
    if (!res.ok) {
      const error = typeof data?.error === "string" ? data.error : undefined;
      return { ok: false, notice: artistRadioFailureNotice(name, error, label) };
    }
    const result = data as ArtistRadioResult;
    if (
      result?.mode === "mixed" &&
      !mixOpensOnSeed(result.tracks ?? [], result.artistName || name)
    ) {
      return {
        ok: false,
        notice: artistRadioFailureNotice(name, "No playable seed track", label),
      };
    }
    input.onLaunch(result);
    return { ok: true };
  } catch {
    return {
      ok: false,
      notice: artistRadioFailureNotice(name, "Network error - try again", label),
    };
  }
}

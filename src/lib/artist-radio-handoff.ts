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
export function appendArtistRadioTailTracks<T extends { title: string; artist: string }>(
  playing: readonly T[],
  tail: readonly T[] | null | undefined,
): T[] {
  if (!playing.length) return tail?.length ? [...tail] : [];
  if (!tail?.length) return [...playing];
  const seen = new Set(playing.map((track) => `${track.artist}\0${track.title}`));
  const extra = tail.filter((track) => !seen.has(`${track.artist}\0${track.title}`));
  const opener = playing[0] as T;
  return [opener, ...playing.slice(1), ...extra];
}

type TailSlot = { artist: string; title: string; alt?: string[] };

/**
 * Beat 2 fills the rest of the hour. Each page is a short request so a long
 * plan is not stuffed into a URL. A failed page stops. Songs already playing stay.
 */
export async function followTailPlan<T>(input: {
  plan: readonly TailSlot[];
  fetchPage: (
    plan: readonly TailSlot[],
  ) => Promise<{ ok: boolean; tracks: readonly T[]; tailPlan?: readonly TailSlot[] }>;
  onAppend: (tracks: T[]) => void;
}): Promise<void> {
  let plan = input.plan.map((slot) => ({ ...slot }));
  let guard = 0;
  while (plan.length > 0 && guard < 8) {
    guard += 1;
    let page: { ok: boolean; tracks: readonly T[]; tailPlan?: readonly TailSlot[] };
    try {
      page = await input.fetchPage(plan);
    } catch {
      return;
    }
    if (!page.ok) return;
    if (page.tracks.length) input.onAppend([...page.tracks]);
    const next = page.tailPlan ?? [];
    if (next.length === 0 || next.length >= plan.length) return;
    plan = next.map((slot) => ({ ...slot }));
  }
}

export async function performArtistRadioClick(input: {
  artistName: string;
  requestUrl: string;
  fetchImpl?: typeof fetch;
  stationLabel?: string;
  onYield: (artistName: string, stationLabel?: string) => void;
  onLaunch: (result: ArtistRadioResult) => void;
  /** Beat 2 only. A failed tail leaves the beat-1 station playing. */
  onAppendTail?: (tracks: ArtistRadioResult["tracks"]) => void;
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
    const tailPlan = result.tailPlan;
    if (result.mode === "mixed" && tailPlan?.length && input.onAppendTail) {
      const onAppendTail = input.onAppendTail;
      await followTailPlan({
        plan: tailPlan,
        onAppend: onAppendTail,
        fetchPage: async (plan) => {
          const tailRes = await fetchImpl("/api/artist-radio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              artist: result.artistName || name,
              mode: "mixed",
              beat: 2,
              plan,
            }),
          });
          if (!tailRes.ok) return { ok: false, tracks: [] };
          const tailBody = (await tailRes.json().catch(() => null)) as {
            tracks?: ArtistRadioResult["tracks"];
            tailPlan?: TailSlot[];
          } | null;
          return {
            ok: true,
            tracks: Array.isArray(tailBody?.tracks) ? tailBody.tracks : [],
            tailPlan: Array.isArray(tailBody?.tailPlan) ? tailBody.tailPlan : [],
          };
        },
      });
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      notice: artistRadioFailureNotice(name, "Network error - try again", label),
    };
  }
}

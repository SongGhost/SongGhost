export type CuratorFailureNotice = {
  title: string;
  detail: string;
};

/**
 * The air the moment an AI prompt is sent, before /api/curate-playlist returns.
 * The previous queue is dropped. Nothing keeps playing.
 */
export function curatorYieldState(prompt: string): {
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
  const name = prompt.trim() || "this prompt";
  return {
    isPlaying: false,
    queue: [],
    currentIndex: 0,
    queueReady: false,
    nowPlaying: {
      title: name,
      artist: "AI Curator",
      albumArt: "",
      youtubeId: "",
    },
  };
}

/** Plain sentence for the deck when the prompt does not start a station. */
export function curatorFailureNotice(prompt: string, apiError?: string): CuratorFailureNotice {
  const name = prompt.trim() || "that prompt";
  const api = apiError?.trim() ?? "";
  const title = `Couldn't start ${name}`;
  if (/network/i.test(api)) {
    return {
      title,
      detail: "That station didn't start. Check the connection and try again.",
    };
  }
  if (api) return { title, detail: api };
  return {
    title,
    detail: "That station didn't start. Nothing is playing.",
  };
}

/**
 * AI prompt click. Takes the current station off the air before the lookup
 * returns. A failed response never calls `onLaunch`.
 */
export async function performCuratorClick(input: {
  prompt: string;
  body: unknown;
  fetchImpl?: typeof fetch;
  onYield: (prompt: string) => void;
  onLaunch: (data: unknown) => void;
}): Promise<{ ok: true } | { ok: false; notice: CuratorFailureNotice }> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    return { ok: false, notice: curatorFailureNotice("", "Missing prompt") };
  }

  input.onYield(prompt);

  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl("/api/curate-playlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input.body),
    });
    const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
    if (!res.ok) {
      const error = typeof data?.error === "string" ? data.error : undefined;
      return { ok: false, notice: curatorFailureNotice(prompt, error) };
    }
    input.onLaunch(data);
    return { ok: true };
  } catch {
    return {
      ok: false,
      notice: curatorFailureNotice(prompt, "Network error - try again"),
    };
  }
}

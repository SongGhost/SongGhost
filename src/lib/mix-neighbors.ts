/**
 * Artist Mix neighbor pool.
 * The model names the neighbors. A name is kept only when the catalog has a
 * real song by that artist and that song sits in the seed's era and feel.
 * Last.fm is a small backup when the model returns too few keepable names.
 * It does not rebuild the old similar-artist circle as the station.
 */

import { MIX_NEIGHBOR_TAKE } from "@/lib/artist-mix";
import {
  fetchLastFmSimilarArtistsScored,
  isLastFmConfigured,
} from "@/lib/catalog/lastfm";
import { searchITunesSongs } from "@/lib/itunes";
import { artistNamesMatch, isAcceptableArtistRadioTrack, normalizeArtistName } from "@/lib/track-quality";

/** Same short model the rest of the app uses for a tight list. */
export const MIX_NEIGHBOR_MODEL = "gpt-4o-mini";

/** How many names the model is asked for. */
export const MIX_SUGGEST_MIN = 20;
export const MIX_SUGGEST_MAX = 30;

/**
 * Neighbor step budget. The model usually speaks its first name after about
 * a second and a half, and each catalog check needs one more short beat.
 * Names are checked while later names are still arriving. At this deadline
 * the stream stops and whatever already checked out is what plays.
 */
export const MIX_NEIGHBOR_BUDGET_MS = 2400;

/** Used when a caller wants the whole list before checking the catalog. */
export const MIX_MODEL_BUDGET_MS = 1400;

/** In-flight catalog checks may finish after the stream stops. New ones may not start. */
const CATALOG_GRACE_MS = 700;

/** Below this many keepable model names, a few Last.fm names may fill in. */
export const MIX_BACKUP_MIN = 6;

/** Last.fm may add at most this many names, and only when the model list is thin. */
export const MIX_BACKUP_CAP = 4;

const ERA_WINDOW_YEARS = 18;
const CATALOG_CONCURRENCY = 12;
const CATALOG_SEARCH_LIMIT = 6;
const SEED_SEARCH_LIMIT = 12;

export const MIX_NEIGHBOR_SYSTEM_PROMPT = `You list real recording artists for a radio mix.
Reply with one artist name per line. Plain names only.
No songs, no albums, no years, no numbering, and no reasons.
Every name must be a real artist a music store can look up. Never invent a name.
Stay in the same era and the same feel as the seed artist.
Return ${MIX_SUGGEST_MIN} to ${MIX_SUGGEST_MAX} names. If you only know fewer honest neighbors, return only those.
Do not include the seed artist.
Do not fill the list with the seed artist's own side projects.
Prefer artists that are not on the avoid list when other real neighbors in that world still exist.`;

const ROCK_WORLD = new Set([
  "alternative",
  "alt rock",
  "alternative rock",
  "indie",
  "indie rock",
  "indie pop",
  "indie folk",
  "adult alternative",
  "rock",
  "pop rock",
  "hard rock",
  "folk",
  "folk rock",
  "singer songwriter",
  "americana",
  "punk",
  "pop punk",
]);

const WORLD_BY_GENRE: Record<string, string> = {
  pop: "pop",
  "hip hop rap": "hiphop",
  "hip hop": "hiphop",
  rap: "hiphop",
  country: "country",
  electronic: "electronic",
  dance: "electronic",
  edm: "electronic",
  "r and b soul": "rnb",
  "r and b": "rnb",
  soul: "rnb",
  jazz: "jazz",
  blues: "blues",
  classical: "classical",
  reggae: "reggae",
  latin: "latin",
  soundtrack: "soundtrack",
  "k pop": "kpop",
  "christian and gospel": "gospel",
  gospel: "gospel",
  metal: "metal",
  "heavy metal": "metal",
};

export type SeedWorld = {
  worlds: string[];
  years: number[];
};

export type CatalogSong = {
  artist: string;
  title: string;
  primaryGenreName?: string;
  releaseYear?: number;
  durationMs?: number;
};

type SuggestContext = { signal: AbortSignal };

export type MixNeighborDeps = {
  suggest?: (
    seedArtist: string,
    avoid: readonly string[],
    ctx?: SuggestContext,
  ) => Promise<string[]>;
  backup?: (seedArtist: string) => Promise<string[]>;
  verify?: (names: readonly string[], ctx?: SuggestContext) => Promise<string[]>;
  loadWorld?: (seedArtist: string) => Promise<SeedWorld>;
  budgetMs?: number;
  modelBudgetMs?: number;
  now?: () => number;
};

export function mixNeighborUserPrompt(seedArtist: string, avoid: readonly string[]): string {
  const blocked = avoid
    .map((name) => name.trim())
    .filter((name) => name && !artistNamesMatch(name, seedArtist))
    .slice(0, 40);
  const avoidLine = blocked.length ? blocked.join(", ") : "None yet.";
  return [
    `Seed artist: ${seedArtist}`,
    `Avoid these if other real neighbors in that world exist: ${avoidLine}`,
    `Return ${MIX_SUGGEST_MIN} to ${MIX_SUGGEST_MAX} artist names, one per line.`,
  ].join("\n");
}

function normGenre(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function genreWorld(genre: string): string {
  const norm = normGenre(genre);
  if (!norm) return "";
  if (ROCK_WORLD.has(norm)) return "rock";
  return WORLD_BY_GENRE[norm] ?? norm;
}

function medianYear(years: readonly number[]): number | null {
  if (years.length === 0) return null;
  const sorted = [...years].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const left = sorted[mid - 1];
  const right = sorted[mid];
  if (left == null || right == null) return null;
  return Math.round((left + right) / 2);
}

export function seedWorldFromSongs(songs: readonly CatalogSong[], seedArtist: string): SeedWorld {
  const worlds: string[] = [];
  const years: number[] = [];
  const seen = new Set<string>();
  for (const song of songs) {
    if (!artistNamesMatch(song.artist, seedArtist)) continue;
    if (!isAcceptableArtistRadioTrack(song.title, { durationMs: song.durationMs })) continue;
    const world = song.primaryGenreName ? genreWorld(song.primaryGenreName) : "";
    if (world && !seen.has(world)) {
      seen.add(world);
      worlds.push(world);
    }
    if (song.releaseYear != null && Number.isFinite(song.releaseYear)) years.push(song.releaseYear);
  }
  return { worlds, years };
}

function songFitsWorld(song: CatalogSong, world: SeedWorld): boolean {
  if (!song.primaryGenreName) return false;
  const songWorld = genreWorld(song.primaryGenreName);
  if (!songWorld || !world.worlds.includes(songWorld)) return false;
  const mid = medianYear(world.years);
  if (mid != null && song.releaseYear != null && Math.abs(song.releaseYear - mid) > ERA_WINDOW_YEARS) {
    return false;
  }
  return true;
}

/** True when one of these catalog rows is a real song in the seed's world. */
export function catalogSongsFitWorld(
  songs: readonly CatalogSong[],
  artistName: string,
  world: SeedWorld,
): boolean {
  if (world.worlds.length === 0) return false;
  return songs.some(
    (song) =>
      artistNamesMatch(song.artist, artistName) &&
      isAcceptableArtistRadioTrack(song.title, { durationMs: song.durationMs }) &&
      songFitsWorld(song, world),
  );
}

function plausibleArtistName(name: string): boolean {
  if (name.length < 2 || name.length > 80) return false;
  if (/[\r\n.!?]/.test(name)) return false;
  if (/https?:|www\./i.test(name)) return false;
  if (name.includes(" - ")) return false;
  const words = name.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 8;
}

function cleanListLine(line: string): string {
  return line
    .trim()
    .replace(/^[-*•]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^["']+|["']+$/g, "")
    .trim();
}

function takeUniqueNames(candidates: readonly string[], seedArtist: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of candidates) {
    const name = candidate.trim();
    if (!plausibleArtistName(name)) continue;
    if (artistNamesMatch(name, seedArtist)) continue;
    const key = normalizeArtistName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MIX_SUGGEST_MAX) break;
  }
  return out;
}

/** Artist names from a plain list. A JSON list is accepted if the model sends one. */
export function parseSuggestedNeighborNames(raw: string, seedArtist: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { artists?: unknown };
      if (Array.isArray(parsed.artists)) {
        return takeUniqueNames(
          parsed.artists.filter((item): item is string => typeof item === "string"),
          seedArtist,
        );
      }
    } catch {
      return [];
    }
  }

  return takeUniqueNames(trimmed.split(/\n/).map(cleanListLine), seedArtist);
}

function abortAfter(ms: number): { signal: AbortSignal; cancel: () => void; abort: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    abort: () => controller.abort(),
    cancel: () => clearTimeout(timer),
  };
}

async function withDeadline<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), Math.max(0, ms));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function neighborRequestBody(seed: string, avoid: readonly string[], stream: boolean) {
  return {
    model: MIX_NEIGHBOR_MODEL,
    messages: [
      { role: "system", content: MIX_NEIGHBOR_SYSTEM_PROMPT },
      { role: "user", content: mixNeighborUserPrompt(seed, avoid) },
    ],
    max_tokens: 320,
    temperature: 1,
    ...(stream ? { stream: true } : {}),
  };
}

/** One complete line from a streamed list. Duplicate and junk lines return null. */
export function takeStreamName(line: string, seedArtist: string, seen: Set<string>): string | null {
  const [name] = takeUniqueNames([cleanListLine(line)], seedArtist);
  if (!name) return null;
  const key = normalizeArtistName(name);
  if (!key || seen.has(key)) return null;
  seen.add(key);
  return name;
}

async function readNeighborStream(
  response: Response,
  seedArtist: string,
  onName: (name: string) => void,
): Promise<number> {
  const seen = new Set<string>();
  let count = 0;
  const emit = (line: string) => {
    const name = takeStreamName(line, seedArtist, seen);
    if (!name) return;
    count += 1;
    onName(name);
  };

  if (!response.body) {
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    for (const part of (data.choices?.[0]?.message?.content ?? "").split("\n")) emit(part);
    return count;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let frame = "";
  let line = "";

  const consumeDelta = (delta: string) => {
    line += delta;
    if (!line.includes("\n")) return;
    const parts = line.split("\n");
    line = parts.pop() ?? "";
    for (const part of parts) emit(part);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      frame += decoder.decode(value, { stream: true });
      const chunks = frame.split("\n");
      frame = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const trimmed = chunk.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
          consumeDelta(json.choices?.[0]?.delta?.content ?? "");
        } catch {
          // A partial frame is completed on the next chunk.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (line.trim()) emit(line);
  return count;
}

/**
 * Streams neighbor names and calls onName as each line arrives.
 * No key, a bad response, or a timeout returns zero.
 */
export async function streamNeighborArtists(
  seedArtist: string,
  avoid: readonly string[] = [],
  options?: {
    fetchImpl?: typeof fetch;
    apiKey?: string;
    signal?: AbortSignal;
    onName?: (name: string) => void;
  },
): Promise<number> {
  const seed = seedArtist.trim();
  if (!seed) return 0;
  const apiKey = (options?.apiKey ?? process.env.OPENAI_API_KEY)?.trim() ?? "";
  if (!apiKey) return 0;

  const fetchImpl = options?.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: options?.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(neighborRequestBody(seed, avoid, true)),
      cache: "no-store",
    });
    if (!response.ok) return 0;
    return await readNeighborStream(response, seed, options?.onName ?? (() => undefined));
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return 0;
    console.warn("[mix-neighbors] suggestion skipped:", error);
    return 0;
  }
}

/**
 * One fresh model pass for neighbor names.
 * No key, a bad response, or a timeout returns an empty list.
 */
export async function suggestNeighborArtists(
  seedArtist: string,
  avoid: readonly string[] = [],
  options?: { fetchImpl?: typeof fetch; apiKey?: string; signal?: AbortSignal; modelBudgetMs?: number },
): Promise<string[]> {
  const seed = seedArtist.trim();
  if (!seed) return [];
  const apiKey = (options?.apiKey ?? process.env.OPENAI_API_KEY)?.trim() ?? "";
  if (!apiKey) return [];

  const fetchImpl = options?.fetchImpl ?? fetch;
  const budget = options?.modelBudgetMs ?? MIX_MODEL_BUDGET_MS;
  const local = abortAfter(budget);
  const signal = options?.signal ?? local.signal;
  if (options?.signal) {
    if (options.signal.aborted) local.cancel();
    else options.signal.addEventListener("abort", () => local.cancel(), { once: true });
  }

  try {
    const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(neighborRequestBody(seed, avoid, false)),
      cache: "no-store",
    });
    if (!response.ok) return [];
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) return [];
    return parseSuggestedNeighborNames(content, seed);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return [];
    console.warn("[mix-neighbors] suggestion skipped:", error);
    return [];
  } finally {
    local.cancel();
  }
}

async function mapUntilDeadline<T>(
  items: readonly T[],
  concurrency: number,
  deadline: number,
  now: () => number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0 || now() >= deadline) return;
  let cursor = 0;
  const workers = Math.min(concurrency, items.length);

  async function worker(): Promise<void> {
    while (now() < deadline && cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await fn(items[index] as T);
    }
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, deadline - now()));
    void Promise.all(Array.from({ length: workers }, () => worker())).finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function loadSeedWorld(seedArtist: string): Promise<SeedWorld> {
  try {
    const songs = await searchITunesSongs(seedArtist, SEED_SEARCH_LIMIT);
    return seedWorldFromSongs(songs, seedArtist);
  } catch {
    return { worlds: [], years: [] };
  }
}

async function verifyNamesInWorld(
  names: readonly string[],
  world: SeedWorld,
  deadline: number,
  now: () => number,
): Promise<string[]> {
  if (world.worlds.length === 0 || names.length === 0) return [];
  const good = new Set<string>();

  await mapUntilDeadline(names, CATALOG_CONCURRENCY, deadline, now, async (name) => {
    try {
      const songs = await searchITunesSongs(name, CATALOG_SEARCH_LIMIT);
      if (catalogSongsFitWorld(songs, name, world)) good.add(normalizeArtistName(name));
    } catch {
      // A failed lookup drops that name. It does not stop the rest.
    }
  });

  return names.filter((name) => good.has(normalizeArtistName(name)));
}

async function fetchSmallLastFmBackup(seedArtist: string): Promise<string[]> {
  if (!isLastFmConfigured()) return [];
  try {
    const scored = await fetchLastFmSimilarArtistsScored(seedArtist, 8);
    return scored.map((item) => item.name);
  } catch {
    return [];
  }
}

function preferFresh(names: readonly string[], previous: readonly string[]): string[] {
  const avoid = new Set(previous.map((name) => normalizeArtistName(name)).filter(Boolean));
  const fresh = avoid.size
    ? names.filter((name) => !avoid.has(normalizeArtistName(name)))
    : [...names];
  return fresh.length > 0 ? fresh : [...names];
}

/** Samples across the list so the first few obvious names do not fill the station. */
export function spreadNeighborTake(names: readonly string[], take = MIX_NEIGHBOR_TAKE): string[] {
  if (take <= 0) return [];
  if (names.length <= take) return [...names];
  const out: string[] = [];
  const used = new Set<number>();
  const step = names.length / take;
  for (let i = 0; i < take; i += 1) {
    let index = Math.min(names.length - 1, Math.floor(i * step));
    while (used.has(index) && index + 1 < names.length) index += 1;
    used.add(index);
    const name = names[index];
    if (name) out.push(name);
  }
  return out;
}

function novelNames(names: readonly string[], blocked: readonly string[], cap: number): string[] {
  const avoid = new Set(blocked.map((name) => normalizeArtistName(name)).filter(Boolean));
  const out: string[] = [];
  for (const name of names) {
    const key = normalizeArtistName(name);
    if (!key || avoid.has(key)) continue;
    avoid.add(key);
    out.push(name);
    if (out.length >= cap) break;
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Live neighbor step. Names are catalog-checked as the model speaks them.
 * The stream is cut at the budget. Checks already running may finish.
 * Last.fm is asked only when the model has not named anyone yet.
 */
async function assembleLiveMixNeighbors(
  seed: string,
  previous: readonly string[],
  deps?: MixNeighborDeps,
): Promise<string[]> {
  const now = deps?.now ?? Date.now;
  const started = now();
  const budget = deps?.budgetMs ?? MIX_NEIGHBOR_BUDGET_MS;
  const deadline = started + budget;
  const loadWorld = deps?.loadWorld ?? loadSeedWorld;
  const overall = abortAfter(Math.max(0, deadline - now()));

  let world: SeedWorld = { worlds: [], years: [] };
  let worldReady = false;
  const worldTask = loadWorld(seed)
    .then((loaded) => {
      world = loaded;
      worldReady = true;
    })
    .catch(() => {
      worldReady = true;
    });

  const pending: string[] = [];
  const kept: string[] = [];
  let active = 0;
  let suggested = 0;
  let backupPromise: Promise<string[]> | null = null;

  const pump = () => {
    if (!worldReady || world.worlds.length === 0) return;
    while (active < CATALOG_CONCURRENCY && pending.length > 0 && now() <= deadline) {
      const name = pending.shift();
      if (!name) break;
      active += 1;
      void (async () => {
        try {
          const songs = await searchITunesSongs(name, CATALOG_SEARCH_LIMIT);
          if (catalogSongsFitWorld(songs, name, world)) kept.push(name);
        } catch {
          // A failed lookup drops that name.
        } finally {
          active -= 1;
          pump();
        }
      })();
    }
  };

  void worldTask.then(() => pump());

  const backupTimer = setTimeout(() => {
    if (suggested === 0) backupPromise = fetchSmallLastFmBackup(seed);
  }, Math.min(1600, budget));

  try {
    await streamNeighborArtists(seed, previous, {
      signal: overall.signal,
      onName: (name) => {
        suggested += 1;
        pending.push(name);
        pump();
      },
    });
  } finally {
    clearTimeout(backupTimer);
    overall.abort();
    overall.cancel();
  }

  const hardStop = deadline + CATALOG_GRACE_MS;
  while ((active > 0 || (!worldReady && pending.length > 0)) && now() < hardStop) {
    await sleep(25);
    pump();
  }

  let chosen = spreadNeighborTake(preferFresh(kept, previous));
  let backupAdded = 0;

  if (chosen.length < MIX_BACKUP_MIN && (backupPromise || chosen.length === 0)) {
    const backupNames = backupPromise
      ? await withDeadline(backupPromise, chosen.length === 0 ? 700 : 200, [] as string[])
      : chosen.length === 0
        ? await withDeadline(fetchSmallLastFmBackup(seed), 700, [] as string[])
        : [];
    if (backupNames.length && world.worlds.length > 0) {
      const verifiedBackup = await verifyNamesInWorld(
        backupNames,
        world,
        now() + (chosen.length === 0 ? 700 : 200),
        now,
      );
      const blocked = [...previous, ...chosen];
      let extra = novelNames(verifiedBackup, blocked, MIX_BACKUP_CAP);
      if (extra.length === 0 && chosen.length === 0) {
        extra = verifiedBackup.filter((name) => !artistNamesMatch(name, seed)).slice(0, MIX_BACKUP_CAP);
      }
      backupAdded = extra.length;
      chosen = [...chosen, ...extra];
    }
  }

  const result = chosen.filter((name) => !artistNamesMatch(name, seed));
  console.info(
    `[mix-neighbors] ${seed} model=${suggested} kept=${result.length} backup=${backupAdded} ms=${now() - started}`,
  );
  return result;
}

/**
 * A new model pass owns this launch.
 * Previous neighbors are skipped when other keepable names exist.
 * Last.fm adds at most a few names when the model list is too short.
 */
export async function assembleMixNeighbors(
  artistName: string,
  previous: readonly string[] = [],
  deps?: MixNeighborDeps,
): Promise<string[]> {
  const seed = artistName.trim();
  if (!seed) return [];

  if (!deps?.suggest && !deps?.verify) {
    return assembleLiveMixNeighbors(seed, previous, deps);
  }

  const now = deps?.now ?? Date.now;
  const started = now();
  const budget = deps?.budgetMs ?? MIX_NEIGHBOR_BUDGET_MS;
  const modelBudget = Math.min(deps?.modelBudgetMs ?? MIX_MODEL_BUDGET_MS, budget);
  const deadline = started + budget;
  const suggest = deps?.suggest ?? suggestNeighborArtists;
  const backup = deps?.backup ?? fetchSmallLastFmBackup;
  const loadWorld = deps?.loadWorld ?? loadSeedWorld;
  const emptyWorld: SeedWorld = { worlds: [], years: [] };

  const overall = abortAfter(budget);
  const model = abortAfter(modelBudget);
  let suggested: string[] = [];
  let world: SeedWorld = emptyWorld;
  try {
    const [names, loaded] = await Promise.all([
      withDeadline(
        suggest(seed, previous, { signal: model.signal }).catch(() => [] as string[]),
        modelBudget,
        [] as string[],
      ),
      deps?.verify
        ? Promise.resolve(emptyWorld)
        : withDeadline(loadWorld(seed).catch(() => emptyWorld), modelBudget, emptyWorld),
    ]);
    suggested = names;
    world = loaded;
  } finally {
    model.abort();
    model.cancel();
  }

  const verify =
    deps?.verify ??
    ((names: readonly string[]) => verifyNamesInWorld(names, world, deadline, now));

  const verified = suggested.length
    ? deps?.verify
      ? await withDeadline(
          verify(suggested, { signal: overall.signal }).catch(() => [] as string[]),
          Math.max(0, deadline - now()),
          [] as string[],
        )
      : await verify(suggested, { signal: overall.signal }).catch(() => [] as string[])
    : [];

  let chosen = spreadNeighborTake(preferFresh(verified, previous));
  let backupAdded = 0;

  if (chosen.length < MIX_BACKUP_MIN && now() < deadline) {
    const backupNames = await withDeadline(
      backup(seed).catch(() => [] as string[]),
      Math.max(0, deadline - now()),
      [] as string[],
    );
    const verifiedBackup = backupNames.length
      ? deps?.verify
        ? await withDeadline(
            verify(backupNames, { signal: overall.signal }).catch(() => [] as string[]),
            Math.max(0, deadline - now()),
            [] as string[],
          )
        : await verify(backupNames, { signal: overall.signal }).catch(() => [] as string[])
      : [];
    const blocked = [...previous, ...chosen];
    let extra = novelNames(verifiedBackup, blocked, MIX_BACKUP_CAP);
    if (extra.length === 0 && chosen.length === 0) {
      extra = verifiedBackup
        .filter((name) => !artistNamesMatch(name, seed))
        .slice(0, MIX_BACKUP_CAP);
    }
    backupAdded = extra.length;
    chosen = [...chosen, ...extra];
  }

  const result = chosen.filter((name) => !artistNamesMatch(name, seed));
  console.info(
    `[mix-neighbors] ${seed} model=${suggested.length} kept=${result.length} backup=${backupAdded} ms=${now() - started}`,
  );
  overall.abort();
  overall.cancel();
  return result;
}

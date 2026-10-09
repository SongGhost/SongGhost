/**
 * Neighborhood pool for a wide station.
 * Last.fm says who listeners also play. gpt-4o judges that evidence.
 * A name is kept when the catalog has a real song and it is not a hard
 * world clash. The draw in artist-mix.ts decides how many songs each tier gets.
 */

import {
  MIX_NEIGHBOR_TAKE,
  type MixPoolName,
} from "@/lib/artist-mix";
import {
  fetchLastFmSimilarArtistsScored,
  isLastFmConfigured,
  type LastFmSimilarArtistScored,
} from "@/lib/catalog/lastfm";
import { searchITunesSongs } from "@/lib/itunes";
import { anchorArtistsForSeed } from "@/lib/similar-artists";
import { artistNamesMatch, isAcceptableArtistRadioTrack, normalizeArtistName } from "@/lib/track-quality";

/** This call only. The DJ writer is a different model and stays where it is. */
export const MIX_NEIGHBOR_MODEL = "gpt-4o";

export const MIX_NEIGHBOR_TEMPERATURE = 0.4;

/** How many names the model may return. Fewer honest names is correct. */
export const MIX_SUGGEST_MIN = 12;
export const MIX_SUGGEST_MAX = 40;

/** Cache miss budget for the model. Catalog checks already running may finish. */
export const MIX_NEIGHBOR_BUDGET_MS = 12_000;

/** Used when a caller wants the whole list before checking the catalog. */
export const MIX_MODEL_BUDGET_MS = MIX_NEIGHBOR_BUDGET_MS;

const CATALOG_GRACE_MS = 4_000;
const CATALOG_CONCURRENCY = 12;
const CATALOG_SEARCH_LIMIT = 6;
const SEED_SEARCH_LIMIT = 8;
const POOL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const POOL_MIN = 12;
const LASTFM_MATCH_MIN = 0.4;
const LASTFM_ASK = 40;

export const MIX_NEIGHBOR_SYSTEM_PROMPT = `You list real recording artists for a radio mix.
Reply with one artist name per line. Plain names only.
No songs, no albums, no years, no numbering, and no reasons.
Every name must be a real artist a music store can look up. Never invent a name.
Return up to ${MIX_SUGGEST_MAX} names, best fit first. If you only know fewer honest neighbors, return only those.
Do not include the seed artist.

Derive these four vectors from the seed, then judge every candidate.
1. Timbre and vocal (25%) — the vocal presence a fan came for. Opposite voices fail.
2. Rhythm and arrangement (25%) — drums, guitars, orchestration, or production the seed actually uses.
3. Lyrics and ideas (20%) — subject and tone. Opposite-mood writing fails.
4. Ecosystem (20%) — collaborations, side projects, shared producers, tours, and the Last.fm names below. Side projects are wanted.

Quality (10%), as a gate: respected recordings, real songs, no local clones, no pure imitators. The pool must span reach: a few landmarks a casual fan knows, a run of peers, and a deeper shelf that still passes the vectors.

Example of the judgment, not a list to reuse: for The National, keep low intimate vocals, motorik drums and chamber arrangements, literate anxious lyrics, and the real circle (Dessner collaborators, EL VY, Big Red Machine, tourmates, listeners who play both). Drop party rock, generic stadium rock, and unrelated classic rock. A hip-hop or country seed gets its own answers to the same four questions.

Last.fm scores are evidence of who real listeners also play. A high score does not survive a failed vector. A missing Last.fm name can still be added when the vectors and the ecosystem support it.
Do not let one collaborator family take the list. Name side projects and direct collaborators so the pool has them. Mark each of those with a trailing asterisk.
Era is a clue. Do not enforce an 18-year wall. A younger collaborator can sit with the seed.
Stay in the seed's tradition. Hip-hop does not join an alternative seed because both are moody.
The avoid list is rotation, not a ban from the pool. Prefer names that are not on it when other honest neighbors exist.`;

export const SCENE_NEIGHBOR_SYSTEM_PROMPT = `You list real recording artists for a radio scene.
Reply with one artist name per line. Plain names only.
No songs, no albums, no years, no numbering, and no reasons.
Every name must be a real artist a music store can look up. Never invent a name.
Return up to ${MIX_SUGGEST_MAX} names, best fit first. If you only know fewer honest artists for this scene, return only those.

There is no single seed artist. Derive the same four vectors from the scene, then judge every name.
1. Timbre and vocal (25%) — the vocal presence the scene calls for. Opposite voices fail.
2. Rhythm and arrangement (25%) — drums, guitars, orchestration, or production the scene actually uses.
3. Lyrics and ideas (20%) — subject and tone. Opposite-mood writing fails.
4. Ecosystem (20%) — collaborations, side projects, shared producers, tours, and listeners who play both. Side projects are wanted.

Quality (10%), as a gate: respected recordings, real songs, no local clones, no pure imitators. Span reach: a few landmarks, a run of peers, and a deeper shelf that still passes the vectors.

Example of the judgment, not a list to reuse: for The National, keep low intimate vocals, motorik drums and chamber arrangements, literate anxious lyrics, and the real circle (Dessner collaborators, EL VY, Big Red Machine). Drop party rock and unrelated classic rock. A hip-hop or country scene gets its own answers to the same four questions.

Last.fm is not attached to a scene with no seed artist. Do not invent a similar-artist circle.
Stay in the scene's tradition, decade, and mood. The avoid list is rotation, not a ban. Prefer names that are not on it when other honest artists for this scene exist.
Mark a side project or direct collaborator of another name on your list with a trailing asterisk.`;

const ROCK_FAMILY = new Set([
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
  "classic rock",
  "folk",
  "folk rock",
  "singer songwriter",
  "americana",
  "punk",
  "pop punk",
]);

const FAMILY_BY_GENRE: Record<string, string> = {
  "hip hop rap": "hiphop",
  "hip hop": "hiphop",
  rap: "hiphop",
  country: "country",
  electronic: "electronic",
  dance: "electronic",
  edm: "electronic",
  jazz: "jazz",
  classical: "classical",
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
  backup?: (seedArtist: string) => Promise<Array<string | LastFmSimilarArtistScored>>;
  anchors?: (seedArtist: string) => Promise<string[]>;
  lastFm?: (seedArtist: string) => Promise<LastFmSimilarArtistScored[]>;
  verify?: (names: readonly string[], ctx?: SuggestContext) => Promise<string[]>;
  loadWorld?: (seedArtist: string) => Promise<SeedWorld>;
  budgetMs?: number;
  modelBudgetMs?: number;
  now?: () => number;
  cached?: { names: readonly MixPoolName[]; at: number } | null;
};

type PoolCache = { names: MixPoolName[]; at: number };

const poolCache = new Map<string, PoolCache>();

export function clearNeighborhoodPools(): void {
  poolCache.clear();
}

export function neighborhoodPoolIsFresh(
  names: readonly MixPoolName[],
  at: number,
  now = Date.now(),
): boolean {
  return names.length >= POOL_MIN && at > 0 && now >= at && now - at <= POOL_TTL_MS;
}

export function recallNeighborhoodPool(artist: string, now = Date.now()): MixPoolName[] | null {
  const row = poolCache.get(normalizeArtistName(artist));
  if (!row || !neighborhoodPoolIsFresh(row.names, row.at, now)) return null;
  return row.names.map((entry) => ({ ...entry }));
}

export function rememberNeighborhoodPool(
  artist: string,
  names: readonly MixPoolName[],
  now = Date.now(),
): void {
  const key = normalizeArtistName(artist);
  if (!key || names.length === 0) return;
  poolCache.set(key, {
    names: names.slice(0, MIX_SUGGEST_MAX).map((entry) => ({ ...entry })),
    at: now,
  });
}

export function mixNeighborUserPrompt(
  seedArtist: string,
  avoid: readonly string[],
  lastFm: readonly { name: string; match: number }[] = [],
): string {
  const blocked = avoid
    .map((name) => name.trim())
    .filter((name) => name && !artistNamesMatch(name, seedArtist))
    .slice(0, 40);
  const avoidLine = blocked.length ? blocked.join(", ") : "None yet.";
  const evidence = lastFm
    .map((item) => {
      const name = item.name.trim();
      if (!name) return "";
      const match = Number.isFinite(item.match) ? item.match : 0;
      return `${name} (match ${match.toFixed(2)})`;
    })
    .filter(Boolean);
  return [
    `Seed artist: ${seedArtist}`,
    "Last.fm listeners also play:",
    evidence.length ? evidence.join("\n") : "None returned.",
    `Avoid list (rotation, not a ban from the pool): ${avoidLine}`,
    "The 3 closest names from last time may sit on that avoid list. They can still be named.",
    `Return up to ${MIX_SUGGEST_MAX} artist names, best fit first, one per line.`,
  ].join("\n");
}

export function sceneNeighborUserPrompt(scene: string, avoid: readonly string[] = []): string {
  const blocked = avoid.map((name) => name.trim()).filter(Boolean).slice(0, 40);
  const avoidLine = blocked.length ? blocked.join(", ") : "None yet.";
  return [
    `Scene: ${scene}`,
    `Avoid list (rotation, not a ban): ${avoidLine}`,
    `Return up to ${MIX_SUGGEST_MAX} artist names, best fit first, one per line.`,
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

/** Hard family used only to reject a world clash. A missing tag returns null. */
export function hardFamily(genre: string | undefined): string | null {
  if (!genre?.trim()) return null;
  const norm = normGenre(genre);
  if (!norm) return null;
  if (ROCK_FAMILY.has(norm)) return "rock";
  if (FAMILY_BY_GENRE[norm]) return FAMILY_BY_GENRE[norm];
  if (norm.includes("hip hop") || norm === "rap") return "hiphop";
  return null;
}

export function hardWorldClash(seedWorlds: readonly string[], songGenre: string | undefined): boolean {
  if (!songGenre?.trim()) return false;
  const songFamily = hardFamily(songGenre);
  if (!songFamily) return false;
  const seedFamilies = seedWorlds.filter((world) => world === "rock" || world === "hiphop" || world === "country" || world === "jazz" || world === "classical" || world === "metal" || world === "electronic");
  if (seedFamilies.length === 0) return false;
  return seedFamilies.every((seed) => seed !== songFamily);
}

export function seedWorldFromSongs(songs: readonly CatalogSong[], seedArtist: string): SeedWorld {
  const worlds: string[] = [];
  const years: number[] = [];
  const seen = new Set<string>();
  for (const song of songs) {
    if (!artistNamesMatch(song.artist, seedArtist)) continue;
    if (!isAcceptableArtistRadioTrack(song.title, { durationMs: song.durationMs })) continue;
    const family = hardFamily(song.primaryGenreName);
    if (family && !seen.has(family)) {
      seen.add(family);
      worlds.push(family);
    }
    if (song.releaseYear != null && Number.isFinite(song.releaseYear)) years.push(song.releaseYear);
  }
  return { worlds, years };
}

/**
 * Keep a name when one acceptable catalog song is not a hard world clash.
 * A missing genre tag does not drop the name. Release year does not drop it.
 */
export function catalogNameKeepable(
  songs: readonly CatalogSong[],
  artistName: string,
  world: SeedWorld,
): boolean {
  const rows = songs.filter(
    (song) =>
      artistNamesMatch(song.artist, artistName) &&
      isAcceptableArtistRadioTrack(song.title, { durationMs: song.durationMs }),
  );
  if (rows.length === 0) return false;
  return rows.some((song) => !hardWorldClash(world.worlds, song.primaryGenreName));
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
    .replace(/\s+\*\s*$/, "")
    .replace(/\s*\[ecosystem\]\s*$/i, "")
    .replace(/^["']+|["']+$/g, "")
    .trim();
}

function takeUniqueNames(candidates: readonly string[], seedArtist: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of candidates) {
    const name = candidate.trim();
    if (!plausibleArtistName(name)) continue;
    if (seedArtist && artistNamesMatch(name, seedArtist)) continue;
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

/** Trailing asterisk marks a side project or direct collaborator. No mark means no flag. */
export function ecosystemNamesFromList(raw: string, seedArtist: string): string[] {
  const flagged = raw
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => /\*\s*$/.test(line) || /\[ecosystem\]\s*$/i.test(line));
  return parseSuggestedNeighborNames(flagged.join("\n"), seedArtist);
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

function neighborRequestBody(
  seed: string,
  avoid: readonly string[],
  lastFm: readonly { name: string; match: number }[],
  stream: boolean,
) {
  return {
    model: MIX_NEIGHBOR_MODEL,
    temperature: MIX_NEIGHBOR_TEMPERATURE,
    messages: [
      { role: "system", content: MIX_NEIGHBOR_SYSTEM_PROMPT },
      { role: "user", content: mixNeighborUserPrompt(seed, avoid, lastFm) },
    ],
    max_tokens: 900,
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

/**
 * One fresh model pass for neighbor names.
 * No key, a bad response, or a timeout returns an empty list.
 */
export async function suggestNeighborArtists(
  seedArtist: string,
  avoid: readonly string[] = [],
  options?: {
    fetchImpl?: typeof fetch;
    apiKey?: string;
    signal?: AbortSignal;
    modelBudgetMs?: number;
    lastFm?: readonly { name: string; match: number }[];
  },
): Promise<string[]> {
  const read = await readNeighborSuggestion(seedArtist, avoid, options);
  return read.names;
}

async function readNeighborSuggestion(
  seedArtist: string,
  avoid: readonly string[] = [],
  options?: {
    fetchImpl?: typeof fetch;
    apiKey?: string;
    signal?: AbortSignal;
    modelBudgetMs?: number;
    lastFm?: readonly { name: string; match: number }[];
    scene?: boolean;
    sceneText?: string;
  },
): Promise<{ names: string[]; ecosystem: string[] }> {
  const seed = seedArtist.trim();
  const scene = options?.sceneText?.trim() ?? "";
  if (!seed && !scene) return { names: [], ecosystem: [] };
  const apiKey = (options?.apiKey ?? process.env.OPENAI_API_KEY)?.trim() ?? "";
  if (!apiKey) return { names: [], ecosystem: [] };

  const fetchImpl = options?.fetchImpl ?? fetch;
  const budget = options?.modelBudgetMs ?? MIX_MODEL_BUDGET_MS;
  const local = abortAfter(budget);
  const signal = options?.signal ?? local.signal;
  if (options?.signal) {
    if (options.signal.aborted) local.cancel();
    else options.signal.addEventListener("abort", () => local.cancel(), { once: true });
  }

  const body = options?.scene
    ? {
        model: MIX_NEIGHBOR_MODEL,
        temperature: MIX_NEIGHBOR_TEMPERATURE,
        messages: [
          { role: "system", content: SCENE_NEIGHBOR_SYSTEM_PROMPT },
          { role: "user", content: sceneNeighborUserPrompt(scene, avoid) },
        ],
        max_tokens: 900,
      }
    : neighborRequestBody(seed, avoid, options?.lastFm ?? [], false);

  try {
    const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!response.ok) return { names: [], ecosystem: [] };
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) return { names: [], ecosystem: [] };
    return {
      names: parseSuggestedNeighborNames(content, seed),
      ecosystem: ecosystemNamesFromList(content, seed),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { names: [], ecosystem: [] };
    console.warn("[mix-neighbors] suggestion skipped:", error);
    return { names: [], ecosystem: [] };
  } finally {
    local.cancel();
  }
}

export async function suggestSceneArtists(
  scene: string,
  avoid: readonly string[] = [],
  options?: { fetchImpl?: typeof fetch; apiKey?: string; signal?: AbortSignal; modelBudgetMs?: number },
): Promise<string[]> {
  const read = await readNeighborSuggestion("", avoid, { ...options, scene: true, sceneText: scene });
  return read.names;
}

async function loadSeedWorld(seedArtist: string): Promise<SeedWorld> {
  try {
    const songs = await searchITunesSongs(seedArtist, SEED_SEARCH_LIMIT);
    return seedWorldFromSongs(songs, seedArtist);
  } catch {
    return { worlds: [], years: [] };
  }
}

async function verifyNames(
  names: readonly string[],
  world: SeedWorld,
  deadline: number,
  now: () => number,
): Promise<string[]> {
  if (names.length === 0 || now() >= deadline) return [];
  const good = new Set<string>();
  let cursor = 0;

  async function worker(): Promise<void> {
    while (now() < deadline && cursor < names.length) {
      const name = names[cursor];
      cursor += 1;
      if (!name) continue;
      try {
        const songs = await searchITunesSongs(name, CATALOG_SEARCH_LIMIT);
        if (catalogNameKeepable(songs, name, world)) good.add(normalizeArtistName(name));
      } catch {
        // A failed lookup drops that name.
      }
    }
  }

  const workers = Math.min(CATALOG_CONCURRENCY, names.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return names.filter((name) => good.has(normalizeArtistName(name)));
}

async function fetchLastFmEvidence(seedArtist: string): Promise<LastFmSimilarArtistScored[]> {
  if (!isLastFmConfigured()) return [];
  try {
    return await fetchLastFmSimilarArtistsScored(seedArtist, LASTFM_ASK);
  } catch {
    return [];
  }
}

function matchMap(scored: readonly LastFmSimilarArtistScored[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of scored) {
    const key = normalizeArtistName(item.name);
    if (!key || out.has(key)) continue;
    if (!Number.isFinite(item.match)) continue;
    out.set(key, item.match);
  }
  return out;
}

/**
 * Names both the model and Last.fm support move up inside their band.
 * The model order otherwise stays. Bands do not mix.
 */
export function promoteSupportedWithinBands(
  names: readonly string[],
  scores: ReadonlyMap<string, number>,
  threshold = LASTFM_MATCH_MIN,
): string[] {
  const bands = [names.slice(0, 10), names.slice(10, 25), names.slice(25)];
  const out: string[] = [];
  for (const band of bands) {
    const hot: string[] = [];
    const rest: string[] = [];
    for (const name of band) {
      const match = scores.get(normalizeArtistName(name));
      if (match != null && match >= threshold) hot.push(name);
      else rest.push(name);
    }
    out.push(...hot, ...rest);
  }
  return out;
}

function toPool(
  names: readonly string[],
  scores: ReadonlyMap<string, number>,
  ecosystem: ReadonlySet<string>,
): MixPoolName[] {
  return names.slice(0, MIX_SUGGEST_MAX).map((name) => {
    const key = normalizeArtistName(name);
    const match = scores.get(key);
    return {
      name,
      ...(match != null ? { match } : {}),
      ...(ecosystem.has(key) ? { ecosystem: true } : {}),
    };
  });
}

function fallbackPool(
  lastFm: readonly LastFmSimilarArtistScored[],
  anchors: readonly string[],
  seed: string,
): MixPoolName[] {
  const out: MixPoolName[] = [];
  const seen = new Set<string>();
  for (const item of lastFm) {
    if (item.match < LASTFM_MATCH_MIN) continue;
    const name = item.name.trim();
    const key = normalizeArtistName(name);
    if (!name || !key || seen.has(key) || artistNamesMatch(name, seed)) continue;
    seen.add(key);
    out.push({ name, match: item.match });
  }
  for (const raw of anchors) {
    const name = raw.trim();
    const key = normalizeArtistName(name);
    if (!name || !key || seen.has(key) || artistNamesMatch(name, seed)) continue;
    seen.add(key);
    out.push({ name });
  }
  return out.slice(0, MIX_SUGGEST_MAX);
}

/** Samples across a list. The live draw does not use this. */
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

function coerceScored(items: readonly (string | LastFmSimilarArtistScored)[]): LastFmSimilarArtistScored[] {
  const out: LastFmSimilarArtistScored[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      const name = item.trim();
      if (name) out.push({ name, match: 1 });
      continue;
    }
    const name = item.name?.trim() ?? "";
    if (!name || !Number.isFinite(item.match)) continue;
    out.push({ name, match: item.match });
  }
  return out;
}

/**
 * Ranked keepable names, best fit first.
 * A fresh pool skips the model. A miss spends the model budget, then checks the catalog.
 * An empty model list falls back to Last.fm names at match 0.4 or better, then anchors.
 */
export async function assembleMixNeighbors(
  artistName: string,
  previous: readonly string[] = [],
  deps?: MixNeighborDeps,
): Promise<MixPoolName[]> {
  const seed = artistName.trim();
  if (!seed) return [];

  const now = deps?.now ?? Date.now;
  const started = now();

  if (deps?.cached && neighborhoodPoolIsFresh(deps.cached.names, deps.cached.at, now())) {
    return deps.cached.names.map((entry) => ({ ...entry }));
  }
  if (!deps?.suggest) {
    const hit = recallNeighborhoodPool(seed, now());
    if (hit) return hit;
  }

  const budget = deps?.budgetMs ?? MIX_NEIGHBOR_BUDGET_MS;
  const modelBudget = Math.min(deps?.modelBudgetMs ?? MIX_MODEL_BUDGET_MS, budget);
  const loadWorld = deps?.loadWorld ?? loadSeedWorld;
  const lastFmSource = deps?.lastFm ?? fetchLastFmEvidence;
  const backup = deps?.backup ?? (async () => lastFmSource(seed));
  const anchors = deps?.anchors ?? (async (name: string) => anchorArtistsForSeed(name, MIX_SUGGEST_MAX));

  const skipLiveLookups = Boolean(deps?.verify);
  const evidenceTask = skipLiveLookups
    ? Promise.resolve([] as LastFmSimilarArtistScored[])
    : withDeadline(lastFmSource(seed).catch(() => [] as LastFmSimilarArtistScored[]), 3_000, []);
  const worldTask = skipLiveLookups
    ? Promise.resolve({ worlds: [] as string[], years: [] as number[] })
    : withDeadline(loadWorld(seed).catch(() => ({ worlds: [], years: [] })), 3_000, {
        worlds: [],
        years: [],
      });

  const model = abortAfter(modelBudget);
  let suggested: string[] = [];
  let ecosystem: string[] = [];
  let evidence: LastFmSimilarArtistScored[] = [];
  let world: SeedWorld = { worlds: [], years: [] };

  try {
    const [loadedEvidence, loadedWorld] = await Promise.all([evidenceTask, worldTask]);
    evidence = loadedEvidence;
    world = loadedWorld;
    if (deps?.suggest) {
      suggested = await withDeadline(
        deps.suggest(seed, previous, { signal: model.signal }).catch(() => [] as string[]),
        Math.max(0, modelBudget - (now() - started)),
        [] as string[],
      );
    } else {
      const read = await readNeighborSuggestion(seed, previous, {
        signal: model.signal,
        modelBudgetMs: Math.max(0, modelBudget - (now() - started)),
        lastFm: evidence,
      });
      suggested = read.names;
      ecosystem = read.ecosystem;
    }
  } finally {
    model.abort();
    model.cancel();
  }

  const scores = matchMap(evidence);
  const verify =
    deps?.verify ??
    ((names: readonly string[]) => verifyNames(names, world, now() + CATALOG_GRACE_MS, now));

  let kept = suggested.length
    ? await verify(suggested).catch(() => [] as string[])
    : [];

  if (kept.length === 0) {
    const backupRows = coerceScored(await backup(seed).catch(() => []));
    const backupScores = matchMap([...evidence, ...backupRows]);
    for (const [key, match] of backupScores) {
      if (!scores.has(key)) scores.set(key, match);
    }
    const anchorNames = await anchors(seed).catch(() => [] as string[]);
    const fallback = fallbackPool(
      backupRows.filter((item) => item.match >= LASTFM_MATCH_MIN),
      anchorNames,
      seed,
    );
    const fallbackNames = fallback.map((entry) => entry.name);
    kept = fallbackNames.length
      ? await verify(fallbackNames).catch(() => [] as string[])
      : [];
  }

  const ordered = promoteSupportedWithinBands(kept, scores);
  const pool = toPool(ordered, scores, new Set(ecosystem.map((name) => normalizeArtistName(name))));
  if (!deps?.suggest && pool.length > 0) rememberNeighborhoodPool(seed, pool, now());
  console.info(
    `[mix-neighbors] ${seed} model=${suggested.length} kept=${pool.length} ms=${now() - started}`,
  );
  return pool;
}

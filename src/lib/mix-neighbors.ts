/**
 * Artist Mix neighbor pool.
 * Last.fm is one input. A model pass can name more artists in that same world.
 * A name is kept only when the catalog has a real song by that artist and the
 * artist shares a genre or era with the seed. A short honest list is returned
 * as-is. Nothing here invents a song title.
 */

import { filterSameFeelNeighbors, fetchSimilarArtists } from "@/lib/similar-artists";
import { searchSongsByArtistStrict } from "@/lib/itunes";
import { artistNamesMatch, normalizeArtistName } from "@/lib/track-quality";

const SUGGEST_MODEL = "gpt-4o-mini";
const SUGGEST_LIMIT = 24;
const SUGGEST_TIMEOUT_MS = 8000;
const CATALOG_CONCURRENCY = 4;

const SUGGEST_SYSTEM = `You list real recording artists for a radio mix.
Reply with JSON only: {"artists":["Artist Name"]}
Rules:
- Artist names only. No song titles, albums, years, or reasons.
- Every name must be a real artist a music store can look up. Never invent a name.
- Stay in the same era and feel as the seed artist. No unrelated famous names to fill space.
- If you only know a few honest neighbors, return only those.
- Do not include the seed artist.
- Prefer artists that are not in the avoid list when you can still stay in that world.`;

export function interleaveNeighborNames(
  left: readonly string[],
  right: readonly string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const a = left.map((name) => name.trim()).filter(Boolean);
  const b = right.map((name) => name.trim()).filter(Boolean);
  const push = (name: string) => {
    const key = normalizeArtistName(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i]) push(a[i]);
    if (b[i]) push(b[i]);
  }
  return out;
}

function plausibleArtistName(name: string): boolean {
  if (name.length < 2 || name.length > 80) return false;
  if (/[\r\n]/.test(name)) return false;
  if (/https?:|www\./i.test(name)) return false;
  if (name.includes(" - ")) return false;
  const words = name.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 8;
}

/** Artist names from a model JSON payload. Titles and the seed are dropped. */
export function parseSuggestedNeighborNames(raw: string, seedArtist: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  const list =
    parsed && typeof parsed === "object" && Array.isArray((parsed as { artists?: unknown }).artists)
      ? (parsed as { artists: unknown[] }).artists
      : [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const name = item.trim();
    if (!plausibleArtistName(name)) continue;
    if (artistNamesMatch(name, seedArtist)) continue;
    const key = normalizeArtistName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= SUGGEST_LIMIT) break;
  }
  return out;
}

function suggestUserPrompt(seedArtist: string, avoid: readonly string[]): string {
  const blocked = avoid
    .map((name) => name.trim())
    .filter((name) => name && !artistNamesMatch(name, seedArtist))
    .slice(0, 40);
  const avoidLine = blocked.length ? blocked.join(", ") : "None yet.";
  return [
    `Seed artist: ${seedArtist}`,
    `Avoid these if you can name other real neighbors in the same world: ${avoidLine}`,
    `Return up to ${SUGGEST_LIMIT} artist names.`,
  ].join("\n");
}

/**
 * One fresh model pass for neighbor names.
 * No key, a bad response, or a timeout returns an empty list so Last.fm can still play.
 */
export async function suggestNeighborArtists(
  seedArtist: string,
  avoid: readonly string[] = [],
  options?: { fetchImpl?: typeof fetch; apiKey?: string },
): Promise<string[]> {
  const seed = seedArtist.trim();
  if (!seed) return [];
  const apiKey = (options?.apiKey ?? process.env.OPENAI_API_KEY)?.trim() ?? "";
  if (!apiKey) return [];

  const fetchImpl = options?.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(SUGGEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: SUGGEST_MODEL,
        messages: [
          { role: "system", content: SUGGEST_SYSTEM },
          { role: "user", content: suggestUserPrompt(seed, avoid) },
        ],
        max_tokens: 600,
        temperature: 0.9,
        response_format: { type: "json_object" },
      }),
      cache: "no-store",
    });
    if (!response.ok) return [];
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!raw) return [];
    return parseSuggestedNeighborNames(raw, seed);
  } catch (error) {
    console.warn("[mix-neighbors] suggestion skipped:", error);
    return [];
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Math.min(concurrency, items.length);

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index]);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

/** Keeps a name only when a strict catalog search finds a real song by that artist. */
export async function verifyCatalogNeighborNames(names: readonly string[]): Promise<string[]> {
  const unique = interleaveNeighborNames(names, []);
  const found = await mapWithConcurrency(unique, CATALOG_CONCURRENCY, async (name) => {
    try {
      const songs = await searchSongsByArtistStrict(name, 1);
      return songs.length > 0;
    } catch {
      return false;
    }
  });
  return unique.filter((_, index) => found[index]);
}

export type MixNeighborDeps = {
  fetchLastFm?: (artistName: string) => Promise<string[]>;
  suggest?: (seedArtist: string, avoid: readonly string[]) => Promise<string[]>;
  verifyCatalog?: (names: readonly string[]) => Promise<string[]>;
  filterFeel?: (seedArtist: string, names: readonly string[]) => Promise<string[]>;
};

/**
 * Last.fm same-feel names, plus model names that resolve to catalog songs
 * and share the seed's genre or era. The two lists are interleaved so one
 * launch is not only Last.fm's stable head.
 */
export async function assembleMixNeighbors(
  artistName: string,
  previous: readonly string[] = [],
  deps?: MixNeighborDeps,
): Promise<string[]> {
  const seed = artistName.trim();
  if (!seed) return [];

  const fetchLastFm = deps?.fetchLastFm ?? fetchSimilarArtists;
  const suggest = deps?.suggest ?? suggestNeighborArtists;
  const verifyCatalog = deps?.verifyCatalog ?? verifyCatalogNeighborNames;
  const filterFeel = deps?.filterFeel ?? filterSameFeelNeighbors;

  const [lastfm, suggested] = await Promise.all([
    fetchLastFm(seed),
    suggest(seed, previous).catch(() => [] as string[]),
  ]);

  let extra: string[] = [];
  try {
    const catalogued = suggested.length ? await verifyCatalog(suggested) : [];
    extra = catalogued.length ? await filterFeel(seed, catalogued) : [];
  } catch (error) {
    console.warn("[mix-neighbors] extra neighbors skipped:", error);
    extra = [];
  }

  return interleaveNeighborNames(lastfm, extra).filter((name) => !artistNamesMatch(name, seed));
}

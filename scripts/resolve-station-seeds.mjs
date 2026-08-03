#!/usr/bin/env node
/**
 * Resolves the curated `[artist, title]` pairs in `station-seed-sources.mjs`
 * into verified, embeddable YouTube IDs and writes `src/data/station-seeds.ts`.
 *
 * Seed pools are the only tracks a station can open on before the catalog
 * replenish lands, so a dead or non-embeddable ID there is a silent-first-song
 * bug. Nothing is written unless YouTube confirms the video plays in a
 * third-party embed and falls inside the radio-single duration window.
 *
 * Usage:
 *   node scripts/resolve-station-seeds.mjs                 # all stations
 *   node scripts/resolve-station-seeds.mjs alternative-rock # one or more ids
 *   node scripts/resolve-station-seeds.mjs --refresh        # ignore the cache
 *
 * Resolutions are cached in `scripts/.seed-cache.json`, so an interrupted run
 * resumes without re-querying YouTube.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { STATION_SEED_SOURCES } from "./station-seed-sources.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = resolve(HERE, ".seed-cache.json");
const RESOLVED_PATH = resolve(HERE, ".seed-resolved.json");
const OUT_PATH = resolve(HERE, "../src/data/station-seeds.ts");

const CONCURRENCY = 4;
const MIN_DURATION_SEC = 90;
const MAX_DURATION_SEC = 600;

/** Mirrors `CATALOG_TITLE_BLACKLIST` + `ARTIST_RADIO_JUNK_PATTERN` in src/lib/track-quality.ts. */
const JUNK_PATTERN =
  /\b(full album|compilation|greatest hits|megamix|discography|best of mix|karaoke|cover version|tribute to|in the style of|8d audio|bass boosted|nightcore|fan ?made|reaction|how to play|tutorial|instrumental cover|piano cover|guitar cover|acoustic cover|remix|reupload|extended version|full concert|bootleg|playlist|mix|\d+ hours?)\b/i;

const args = process.argv.slice(2);
const refresh = args.includes("--refresh");
const onlyStations = args.filter((arg) => !arg.startsWith("--"));

function loadCache() {
  if (refresh) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8"));
  } catch {
    return {};
  }
}

const cache = loadCache();
let cacheDirty = false;

function saveCache() {
  if (!cacheDirty) return;
  writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
  cacheDirty = false;
}

/** Diacritic-folded, punctuation-flattened text so "Blue Öyster Cult" matches "Blue Oyster Cult". */
function normalize(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeArtistName(name) {
  return normalize(name).replace(/^the\s+/, "");
}

/**
 * Whether a video really is the requested recording.
 *
 * Search relevance alone is not enough — YouTube happily returns a different
 * song by the same artist, and a mislabeled seed sends the DJ into an intro for
 * a track that is not playing. The artist has to appear, and so does most of
 * the title; a couple of missing words absorbs the punctuation and subtitle
 * drift between "TSOP The Sound of Philadelphia" and "T.S.O.P.".
 */
function describesTrack(haystackText, artist, title) {
  const haystack = normalize(haystackText);
  if (!haystack.includes(normalizeArtistName(artist))) return false;

  const normTitle = normalize(title);
  if (haystack.includes(normTitle)) return true;

  const words = normTitle.split(" ").filter((word) => word.length > 2);
  if (!words.length) return false;

  const missing = words.filter((word) => !haystack.includes(word)).length;
  return missing <= Math.floor(words.length * 0.3);
}

function parseClockDuration(text) {
  const parts = text.trim().split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n))) {
    return undefined;
  }
  return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function readRuns(field) {
  if (!field || typeof field !== "object") return "";
  return field.runs?.[0]?.text?.trim() ?? field.simpleText?.trim() ?? "";
}

function extractVideos(payload) {
  const out = [];
  const seen = new Set();

  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const renderer = node.videoRenderer;
    if (renderer && typeof renderer === "object") {
      const videoId = typeof renderer.videoId === "string" ? renderer.videoId : "";
      if (videoId && !seen.has(videoId) && /^[A-Za-z0-9_-]{11}$/.test(videoId)) {
        seen.add(videoId);
        out.push({
          youtubeId: videoId,
          title: readRuns(renderer.title) || "",
          channel: readRuns(renderer.ownerText) || readRuns(renderer.longBylineText) || "",
          durationSeconds: parseClockDuration(readRuns(renderer.lengthText) || ""),
        });
      }
      return;
    }
    for (const value of Object.values(node)) walk(value);
  };

  walk(payload);
  return out;
}

async function searchYouTube(query) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://www.youtube.com/youtubei/v1/search?prettyPrint=false", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        },
        body: JSON.stringify({
          context: { client: { clientName: "WEB", clientVersion: "2.20240101.00.00" } },
          query,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) return extractVideos(await res.json());
    } catch {
      // Retried below.
    }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  return [];
}

/**
 * oEmbed answers 200 only for public videos that third-party players may embed,
 * and its payload is YouTube's own title/channel — the authoritative check that
 * the search actually found the requested song.
 */
async function verifyVideo(videoId, artist, title) {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${videoId}`,
  )}&format=json`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return false;
    const data = await res.json();
    return describesTrack(`${data.title ?? ""} ${data.author_name ?? ""}`, artist, title);
  } catch {
    return false;
  }
}

function scoreCandidate(candidate, artist, title) {
  const haystack = `${candidate.title} ${candidate.channel}`.toLowerCase();
  const normArtist = normalizeArtistName(artist);
  const normTitle = title.toLowerCase().trim();

  let score = 0;
  if (normTitle && haystack.includes(normTitle)) score += 5;
  if (normArtist && haystack.includes(normArtist)) score += 5;
  if (/vevo/i.test(candidate.channel)) score += 3;
  if (/\bofficial\b/i.test(candidate.title)) score += 2;
  if (/- topic$/i.test(candidate.channel.trim())) score += 2;
  if (/\blive\b/i.test(candidate.title)) score -= 4;
  if (/\blyrics?\b/i.test(candidate.title)) score -= 1;
  if (JUNK_PATTERN.test(candidate.title)) score -= 25;

  // Every surviving title word that the candidate is missing is a wrong-song signal.
  const titleWords = normTitle.split(/\s+/).filter((w) => w.length > 2);
  const missing = titleWords.filter((word) => !haystack.includes(word)).length;
  score -= missing * 2;

  return score;
}

function durationOk(seconds) {
  if (seconds == null) return false;
  return seconds >= MIN_DURATION_SEC && seconds <= MAX_DURATION_SEC;
}

/** Resolved video ID, or null when nothing passed verification. */
async function resolveSeed(artist, title) {
  const key = `${artist}::${title}`;
  if (key in cache) return cache[key];

  const candidates = await searchYouTube(`${artist} ${title} official`);
  const ranked = candidates
    .filter((c) => durationOk(c.durationSeconds))
    .map((c) => ({ ...c, score: scoreCandidate(c, artist, title) }))
    .filter((c) => c.score >= 6)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  for (const candidate of ranked) {
    if (await verifyVideo(candidate.youtubeId, artist, title)) {
      cache[key] = candidate.youtubeId;
      cacheDirty = true;
      return candidate.youtubeId;
    }
  }

  cache[key] = null;
  cacheDirty = true;
  return null;
}

async function mapWithConcurrency(items, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, run));
  return results;
}

function tsString(value) {
  return JSON.stringify(value);
}

function renderFile(resolved) {
  const entries = Object.keys(STATION_SEED_SOURCES)
    .filter((stationId) => resolved[stationId]?.length)
    .map((stationId) => {
      const body = resolved[stationId]
        .map(
          (t) =>
            `    { youtubeId: ${tsString(t.youtubeId)}, title: ${tsString(t.title)}, artist: ${tsString(t.artist)} },`,
        )
        .join("\n");
      return `  ${tsString(stationId)}: [\n${body}\n  ],`;
    })
    .join("\n");

  return `import type { StationTrack } from "@/data/stations";

/**
 * Deep starter pools for the primary preset stations.
 *
 * Generated by \`scripts/resolve-station-seeds.mjs\` from the curated
 * \`[artist, title]\` lists in \`scripts/station-seed-sources.mjs\`. Every ID here
 * was confirmed public, embeddable, and inside the radio-single duration window
 * at generation time — do not hand-edit, re-run the script instead.
 *
 * The pools are deep (30-50 staples) because the session opener is drawn from
 * them: a shallow pool means listeners hear the same first song every launch,
 * which no amount of anti-repeat history can fix.
 */
export const STATION_SEED_TRACKS: Record<string, StationTrack[]> = {
${entries}
};

/**
 * Deep pool for \`stationId\`, or \`fallback\` for stations that have not been
 * curated yet. Never returns an empty array: an empty seed pool leaves a
 * station with nothing to open on.
 */
export function seedTracksFor(stationId: string, fallback: StationTrack[]): StationTrack[] {
  const seeds = STATION_SEED_TRACKS[stationId];
  return seeds && seeds.length ? seeds : fallback;
}
`;
}

async function main() {
  const stationIds = onlyStations.length
    ? onlyStations.filter((id) => id in STATION_SEED_SOURCES)
    : Object.keys(STATION_SEED_SOURCES);

  if (!stationIds.length) {
    console.error("No matching stations. Known ids:", Object.keys(STATION_SEED_SOURCES).join(", "));
    process.exit(1);
  }

  // A partial run must not wipe stations it was not asked to resolve, so the
  // rendered TS is always projected from the full accumulated result set.
  let resolved = {};
  try {
    resolved = JSON.parse(readFileSync(RESOLVED_PATH, "utf8"));
  } catch {
    // First run.
  }

  const saveTimer = setInterval(saveCache, 5000);

  for (const stationId of stationIds) {
    const sources = STATION_SEED_SOURCES[stationId];
    const taken = new Set();
    process.stdout.write(`\n${stationId} (${sources.length} candidates)\n`);

    const ids = await mapWithConcurrency(sources, ([artist, title]) => resolveSeed(artist, title));

    const tracks = [];
    sources.forEach(([artist, title], i) => {
      const youtubeId = ids[i];
      if (!youtubeId || taken.has(youtubeId)) return;
      taken.add(youtubeId);
      tracks.push({ youtubeId, title, artist });
    });

    resolved[stationId] = tracks;
    const status = tracks.length >= 30 ? "ok" : "THIN";
    console.log(`  resolved ${tracks.length}/${sources.length} [${status}]`);
    for (const [artist, title] of sources) {
      if (!tracks.some((t) => t.artist === artist && t.title === title)) {
        console.log(`    dropped: ${artist} - ${title}`);
      }
    }
  }

  clearInterval(saveTimer);
  saveCache();
  writeFileSync(RESOLVED_PATH, `${JSON.stringify(resolved, null, 2)}\n`);

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, renderFile(resolved));

  const total = Object.values(resolved).reduce((sum, list) => sum + list.length, 0);
  console.log(`\nWrote ${OUT_PATH} — ${Object.keys(resolved).length} stations, ${total} tracks.`);
}

main().catch((err) => {
  saveCache();
  console.error(err);
  process.exit(1);
});

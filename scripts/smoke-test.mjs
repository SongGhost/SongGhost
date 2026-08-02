#!/usr/bin/env node
/**
 * SongGhost API smoke test — run against local or Vercel deployment.
 *
 * Usage:
 *   node scripts/smoke-test.mjs https://your-app.vercel.app
 *   node scripts/smoke-test.mjs http://localhost:3000
 */

const baseUrl = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");

const PREVIEW_DURATION_MAX = 35; // iTunes previews are ~30s

function isPreviewOnly(track) {
  const yt = track.youtubeId?.trim();
  return !yt && Boolean(track.previewUrl?.trim());
}

function summarizeTracks(tracks, label) {
  const total = tracks.length;
  const withYoutube = tracks.filter((t) => Boolean(t.youtubeId?.trim())).length;
  const previewOnly = tracks.filter(isPreviewOnly).length;
  const both = tracks.filter(
    (t) => Boolean(t.youtubeId?.trim()) && Boolean(t.previewUrl?.trim()),
  ).length;

  console.log(`\n  ${label}`);
  console.log(`    tracks: ${total}`);
  console.log(`    with YouTube ID: ${withYoutube} (${pct(withYoutube, total)})`);
  console.log(`    preview-only (no YouTube): ${previewOnly} (${pct(previewOnly, total)})`);
  console.log(`    YouTube + preview fallback: ${both}`);

  if (previewOnly > 0 && previewOnly === total) {
    console.log("    ⚠ ALL preview-only — check YOUTUBE_API_KEY on server");
  } else if (previewOnly / total > 0.5) {
    console.log("    ⚠ High preview-only ratio — YouTube resolution may be failing");
  }

  const samples = tracks.slice(0, 3).map((t) => ({
    title: t.title,
    artist: t.artist,
    youtubeId: t.youtubeId?.trim() || "(none)",
    preview: t.previewUrl ? "yes" : "no",
  }));
  console.log("    sample:", JSON.stringify(samples, null, 2).replace(/\n/g, "\n    "));
}

function pct(n, total) {
  if (!total) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

async function fetchJson(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const start = Date.now();
  let res;
  try {
    res = await fetch(url, { ...options, signal: AbortSignal.timeout(120_000) });
  } catch (err) {
    return { ok: false, url, ms: Date.now() - start, error: String(err) };
  }
  const ms = Date.now() - start;
  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, url, ms, data };
}

async function run() {
  console.log(`SongGhost smoke test → ${baseUrl}\n`);
  let passed = 0;
  let failed = 0;

  function pass(name) {
    console.log(`✓ ${name}`);
    passed += 1;
  }
  function fail(name, detail) {
    console.log(`✗ ${name}`);
    if (detail) console.log(`  ${detail}`);
    failed += 1;
  }

  // 1. Artist suggest
  {
    const r = await fetchJson("/api/artist-suggest?q=kany");
    if (r.ok && Array.isArray(r.data?.suggestions) && r.data.suggestions.length > 0) {
      pass(`artist-suggest (${r.ms}ms, ${r.data.suggestions.length} results)`);
    } else {
      fail("artist-suggest", r.error ?? `status ${r.status}`);
    }
  }

  // 2. Artist radio — artist-only (the Kanye West scenario)
  {
    const r = await fetchJson(
      "/api/artist-radio?artist=Kanye%20West&mode=artist-only",
    );
    if (r.ok && Array.isArray(r.data?.tracks) && r.data.tracks.length >= 8) {
      pass(`artist-radio artist-only (${r.ms}ms, ${r.data.tracks.length} tracks)`);
      summarizeTracks(r.data.tracks, "Kanye West artist-only");
      const previewRatio =
        r.data.tracks.filter(isPreviewOnly).length / r.data.tracks.length;
      if (previewRatio < 0.3) {
        pass("YouTube resolution rate looks healthy (<30% preview-only)");
      } else {
        fail(
          "YouTube resolution rate",
          `${Math.round(previewRatio * 100)}% preview-only tracks`,
        );
      }
    } else {
      fail(
        "artist-radio artist-only",
        r.error ?? `status ${r.status}, tracks=${r.data?.tracks?.length ?? 0}`,
      );
    }
  }

  // 3. Artist radio — mixed mode
  {
    const r = await fetchJson("/api/artist-radio?artist=Soundgarden&mode=mixed");
    if (r.ok && Array.isArray(r.data?.tracks) && r.data.tracks.length >= 5) {
      pass(`artist-radio mixed (${r.ms}ms, ${r.data.tracks.length} tracks)`);
      summarizeTracks(r.data.tracks, "Soundgarden mixed");
    } else {
      fail("artist-radio mixed", r.error ?? `status ${r.status}`);
    }
  }

  // 4. Song search (queue modal)
  {
    const r = await fetchJson("/api/song-search?q=stronger%20kanye");
    if (r.ok && Array.isArray(r.data?.tracks) && r.data.tracks.length > 0) {
      pass(`song-search (${r.ms}ms, ${r.data.tracks.length} results)`);
      const first = r.data.tracks[0];
      if (first.youtubeId?.trim()) {
        pass("song-search returns YouTube-backed track");
      } else if (first.previewUrl) {
        fail("song-search first result", "preview-only — YouTube lookup failed");
      }
    } else {
      fail("song-search", r.error ?? `status ${r.status}`);
    }
  }

  // 5. Station tracks replenish
  {
    const r = await fetchJson("/api/station-tracks?stationId=seattle-grunge");
    if (r.ok && Array.isArray(r.data?.tracks) && r.data.tracks.length >= 5) {
      pass(`station-tracks (${r.ms}ms, ${r.data.tracks.length} tracks)`);
      summarizeTracks(r.data.tracks, "Seattle Grunge station catalog");
    } else {
      fail("station-tracks", r.error ?? `status ${r.status}`);
    }
  }

  // 6. Missing artist param
  {
    const r = await fetchJson("/api/artist-radio");
    if (r.status === 400) {
      pass("artist-radio validates missing artist (400)");
    } else {
      fail("artist-radio validation", `expected 400, got ${r.status}`);
    }
  }

  // 7. Unknown artist
  {
    const r = await fetchJson(
      "/api/artist-radio?artist=zzzznonexistentartist99999&mode=artist-only",
    );
    if (r.status === 404) {
      pass("artist-radio returns 404 for unknown artist");
    } else {
      fail("artist-radio unknown artist", `expected 404, got ${r.status}`);
    }
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { NextResponse } from "next/server";
import {
  buildArtistRadioResult,
  type ArtistRadioMode,
  type ArtistRadioResult,
} from "@/lib/artist-radio";
import {
  mergeMixNeighbors,
  parseMixNeighborParam,
  parseStoredPoolParam,
  recallNeighborhoodCast,
  rememberMixNeighbors,
  rememberNeighborhoodCast,
  type PreviousCast,
} from "@/lib/artist-mix";
import { neighborhoodPoolIsFresh } from "@/lib/mix-neighbors";
import { isLastFmConfigured } from "@/lib/similar-artists";
import { parseFailedYoutubeIds, parseFailedYoutubeIdsParam } from "@/lib/failed-youtube-ids";
import {
  buildArtistOnlyStation,
  buildMixedNeighborhood,
  type PinnedSeed,
  type PlannedSlot,
} from "@/lib/neighborhood-launch";

/** Ordering is randomized per request, so responses must never be statically cached. */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function parseArtistRadioMode(value: string | null): ArtistRadioMode {
  return value === "artist-only" ? "artist-only" : "mixed";
}

function parsePinnedSeed(searchParams: URLSearchParams): PinnedSeed | null {
  const title = searchParams.get("seedTitle")?.trim() ?? "";
  if (!title) return null;
  const rawId = Number(searchParams.get("itunesTrackId"));
  return {
    title,
    ...(Number.isInteger(rawId) && rawId > 0 ? { itunesTrackId: rawId } : {}),
  };
}

function parsePlanValue(value: unknown): PlannedSlot[] {
  const parsed = typeof value === "string"
    ? (() => {
        if (!value.trim()) return null;
        try {
          return JSON.parse(value) as unknown;
        } catch {
          return null;
        }
      })()
    : value;
  if (!Array.isArray(parsed)) return [];
    const out: PlannedSlot[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== "object") continue;
      const artist = "artist" in row && typeof row.artist === "string" ? row.artist.trim() : "";
      const title = "title" in row && typeof row.title === "string" ? row.title.trim() : "";
      if (!artist || !title) continue;
      const alt = "alt" in row && Array.isArray(row.alt)
        ? row.alt.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
        : [];
      out.push({ artist, title, ...(alt.length ? { alt } : {}) });
    }
  return out;
}

function previousCast(artist: string, searchParams: URLSearchParams): PreviousCast {
  const stored = recallNeighborhoodCast(artist);
  const close = parseMixNeighborParam(searchParams.get("lastClose"));
  const peer = parseMixNeighborParam(searchParams.get("lastPeer"));
  const deep = parseMixNeighborParam(searchParams.get("lastDeep"));
  return {
    close: close.length ? close : (stored?.close ?? []),
    peer: peer.length ? peer : (stored?.peer ?? []),
    deep: deep.length ? deep : (stored?.deep ?? []),
    used: parseMixNeighborParam(searchParams.get("excludeNeighbors")),
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const artist = searchParams.get("artist")?.trim();
  const mode = parseArtistRadioMode(searchParams.get("mode"));
  const pinned = parsePinnedSeed(searchParams);
  const excludeYoutubeIds = parseFailedYoutubeIdsParam(searchParams.get("excludeYoutubeIds"));
  const previousNeighbors = mergeMixNeighbors(
    [],
    parseMixNeighborParam(searchParams.get("excludeNeighbors")),
  );

  if (!artist) {
    return NextResponse.json({ error: "artist query parameter is required" }, { status: 400 });
  }

  if (searchParams.get("beat") === "2") {
    const launched = await buildMixedNeighborhood({
      artistName: artist,
      pinned,
      excludeYoutubeIds,
      beat: "2",
      plan: parsePlanValue(searchParams.get("plan")),
    });
    return NextResponse.json({
      tracks: launched.tracks,
      tailPlan: launched.tailPlan,
      beat: 2,
    });
  }

  const clientPool = parseStoredPoolParam(searchParams.get("pool"));
  const poolAt = Number(searchParams.get("poolAt"));
  const cached =
    mode === "mixed" && neighborhoodPoolIsFresh(clientPool, poolAt)
      ? { names: clientPool, at: poolAt }
      : null;

  const tracks =
    mode === "artist-only"
      ? await buildArtistOnlyStation({
          artistName: artist,
          pinned,
          excludeYoutubeIds,
        })
      : null;

  const mixed =
    mode === "mixed"
      ? await buildMixedNeighborhood({
          artistName: artist,
          pinned,
          excludeYoutubeIds,
          previous: previousCast(artist, searchParams),
          previousNames: previousNeighbors,
          poolDeps: cached ? { cached } : undefined,
        }).catch((error) => {
          console.warn("[artist-radio] neighborhood skipped:", error);
          return null;
        })
      : null;

  const resolved = mode === "mixed" ? (mixed?.tracks ?? []) : (tracks ?? []);

  if (resolved.length === 0) {
    const error = pinned
      ? mode === "mixed"
        ? `No playable seed track for "${pinned.title}" by ${artist}.`
        : `No playable song for "${pinned.title}" by ${artist}.`
      : mode === "mixed"
        ? `No playable seed track for "${artist}".`
        : `No tracks found for "${artist}". Try another artist name.`;
    return NextResponse.json({ error }, { status: 404 });
  }

  if (mode === "mixed" && mixed) {
    rememberNeighborhoodCast(artist, mixed.cast);
    rememberMixNeighbors(artist, [...mixed.cast.close, ...mixed.cast.peer, ...mixed.cast.deep]);
  }

  const result: ArtistRadioResult = {
    ...buildArtistRadioResult(artist, resolved, mode),
    ...(mode === "mixed" && mixed
      ? {
          tailPlan: mixed.tailPlan,
          pool: mixed.pool,
          cast: mixed.cast,
        }
      : {}),
  };

  return NextResponse.json({
    ...result,
    similarArtistsConfigured: isLastFmConfigured(),
  });
}

/** Beat 2. The plan rides in the body so a full hour is not cut off by the URL. */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (body.beat !== 2 && body.beat !== "2") {
    return NextResponse.json({ error: "beat 2 body required" }, { status: 400 });
  }
  const artist = typeof body.artist === "string" ? body.artist.trim() : "";
  const launched = await buildMixedNeighborhood({
    artistName: artist || "tail",
    beat: "2",
    plan: parsePlanValue(body.plan),
    excludeYoutubeIds: parseFailedYoutubeIds(body.excludeYoutubeIds),
  });
  return NextResponse.json({
    tracks: launched.tracks,
    tailPlan: launched.tailPlan,
    beat: 2,
  });
}

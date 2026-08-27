import { NextResponse } from "next/server";
import { getStationById, type Station, type StationTrack } from "@/data/stations";
import { parseAllowExplicit } from "@/lib/content-filter";
import { applyBlueprintSeeds, hasBlueprintSeeds, normalizeSeedList } from "@/lib/station/blueprint";
import {
  fetchGenreTracks,
  finalizeStationCatalog,
  orderCatalog,
  shuffle,
} from "@/lib/station/catalog-builder";
import { resolveTrackVideoId } from "@/lib/youtube-search";
import { resolveInPool } from "@/lib/resolve-pool";
import { applyArtistCap, filterTracksByEra } from "@/lib/queue/builder";
import { resolveEraLock } from "@/types/station";

/** Responses are randomized per request and must never be statically cached. */
export const dynamic = "force-dynamic";

const CATALOG_CACHE_MS = 15 * 60 * 1000;
const catalogCache = new Map<string, { tracks: StationTrack[]; cachedAt: number }>();

function csvParam(value: string | null): string[] {
  if (!value?.trim()) return [];
  return normalizeSeedList(value.split(","));
}

function isDevYoutubeFallback(searchParams: URLSearchParams): boolean {
  return (
    searchParams.get("youtubeFallback") === "true" &&
    (process.env.NODE_ENV === "development" ||
      process.env.NEXT_PUBLIC_ENABLE_DEV_TOGGLE === "true")
  );
}

async function stampStationTrackYoutubeIds(
  tracks: StationTrack[],
): Promise<StationTrack[]> {
  return resolveInPool(
    tracks,
    async (track) => {
      if (track.youtubeId?.trim()) return track;
      const youtubeId = await resolveTrackVideoId(track.artist, track.title);
      return youtubeId ? { ...track, youtubeId } : track;
    },
    { concurrency: 4 },
  );
}

function syntheticStationFromSeeds(
  stationId: string,
  seeds: {
    seedArtists: string[];
    seedGenres: string[];
    energyLevel?: number;
    catalogDepth?: number;
  },
): Station {
  const name =
    seeds.seedGenres.slice(0, 2).join(" / ") ||
    seeds.seedArtists.slice(0, 2).join(" / ") ||
    "Custom Station";
  return applyBlueprintSeeds(
    {
      id: stationId,
      name,
      frequency: 99.9,
      category: "genres",
      defaultPersonaId: "standard-broadcast",
      accentColor: "#C4882A",
      youtubeVideoId: "",
      tracks: [],
      description: [name, ...seeds.seedGenres, ...seeds.seedArtists].join(", "),
    },
    seeds,
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const stationId = searchParams.get("stationId")?.trim();
  const exclude = searchParams.get("exclude")?.split(",").filter(Boolean) ?? [];
  const eraLock = resolveEraLock(searchParams.get("era"));
  const allowExplicit = parseAllowExplicit(searchParams.get("allowExplicit"));
  const seedArtists = csvParam(
    searchParams.get("seedArtists") ?? searchParams.get("seed_artists"),
  );
  const seedGenres = csvParam(
    searchParams.get("seedGenres") ?? searchParams.get("seed_genres"),
  );
  const energyRaw = searchParams.get("target_energy");
  const depthRaw = searchParams.get("catalogDepth");
  const energyLevel = energyRaw ? Number.parseInt(energyRaw, 10) : undefined;
  const catalogDepth = depthRaw ? Number.parseInt(depthRaw, 10) : undefined;
  const youtubeFallback = isDevYoutubeFallback(searchParams);

  if (!stationId) {
    return NextResponse.json({ error: "stationId is required" }, { status: 400 });
  }

  const catalog = getStationById(stationId);
  const querySeeds = {
    seedArtists,
    seedGenres,
    energyLevel: Number.isFinite(energyLevel) ? energyLevel : undefined,
    catalogDepth: Number.isFinite(catalogDepth) ? catalogDepth : undefined,
  };
  const station = catalog
    ? applyBlueprintSeeds({ ...catalog }, querySeeds)
    : hasBlueprintSeeds(querySeeds)
      ? syntheticStationFromSeeds(stationId, querySeeds)
      : null;

  if (!station) {
    return NextResponse.json({ error: "Station not found" }, { status: 404 });
  }

  const excludeSet = new Set(exclude);
  const useCache = excludeSet.size === 0;
  // Each era / Clean Mode combo yields a different catalog — never share entries.
  const cacheKey = `${stationId}::${eraLock}::explicit:${allowExplicit ? "1" : "0"}::${seedArtists.join("|")}::${seedGenres.join("|")}`;
  const cached = catalogCache.get(cacheKey);

  if (useCache && cached && Date.now() - cached.cachedAt < CATALOG_CACHE_MS) {
    let cachedTracks = applyArtistCap(orderCatalog(cached.tracks), 2);
    if (youtubeFallback) {
      cachedTracks = await stampStationTrackYoutubeIds(cachedTracks);
    }
    return NextResponse.json({
      tracks: cachedTracks,
      eraLock,
      allowExplicit,
    });
  }

  let tracks = await fetchGenreTracks(station, excludeSet, eraLock);

  if (tracks.length === 0) {
    // Seed pools are the last resort, and they are only dated where a previous
    // enrichment pass wrote a year — so under a lock most stations fall through
    // to an empty response rather than leaking undated tracks onto the dial.
    const seeds = filterTracksByEra(station.tracks, eraLock);
    const unplayed = seeds.filter((t) => !excludeSet.has(t.youtubeId));
    tracks = shuffle(unplayed.length ? unplayed : seeds);
  }

  tracks = tracks.filter(
    (t) => (t.youtubeId || t.previewUrl) && (!t.youtubeId || !excludeSet.has(t.youtubeId)),
  );

  tracks = await finalizeStationCatalog(tracks, { eraLock, allowExplicit });

  if (useCache && tracks.length) {
    catalogCache.set(cacheKey, { tracks: [...tracks], cachedAt: Date.now() });
  }

  let payload = tracks;
  if (youtubeFallback) {
    payload = await stampStationTrackYoutubeIds(payload);
  }

  return NextResponse.json({
    tracks: payload,
    eraLock,
    allowExplicit,
  });
}

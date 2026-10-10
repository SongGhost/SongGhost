import { NextResponse } from "next/server";
import { getStationById, type Station, type StationTrack } from "@/data/stations";
import { parseMixNeighborParam, parseStoredPoolParam } from "@/lib/artist-mix";
import { neighborhoodPoolIsFresh } from "@/lib/mix-neighbors";
import { parseAllowExplicit } from "@/lib/content-filter";
import { applyBlueprintSeeds, hasBlueprintSeeds, normalizeSeedList } from "@/lib/station/blueprint";
import { finalizeStationCatalog, shuffle } from "@/lib/station/catalog-builder";
import { loadStationSceneHour, resumeStationPlan } from "@/lib/station/scene-hour";
import type { PlannedSlot } from "@/lib/neighborhood-launch";
import { resolveTrackVideoId } from "@/lib/youtube-search";
import { resolveInPool } from "@/lib/resolve-pool";
import { filterTracksByEra } from "@/lib/queue/builder";
import { resolveEraLock } from "@/types/station";

/** Responses are a fresh draw from a cached artist pool. Do not freeze the hour. */
export const dynamic = "force-dynamic";

function parsePlan(value: string | null): PlannedSlot[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: PlannedSlot[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== "object") continue;
      const artist = "artist" in row && typeof row.artist === "string" ? row.artist.trim() : "";
      const title = "title" in row && typeof row.title === "string" ? row.title.trim() : "";
      if (!artist || !title) continue;
      out.push({ artist, title });
    }
    return out;
  } catch {
    return [];
  }
}

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
    ? hasBlueprintSeeds(querySeeds)
      ? applyBlueprintSeeds({ ...catalog }, querySeeds)
      : catalog
    : hasBlueprintSeeds(querySeeds)
      ? syntheticStationFromSeeds(stationId, querySeeds)
      : null;

  if (!station) {
    return NextResponse.json({ error: "Station not found" }, { status: 404 });
  }

  const excludeSet = new Set(exclude);
  const plan = parsePlan(searchParams.get("plan"));
  const clientPool = parseStoredPoolParam(searchParams.get("pool"));
  const poolAt = Number(searchParams.get("poolAt"));
  const cachedPool = neighborhoodPoolIsFresh(clientPool, poolAt)
    ? { names: clientPool, at: poolAt }
    : null;
  const previous = {
    close: parseMixNeighborParam(searchParams.get("lastClose")),
    peer: parseMixNeighborParam(searchParams.get("lastPeer")),
    deep: parseMixNeighborParam(searchParams.get("lastDeep")),
    used: parseMixNeighborParam(searchParams.get("lastUsed")),
  };

  if (plan.length > 0) {
    const resumed = await resumeStationPlan(plan, excludeSet);
    const tracks = await finalizeStationCatalog(resumed, {
      eraLock,
      allowExplicit,
      artistCap: 3,
      keepOrder: true,
    });
    return NextResponse.json({ tracks, eraLock, allowExplicit, resumed: true });
  }

  const hour = await loadStationSceneHour({
    station,
    excludeYoutubeIds: excludeSet,
    eraLock,
    previous,
    cachedPool,
  });
  let tracks = hour.tracks;

  if (tracks.length === 0) {
    // Seed pools are the last resort, and they are only dated where a previous
    // enrichment pass wrote a year — so under a lock most stations fall through
    // to an empty response rather than leaking undated tracks onto the dial.
    const seeds = filterTracksByEra(station.tracks, eraLock);
    const unplayed = seeds.filter((t) => !excludeSet.has(t.youtubeId));
    tracks = shuffle(unplayed.length ? unplayed : seeds);
  }

  tracks = tracks.filter(
    (t) =>
      (t.youtubeId?.trim() || t.streamUrl?.trim()) &&
      (!t.youtubeId || !excludeSet.has(t.youtubeId)),
  );

  tracks = await finalizeStationCatalog(tracks, {
    eraLock,
    allowExplicit,
    artistCap: 3,
    keepOrder: true,
  });

  let payload = tracks;
  if (youtubeFallback) {
    payload = await stampStationTrackYoutubeIds(payload);
  }

  return NextResponse.json({
    tracks: payload,
    eraLock,
    allowExplicit,
    pool: hour.pool,
    poolAt: Date.now(),
    cast: hour.cast,
    art: hour.art,
    poolFresh: hour.poolFresh,
  });
}

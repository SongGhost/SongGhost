import { NextResponse } from "next/server";
import type { Station, StationTrack } from "@/data/stations";
import { resolveDjIdForQuery } from "@/lib/dj-resolver";
import {
  itunesPreviewToStationTrack,
  itunesSongToStationTrack,
  type ITunesSong,
} from "@/lib/itunes";
import {
  depthToTargetPopularity,
  energyToTargetEnergy,
  getRecommendations,
  resolveYearFilter,
  type SpotifyTuneTrack,
} from "@/lib/music/spotify";
import { resolveInPool } from "@/lib/resolve-pool";
import { isAcceptableCatalogTrack } from "@/lib/track-quality";
import { resolveTrackVideoId } from "@/lib/youtube-search";
import type { EraLock } from "@/types/station";

export const dynamic = "force-dynamic";

const TUNER_DECADES = [
  "60s",
  "70s",
  "80s",
  "90s",
  "2000s",
  "2010s",
  "Modern",
] as const;

type TunerDecade = (typeof TUNER_DECADES)[number];

type GenerateStationBody = {
  energy?: number;
  catalogDepth?: number;
  decades?: string[];
  genres?: string[];
  yearRange?: string;
  limit?: number;
};

function isTunerDecade(value: string): value is TunerDecade {
  return (TUNER_DECADES as readonly string[]).includes(value);
}

function decadeToEraLock(decade: TunerDecade): EraLock {
  return decade === "Modern" ? "2020s" : decade;
}

function releaseYearFromDate(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const year = Number.parseInt(value.slice(0, 4), 10);
  return Number.isFinite(year) && year >= 1900 && year <= 2100 ? year : undefined;
}

function buildStationName(decades: string[], genres: string[]): string {
  const genrePart = genres.slice(0, 2).join(" / ");
  const decadePart = decades.length ? decades.join(" · ") : "All Eras";
  if (genrePart) return `${genrePart} (${decadePart})`;
  return `${decadePart} Mix`;
}

async function resolveTuneTrack(
  track: SpotifyTuneTrack,
  seen: Set<string>,
): Promise<StationTrack | null> {
  if (
    !isAcceptableCatalogTrack({
      title: track.name,
      durationMs: track.durationMs,
    })
  ) {
    return null;
  }

  const artist = track.artists.join(", ");
  const asITunes: ITunesSong = {
    title: track.name,
    artist,
    album: track.album,
    previewUrl: track.previewUrl,
    durationMs: track.durationMs,
    releaseYear: releaseYearFromDate(track.releaseDate),
    ...(track.explicit === true ? { explicit: true } : {}),
  };

  const youtubeId = await resolveTrackVideoId(
    artist,
    track.name,
    undefined,
    track.durationMs != null ? track.durationMs / 1000 : undefined,
  );

  let stationTrack: StationTrack | null = null;
  if (youtubeId && !seen.has(youtubeId)) {
    stationTrack = itunesSongToStationTrack(asITunes, youtubeId);
  } else {
    stationTrack = itunesPreviewToStationTrack(asITunes);
  }

  if (!stationTrack) return null;

  const key =
    stationTrack.youtubeId ||
    `preview:${track.id || `${stationTrack.artist}::${stationTrack.title}`}`;
  if (seen.has(key)) return null;
  seen.add(key);

  return {
    ...stationTrack,
    spotifyId: track.id,
    ...(track.explicit === true ? { explicit: true } : {}),
  };
}

/**
 * POST /api/station/generate
 *
 * Advanced Tuner → Spotify recommendations with slider targets:
 * - target_energy = energy / 100
 * - target_popularity from catalogDepth (Mainstream 80–100 ↔ Deep Cuts 0–35)
 * - year:YYYY-YYYY appended to seed search when decade / yearRange is set
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateStationBody;

    const energy =
      typeof body.energy === "number" && Number.isFinite(body.energy)
        ? Math.min(100, Math.max(0, Math.round(body.energy)))
        : 55;
    const catalogDepth =
      typeof body.catalogDepth === "number" && Number.isFinite(body.catalogDepth)
        ? Math.min(100, Math.max(0, Math.round(body.catalogDepth)))
        : 35;

    const decades = (body.decades ?? [])
      .map((d) => String(d).trim())
      .filter(isTunerDecade);
    const genres = (body.genres ?? [])
      .map((g) => String(g).trim())
      .filter(Boolean);
    const yearRange =
      typeof body.yearRange === "string" ? body.yearRange.trim() : "";

    if (!decades.length && !genres.length && !yearRange) {
      return NextResponse.json(
        { error: "Pick at least one decade, genre, or custom year range." },
        { status: 400 },
      );
    }

    const limitRaw =
      typeof body.limit === "number" && Number.isFinite(body.limit)
        ? body.limit
        : 40;
    const limit = Math.min(100, Math.max(10, Math.round(limitRaw)));

    const recommendations = await getRecommendations({
      energyValue: energy,
      catalogDepthValue: catalogDepth,
      decades,
      genres,
      yearRange: yearRange || undefined,
      limit,
    });

    if (!recommendations.length) {
      return NextResponse.json(
        {
          error:
            "No Spotify recommendations matched this mix. Try loosening filters.",
        },
        { status: 422 },
      );
    }

    const seen = new Set<string>();
    const tracks = await resolveInPool(
      recommendations,
      (track) => resolveTuneTrack(track, seen),
      { concurrency: 8, limit: 30 },
    );

    if (!tracks.length) {
      return NextResponse.json(
        {
          error:
            "Could not resolve playable tracks for this mix. Try different filters.",
        },
        { status: 422 },
      );
    }

    const eraLock: EraLock =
      decades.length === 1 ? decadeToEraLock(decades[0]) : "all";
    const name = buildStationName(decades, genres);
    const personaId = resolveDjIdForQuery(
      [name, ...genres, ...decades].join(" "),
      genres.map((g) => g.toLowerCase()),
    );

    const station: Station = {
      id: `tuner-${Date.now()}`,
      name,
      frequency: 101.1,
      category: genres.length ? "genres" : "decades",
      defaultPersonaId: personaId,
      accentColor: "#2992cf",
      youtubeVideoId: tracks[0]?.youtubeId ?? "",
      tracks,
      description: [
        `Matrix-tuned station · Energy ${energy}`,
        `· Depth ${catalogDepth}`,
        decades.length ? `· ${decades.join(", ")}` : "",
        yearRange ? `· ${yearRange}` : "",
        genres.length ? `· ${genres.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    };

    return NextResponse.json({
      station,
      tracks,
      eraLock,
      energy,
      catalogDepth,
      decades,
      genres,
      yearRange: yearRange || undefined,
      yearFilter: resolveYearFilter(yearRange || undefined, decades) ?? null,
      targetEnergy: energyToTargetEnergy(energy),
      targetPopularity: depthToTargetPopularity(catalogDepth),
    });
  } catch (err) {
    console.error("[api/station/generate] Failed:", err);
    return NextResponse.json(
      {
        error: "Station generation failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

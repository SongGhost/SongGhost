import { NextResponse } from "next/server";
import type { Station } from "@/data/stations";
import { resolveDjIdForQuery } from "@/lib/dj-resolver";
import { applyBlueprintSeeds } from "@/lib/station/blueprint";
import {
  fetchGenreTracks,
  finalizeStationCatalog,
} from "@/lib/station/catalog-builder";
import {
  ERA_DEFINITIONS,
  ERA_LOCK_ORDER,
  isEraLock,
  type EraLock,
} from "@/types/station";

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

function buildStationName(decades: string[], genres: string[]): string {
  const genrePart = genres.slice(0, 2).join(" / ");
  const decadePart = decades.length ? decades.join(" · ") : "All Eras";
  if (genrePart) return `${genrePart} (${decadePart})`;
  return `${decadePart} Mix`;
}

/**
 * Map a freeform year window onto a single EraLock when the range sits inside
 * one decade. Spanning windows return null so decade pills keep today's lock.
 */
function eraLockFromYearRange(yearRange: string): EraLock | null {
  const trimmed = yearRange.trim().replace(/\s+/g, "");
  let start: number | undefined;
  let end: number | undefined;
  const rangeMatch = /^(\d{4})-(\d{4})$/.exec(trimmed);
  if (rangeMatch) {
    start = Number.parseInt(rangeMatch[1], 10);
    end = Number.parseInt(rangeMatch[2], 10);
  } else if (/^\d{4}$/.test(trimmed)) {
    start = end = Number.parseInt(trimmed, 10);
  }
  if (start == null || end == null || !Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  if (start > end) {
    const swap = start;
    start = end;
    end = swap;
  }

  const matches = ERA_LOCK_ORDER.filter((id) => {
    if (id === "all") return false;
    const def = ERA_DEFINITIONS[id];
    if (def.startYear == null || def.endYear == null) return false;
    return start >= def.startYear && end <= def.endYear;
  });
  return matches.length === 1 && isEraLock(matches[0]) ? matches[0] : null;
}

/**
 * POST /api/station/generate
 *
 * Inspired / Advanced Tuning → iTunes + Last.fm + YouTube catalog builder
 * (shared with /api/station-tracks). Spotify recommendations are mothballed.
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
    const _limit = Math.min(100, Math.max(10, Math.round(limitRaw)));
    void _limit;

    const decadeEra: EraLock =
      decades.length === 1 ? decadeToEraLock(decades[0]) : "all";
    const eraLock: EraLock = yearRange
      ? (eraLockFromYearRange(yearRange) ?? decadeEra)
      : decadeEra;
    const name = buildStationName(decades, genres);
    const personaId = resolveDjIdForQuery(
      [name, ...genres, ...decades].join(" "),
      genres.map((g) => g.toLowerCase()),
    );

    const station: Station = applyBlueprintSeeds(
      {
        id: `tuner-${Date.now()}`,
        name,
        frequency: 101.1,
        category: genres.length ? "genres" : "decades",
        defaultPersonaId: personaId,
        accentColor: "#2992cf",
        youtubeVideoId: "",
        tracks: [],
        description: [
          `Matrix-tuned station · Energy ${energy}`,
          `· Depth ${catalogDepth}`,
          decades.length ? `· ${decades.join(", ")}` : "",
          yearRange ? `· ${yearRange}` : "",
          genres.length ? `· ${genres.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join(" "),
      },
      {
        seedGenres: genres,
        seedArtists: [],
        energyLevel: energy,
        catalogDepth,
      },
    );

    const tracks = await finalizeStationCatalog(
      await fetchGenreTracks(station, new Set(), eraLock),
      { eraLock, allowExplicit: "allow" },
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

    station.youtubeVideoId = tracks[0]?.youtubeId ?? "";
    station.tracks = tracks;

    return NextResponse.json({
      station,
      tracks,
      eraLock,
      energy,
      catalogDepth,
      decades,
      genres,
      yearRange: yearRange || undefined,
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

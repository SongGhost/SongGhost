/**
 * Public station resolution for `/s/[id]` permalinks and `/api/station/[id]`.
 * Looks up built-in catalog → Postgres `user_saved_stations` → R2 studio manifests.
 */

import { eq, desc } from "drizzle-orm";
import { getPersonaById, DEFAULT_PERSONA, resolvePersonaId, type PersonaId } from "@/data/personas";
import { getStationById, type Station, type StationTrack } from "@/data/stations";
import { getDb } from "@/lib/db";
import { userSavedStations } from "@/lib/db/schema";
import { hasBlueprintSeeds, readBlueprintSeeds } from "@/lib/station/blueprint";
import {
  normalizeStudioDjConfig,
  studioManifestToStation,
  type StudioStationManifest,
} from "@/lib/studio/manifest";
import { loadStudioManifest } from "@/lib/studio/manifest-store";
import { getYouTubeThumbnail } from "@/lib/youtube/ids";

export type PublicStationSource = "catalog" | "saved" | "studio";

/** Wire shape returned by `/api/station/[id]` and consumed by `/s/[id]`. */
export type PublicStation = {
  id: string;
  name: string;
  description: string;
  coverImageUrl: string | null;
  hostPersonaId: PersonaId;
  hostName: string;
  seedArtists: string[];
  genres: string[];
  source: PublicStationSource;
  /** Playable station payload for the SongHost player / Save CTA. */
  station: Station;
  /** Present when `source === "studio"`. */
  studioManifest?: StudioStationManifest;
};

function uniqueArtists(tracks: StationTrack[], limit = 4): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const track of tracks) {
    const artist = track.artist?.trim();
    if (!artist) continue;
    const key = artist.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(artist);
    if (out.length >= limit) break;
  }
  return out;
}

function coverFromStation(station: Station, coverImageUrl?: string | null): string | null {
  const uploaded = coverImageUrl?.trim();
  if (uploaded) return uploaded;
  const videoId = station.youtubeVideoId || station.tracks[0]?.youtubeId;
  if (videoId?.trim()) return getYouTubeThumbnail(videoId.trim());
  return null;
}

function genresFromStation(station: Station): string[] {
  if (station.category === "decades") {
    return [station.name.replace(/\s+/g, " ").trim()];
  }
  const fromDesc = station.description
    ?.split(/[,/]| and /i)
    .map((part) => part.trim())
    .filter((part) => part.length > 2 && part.length < 40)
    .slice(0, 3);
  if (fromDesc && fromDesc.length > 0) return fromDesc;
  return [station.category === "genres" ? "Custom genre mix" : "AI radio"];
}

function toPublicStation(
  station: Station,
  source: PublicStationSource,
  extras?: {
    coverImageUrl?: string | null;
    studioManifest?: StudioStationManifest;
    /** Share / route id when it differs from `station.id` (studio UUID). */
    publicId?: string;
  },
): PublicStation {
  const hostPersonaId = resolvePersonaId(station.defaultPersonaId);
  const hostName = getPersonaById(hostPersonaId)?.name ?? "SongHost";
  const publicId = extras?.publicId?.trim() || station.id;

  return {
    id: publicId,
    name: station.name,
    description: station.description?.trim() || `A custom AI radio station on SongHost.`,
    coverImageUrl: coverFromStation(station, extras?.coverImageUrl),
    hostPersonaId,
    hostName,
    seedArtists: station.seedArtists?.length
      ? station.seedArtists
      : extras?.studioManifest?.seedArtists?.length
        ? extras.studioManifest.seedArtists
        : uniqueArtists(station.tracks),
    genres: station.seedGenres?.length
      ? station.seedGenres
      : extras?.studioManifest?.seedGenres?.length
        ? extras.studioManifest.seedGenres
        : genresFromStation(station),
    source,
    station: { ...station, id: source === "studio" ? station.id : publicId },
    studioManifest: extras?.studioManifest,
  };
}

function isStationTrack(value: unknown): value is StationTrack {
  if (typeof value !== "object" || value === null) return false;
  const track = value as Partial<StationTrack>;
  return (
    typeof track.title === "string" &&
    track.title.trim().length > 0 &&
    typeof track.artist === "string" &&
    track.artist.trim().length > 0
  );
}

/** Best-effort parse of a persisted `Station` JSON blob from Postgres. */
export function parsePersistedStation(
  value: unknown,
  fallbackId: string,
  fallbackName: string,
): Station | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Partial<Station> & { tracks?: unknown };

  const seeds = readBlueprintSeeds(raw);
  const tracks = Array.isArray(raw.tracks)
    ? raw.tracks.filter(isStationTrack).map((track) => ({
        ...track,
        youtubeId: typeof track.youtubeId === "string" ? track.youtubeId : "",
        title: track.title.trim(),
        artist: track.artist.trim(),
      }))
    : [];

  if (tracks.length === 0 && !raw.youtubeVideoId && !hasBlueprintSeeds(seeds)) return null;

  const id =
    typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : fallbackId;
  const name =
    typeof raw.name === "string" && raw.name.trim()
      ? raw.name.trim()
      : fallbackName;
  const persona =
    typeof raw.defaultPersonaId === "string" && raw.defaultPersonaId.trim()
      ? resolvePersonaId(raw.defaultPersonaId)
      : DEFAULT_PERSONA.id;

  const coverUrl =
    typeof raw.coverUrl === "string" && raw.coverUrl.trim()
      ? raw.coverUrl.trim()
      : undefined;

  return {
    id,
    name,
    frequency:
      typeof raw.frequency === "number" && Number.isFinite(raw.frequency)
        ? raw.frequency
        : 99.9,
    category: raw.category === "decades" ? "decades" : "genres",
    defaultPersonaId: persona,
    accentColor:
      typeof raw.accentColor === "string" && raw.accentColor.trim()
        ? raw.accentColor
        : "#2992cf",
    ...(coverUrl ? { coverUrl } : {}),
    youtubeVideoId:
      (typeof raw.youtubeVideoId === "string" && raw.youtubeVideoId) ||
      tracks[0]?.youtubeId ||
      "",
    youtubePlaylistId:
      typeof raw.youtubePlaylistId === "string" ? raw.youtubePlaylistId : undefined,
    tracks,
    description:
      typeof raw.description === "string" && raw.description.trim()
        ? raw.description.trim()
        : hasBlueprintSeeds(seeds)
          ? `Live channel — ${(seeds.seedGenres ?? seeds.seedArtists ?? []).slice(0, 3).join(" · ")}`
          : `Saved station — ${tracks.length} track${tracks.length === 1 ? "" : "s"}`,
    ...seeds,
    ...(Array.isArray(raw.studioBreaks) && raw.studioBreaks.length
      ? { studioBreaks: raw.studioBreaks as Station["studioBreaks"] }
      : {}),
  };
}

async function resolveFromPostgres(id: string): Promise<PublicStation | null> {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(userSavedStations)
      .where(eq(userSavedStations.stationId, id))
      .orderBy(desc(userSavedStations.updatedAt))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const station = parsePersistedStation(
      row.stationConfig,
      row.stationId,
      row.stationName,
    );
    if (!station) return null;
    return toPublicStation(station, "saved", { publicId: id });
  } catch (err) {
    console.warn("[public-station] Postgres lookup skipped:", err);
    return null;
  }
}

async function resolveFromStudio(id: string): Promise<PublicStation | null> {
  const manifest = await loadStudioManifest(id);
  if (!manifest) return null;

  const djConfig = normalizeStudioDjConfig(manifest.djConfig, DEFAULT_PERSONA.id);
  const normalized: StudioStationManifest = { ...manifest, djConfig };
  const station = studioManifestToStation(normalized);

  return toPublicStation(station, "studio", {
    coverImageUrl: normalized.coverImageUrl,
    studioManifest: normalized,
    publicId: normalized.id,
  });
}

/** Resolve a public station id from catalog, Postgres, or R2 studio storage. */
export async function resolvePublicStation(
  id: string,
): Promise<PublicStation | null> {
  const trimmed = id?.trim();
  if (!trimmed) return null;

  const catalog = getStationById(trimmed);
  if (catalog) {
    return toPublicStation(catalog, "catalog", { publicId: catalog.id });
  }

  const saved = await resolveFromPostgres(trimmed);
  if (saved) return saved;

  return resolveFromStudio(trimmed);
}

/** Social / SEO description for OpenGraph and `<meta name="description">`. */
export function buildPublicStationDescription(station: PublicStation): string {
  const featuring =
    station.seedArtists.length > 0
      ? station.seedArtists.join(", ")
      : station.genres.length > 0
        ? station.genres.join(", ")
        : station.description;
  return `Hosted by ${station.hostName}. A custom AI radio station featuring ${featuring}.`;
}

export function buildPublicStationTitle(station: PublicStation): string {
  return `${station.name} — AI Radio on SongHost`;
}

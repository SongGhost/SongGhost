import type { PersonaId } from "@/data/personas";
import { STATIONS, type Station, type StationTrack } from "@/data/stations";
import { matchPersonaForArtist } from "@/lib/artist-radio";

export const SONG_RADIO_RECOMMENDATION_COUNT = 15;

export type SongRadioResult = {
  seedTitle: string;
  seedArtist: string;
  seedSpotifyId?: string;
  tracks: StationTrack[];
  personaId: PersonaId;
  station: Station;
};

function slugifySeed(title: string, artist: string): string {
  const base = `${artist}-${title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return base || "song";
}

export function isSongRadioStation(stationId: string): boolean {
  return stationId.startsWith("song-radio-");
}

export function createSongRadioStation(
  seedTitle: string,
  seedArtist: string,
  tracks: StationTrack[],
  personaId: PersonaId,
): Station {
  const first = tracks[0];
  return {
    id: `song-radio-${slugifySeed(seedTitle, seedArtist)}-${Date.now()}`,
    name: `Song Radio: ${seedTitle}`,
    frequency: 99.7,
    category: "genres",
    defaultPersonaId: personaId,
    accentColor: "#2992cf",
    youtubeVideoId: first?.youtubeId ?? "",
    tracks,
    seedArtists: [seedArtist],
    description: `Seeded radio starting with ${seedTitle} by ${seedArtist}`,
  };
}

export function buildSongRadioResult(
  seedTitle: string,
  seedArtist: string,
  tracks: StationTrack[],
  seedSpotifyId?: string,
): SongRadioResult {
  const personaId = matchPersonaForArtist(seedArtist, tracks);
  const station = createSongRadioStation(seedTitle, seedArtist, tracks, personaId);
  return {
    seedTitle,
    seedArtist,
    seedSpotifyId,
    tracks,
    personaId,
    station,
  };
}

/**
 * Library fallback when Spotify recommendations are unavailable: pull tracks
 * that share the seed artist from curated stations, seed first.
 */
export function findLibrarySongRadioTracks(
  seedTitle: string,
  seedArtist: string,
  limit = SONG_RADIO_RECOMMENDATION_COUNT,
): StationTrack[] {
  const artistQ = seedArtist.toLowerCase().trim();
  const titleQ = seedTitle.toLowerCase().trim();
  const matches: StationTrack[] = [];
  const seen = new Set<string>();

  let seed: StationTrack | undefined;

  for (const station of STATIONS) {
    for (const track of station.tracks) {
      const key = track.youtubeId || `${track.artist}::${track.title}`;
      if (seen.has(key)) continue;

      const sameArtist =
        track.artist.toLowerCase().includes(artistQ) ||
        artistQ.includes(track.artist.toLowerCase());
      if (!sameArtist) continue;

      seen.add(key);
      if (
        !seed &&
        track.title.toLowerCase() === titleQ
      ) {
        seed = track;
        continue;
      }
      matches.push(track);
      if (matches.length >= limit) break;
    }
    if (matches.length >= limit) break;
  }

  if (seed) return [seed, ...matches.slice(0, limit)];
  return matches.slice(0, limit);
}

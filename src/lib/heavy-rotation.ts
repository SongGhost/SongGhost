import type { PersonaId } from "@/data/personas";
import type { Station, StationTrack } from "@/data/stations";
import { matchPersonaForArtist } from "@/lib/artist-radio";

/** Target queue depth for a Heavy Rotation session. */
export const HEAVY_ROTATION_TRACK_COUNT = 20;

export type HeavyRotationArtist = {
  id: string;
  name: string;
  imageUrl?: string;
  genres?: string[];
};

export type HeavyRotationResult = {
  artists: HeavyRotationArtist[];
  tracks: StationTrack[];
  personaId: PersonaId;
  station: Station;
};

export function isHeavyRotationStation(stationId: string): boolean {
  return stationId.startsWith("heavy-rotation-");
}

export function createHeavyRotationStation(
  artists: HeavyRotationArtist[],
  tracks: StationTrack[],
  personaId: PersonaId,
): Station {
  const first = tracks[0];
  const leadNames = artists
    .slice(0, 3)
    .map((a) => a.name)
    .filter(Boolean);
  const blurb =
    leadNames.length > 0
      ? `Built from your top artists: ${leadNames.join(", ")}`
      : "Personalized station from your Spotify listening history";

  return {
    id: `heavy-rotation-${Date.now()}`,
    name: "Your Heavy Rotation",
    frequency: 100.1,
    category: "genres",
    defaultPersonaId: personaId,
    accentColor: "#2992cf",
    youtubeVideoId: first?.youtubeId ?? "",
    tracks,
    description: blurb,
  };
}

export function buildHeavyRotationResult(
  artists: HeavyRotationArtist[],
  tracks: StationTrack[],
): HeavyRotationResult {
  const seedArtist = artists[0]?.name ?? tracks[0]?.artist ?? "Your Station";
  const personaId = matchPersonaForArtist(seedArtist, tracks);
  const station = createHeavyRotationStation(artists, tracks, personaId);
  return { artists, tracks, personaId, station };
}

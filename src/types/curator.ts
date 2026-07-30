import type { PersonaId } from "@/data/personas";
import type { StationTrack } from "@/data/stations";

export type CuratedPlaylistResult = {
  name: string;
  description: string;
  personaId: PersonaId;
  accentColor: string;
  tracks: StationTrack[];
};

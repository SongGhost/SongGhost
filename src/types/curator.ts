import type { PersonaId } from "@/data/personas";
import type { StationTrack } from "@/data/stations";

export type CuratedPlaylistResult = {
  name: string;
  description: string;
  personaId: PersonaId;
  accentColor: string;
  tracks: StationTrack[];
  tailPlan?: { artist: string; title: string; alt?: string[] }[];
  pool?: { name: string; match?: number; ecosystem?: boolean }[];
  cast?: { close: string[]; peer: string[]; deep: string[] };
};

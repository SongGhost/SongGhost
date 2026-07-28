import type { PersonaId } from "@/data/personas";
import type { VoiceOption } from "./voice";

export type UserTier = "Free" | "Pro";

export type PlayHistoryEntry = {
  id: string;
  title: string;
  artist: string;
  stationId: string;
  youtubeId: string;
  playedAt: string;
};

export type LikedTrack = {
  id: string;
  title: string;
  artist: string;
  youtubeId: string;
  likedAt: string;
};

export type UserPreferences = {
  userTier: UserTier;
  preferredVoice: VoiceOption;
  activePersonaId: PersonaId;
  djPacingFrequency: number;
  playHistory: PlayHistoryEntry[];
  likedTracks: LikedTrack[];
};

export const DEFAULT_PREFERENCES: UserPreferences = {
  userTier: "Free",
  preferredVoice: "onyx",
  activePersonaId: "wolfman",
  djPacingFrequency: 1,
  playHistory: [],
  likedTracks: [],
};

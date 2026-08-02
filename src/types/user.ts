import type { PersonaId } from "@/data/personas";
import { DEFAULT_DJ_PACING } from "@/lib/dj/scheduler";
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
  /** Broadcast pacing — engine-managed, not exposed to listeners */
  djPacingFrequency: number;
  playHistory: PlayHistoryEntry[];
  likedTracks: LikedTrack[];
};

export const DEFAULT_PREFERENCES: UserPreferences = {
  userTier: "Free",
  preferredVoice: "onyx",
  activePersonaId: "wolfman",
  djPacingFrequency: DEFAULT_DJ_PACING,
  playHistory: [],
  likedTracks: [],
};

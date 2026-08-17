import { DEFAULT_PERSONA, type PersonaId } from "@/data/personas";
import type { Station } from "@/data/stations";
import { DEFAULT_DJ_PACING } from "@/lib/dj/scheduler";
import {
  DEFAULT_COMMENTARY_FORMAT,
  DEFAULT_DJ_TUNING,
  type CommentaryFormat,
  type DjMood,
  type DjPersonality,
} from "./dj";
import {
  createEmptyMemoryPresets,
  DEFAULT_CHATTER_PACING,
  type ChatterPacing,
  type MemoryPresetList,
  type StationConfigMap,
} from "./station";
import { DEFAULT_VISUALIZER_MODE, type VisualizerMode } from "./visuals";
import type { VoiceOption } from "./voice";

export type UserTier = "Free" | "Pro";

/** Listener-saved stations reuse the preset station contract verbatim. */
export type StationDefinition = Station;

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
  /**
   * Listener's default DJ talk density. Unlike `djPacingFrequency` this one *is*
   * listener-facing and persists; a station-level override in `stationConfigs`
   * beats it whenever that station is on air.
   */
  chatterPacing: ChatterPacing;
  /** Visualizer style the listener last selected on the deck */
  visualizerMode: VisualizerMode;
  /**
   * When false (Clean Mode), catalog APIs drop `explicit` tracks and DJ prompts
   * enforce FCC-safe commentary. Guests default off; logged-in accounts default on.
   */
  allowExplicit: boolean;
  /**
   * Global lore / commentary depth for DJ breaks. Station-level override in
   * `stationConfigs` wins when set. Defaults to `"standard"`.
   */
  commentaryFormat: CommentaryFormat;
  /**
   * Host Studio vocal energy. Station-level override in `stationConfigs` wins
   * when set. Absent on older prefs blobs → Even Keel.
   */
  mood?: DjMood;
  /**
   * Host Studio personality colour. Station-level override in `stationConfigs`
   * wins when set. Absent on older prefs blobs → Normal.
   */
  personality?: DjPersonality;
  /**
   * Optional Broadcast City for weather / local colour (e.g. `"Salt Lake City, UT"`).
   * When set, weather resolution prefers this over IP geolocation (VPN safeguard).
   */
  homeCity?: string;
  /**
   * Last tuned station id for cross-device resume (Postgres JSONB + local prefs).
   * Distinct from tab-scoped `sessionStorage` playhead (`songhost_active_station_id`).
   */
  lastStationId?: string;
  playHistory: PlayHistoryEntry[];
  likedTracks: LikedTrack[];
  /** Stations the listener built from a queue and named themselves */
  savedStations: StationDefinition[];
  /** The six dial memory buttons, index 0 being button 1 */
  memoryPresets: MemoryPresetList;
  /** Host, pacing, era, and vibe overrides keyed by station id */
  stationConfigs: StationConfigMap;
};

/**
 * Guest / unauthenticated baseline. Logged-in accounts without a stored value
 * default `allowExplicit` to `true` when preferences hydrate.
 */
export const DEFAULT_PREFERENCES: UserPreferences = {
  userTier: "Free",
  preferredVoice: "onyx",
  activePersonaId: DEFAULT_PERSONA.id,
  djPacingFrequency: DEFAULT_DJ_PACING,
  chatterPacing: DEFAULT_CHATTER_PACING,
  visualizerMode: DEFAULT_VISUALIZER_MODE,
  allowExplicit: false,
  commentaryFormat: DEFAULT_COMMENTARY_FORMAT,
  mood: DEFAULT_DJ_TUNING.mood,
  personality: DEFAULT_DJ_TUNING.personality,
  playHistory: [],
  likedTracks: [],
  savedStations: [],
  memoryPresets: createEmptyMemoryPresets(),
  stationConfigs: {},
};

/** Resolve Clean Mode default: guests clean, signed-in accounts allow explicit. */
export function defaultAllowExplicit(userId: string | null | undefined): boolean {
  return Boolean(userId);
}

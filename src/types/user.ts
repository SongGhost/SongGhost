import { DEFAULT_PERSONA, type PersonaId } from "@/data/personas";
import type { Station } from "@/data/stations";
import { DEFAULT_DJ_PACING } from "@/lib/dj/scheduler";
import {
  DEFAULT_COMMENTARY_FORMAT,
  DEFAULT_DJ_ENGINE,
  DJ_ENGINE_EPOCH,
  type CommentaryFormat,
  type DjEngine,
} from "./dj";
import {
  createEmptyMemoryPresets,
  DEFAULT_CHATTER_PACING,
  type ChatterPacing,
  type MemoryPresetList,
  type StationConfigMap,
} from "./station";
import { DEFAULT_VISUALIZER_MODE, type VisualizerMode } from "./visuals";
import type { PreferredVoice } from "./voice";

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
  /**
   * Host Studio voice pick. OpenAI id (`onyx`, …) or namespaced laptop slot
   * (`local:1` … `local:4`). Live dial follows this pick (OpenAI or local sidecar).
   */
  preferredVoice: PreferredVoice;
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
   * Host Studio sentence writer. Classic is today's two-clip teaching host.
   * New is the fact-only words engine. Global — not a per-station override.
   */
  djEngine: DjEngine;
  /**
   * Bumped when New became the default. Older blobs migrate to New once.
   * A Classic choice made after that bump is kept.
   */
  djEngineEpoch: number;
  /**
   * Host Settings voice-slider gain (0–1). Absent until the listener sets it
   * or an account snapshot includes it. The legacy `songhost_dj_volume` key
   * still fills the slider when this is missing.
   */
  djVolume?: number;
  /**
   * When this DJ snapshot was last changed, in epoch milliseconds.
   * Signed-in saves send it to the account. A missing stamp is not a save.
   */
  preferencesUpdatedAt?: number;
  /**
   * Optional Broadcast City for weather / local colour (e.g. `"Salt Lake City, UT"`).
   * When set, weather resolution prefers this over IP geolocation (VPN safeguard).
   */
  homeCity?: string;
  /**
   * Natural Pace (`standard` chatter) only. When true (default), the host names
   * every song — ducked over a long intro, or in a catch-up recap between songs.
   * When false, Natural Pace keeps today's silent gaps and names only some songs.
   * Has no effect on talkative / music_focused / music_only.
   */
  alwaysAnnounceSongs: boolean;
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
  djEngine: DEFAULT_DJ_ENGINE,
  djEngineEpoch: DJ_ENGINE_EPOCH,
  alwaysAnnounceSongs: true,
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

"use client";

import { useAuth } from "@clerk/nextjs";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_PREFERENCES,
  type LikedTrack,
  type PlayHistoryEntry,
  type StationDefinition,
  type UserPreferences,
  type UserTier,
} from "@/types/user";
import { resolvePersonaId, type PersonaId } from "@/data/personas";
import type { Station } from "@/data/stations";
import {
  assignMemoryPreset,
  clearMemoryPreset as clearPresetSlot,
  normalizeMemoryPresets,
  normalizeStationConfig,
  normalizeStationConfigs,
  resolveChatterPacing,
  type ChatterPacing,
  type MemoryPreset,
  type StationConfig,
} from "@/types/station";
import {
  DEFAULT_VISUALIZER_MODE,
  isVisualizerMode,
  type VisualizerMode,
} from "@/types/visuals";
import type { VoiceOption } from "@/types/voice";
import {
  loadMemoryPresetAssignments,
  saveMemoryPresetAssignments,
} from "@/lib/user/feedback";
import {
  hydrateSavedPlaylists,
  saveSavedPlaylists,
} from "@/lib/station/saved-playlists";
import {
  readPrefsRaw,
  toggleSaveStation as toggleSaveStationList,
  upsertSavedStation,
  writePrefsRaw,
} from "@/lib/user/preferences";

type UserPreferencesContextValue = UserPreferences & {
  /** False until Clerk auth + localStorage prefs have been applied. */
  isHydrated: boolean;
  songCounter: number;
  incrementSongCounter: () => number;
  resetSongCounter: () => void;
  setUserTier: (tier: UserTier) => void;
  setPreferredVoice: (voice: VoiceOption) => void;
  setActivePersonaId: (personaId: PersonaId) => void;
  setVisualizerMode: (mode: VisualizerMode) => void;
  setChatterPacing: (pacing: ChatterPacing) => void;
  addToPlayHistory: (entry: Omit<PlayHistoryEntry, "playedAt">) => void;
  toggleLikedTrack: (track: Omit<LikedTrack, "likedAt">) => void;
  isTrackLiked: (youtubeId: string) => boolean;
  /** Serialize a live station (including ephemeral Artist Radio) into `savedStations`. */
  saveStation: (station: Station, config?: Partial<StationConfig> | null) => void;
  /** Alias for {@link saveStation} — keeps older call sites working. */
  saveCustomStation: (station: StationDefinition) => void;
  /** Toggle a station in the saved catalog; dynamic stations are fully serialized. */
  toggleSaveStation: (
    station: Station,
    config?: Partial<StationConfig> | null,
  ) => boolean;
  deleteCustomStation: (stationId: string) => void;
  /**
   * Park a dial memory slot. When `station` is supplied (Artist Radio, Song Radio,
   * Curator, etc.), its full payload is also written into `savedStations` so the
   * toolbar can retune after a reboot.
   */
  saveMemoryPreset: (
    slot: number,
    preset: Omit<MemoryPreset, "slot" | "savedAt">,
    station?: Station,
  ) => void;
  clearMemoryPreset: (slot: number) => void;
  /** Alias for {@link clearMemoryPreset} — empty a dial slot back to `---`. */
  clearPreset: (slotIndex: number) => void;
  getStationConfig: (stationId: string) => StationConfig | undefined;
  setStationConfig: (stationId: string, patch: Partial<StationConfig>) => void;
  resetStationConfig: (stationId: string) => void;
};

const UserPreferencesContext = createContext<UserPreferencesContextValue | null>(null);

type PreferencesLoadResult = {
  prefs: UserPreferences;
  /**
   * False when the prefs blob was unreadable. Callers must not write defaults
   * back over the raw localStorage entry — that would wipe the listener's data.
   */
  canPersistPrefs: boolean;
};

function loadPreferences(userId: string | null | undefined): PreferencesLoadResult {
  if (typeof window === "undefined") {
    return { prefs: DEFAULT_PREFERENCES, canPersistPrefs: false };
  }

  // Saved playlists live in their own per-account key so a corrupt prefs blob
  // cannot erase them. hydrateSavedPlaylists also migrates older catalogs forward.
  let savedStations: StationDefinition[] = [];
  try {
    const rawForMigration = readPrefsRaw(userId);
    const prefsSlice = rawForMigration
      ? (JSON.parse(rawForMigration) as Partial<UserPreferences>).savedStations
      : undefined;
    savedStations = hydrateSavedPlaylists(prefsSlice, userId).stations;
  } catch (error) {
    console.warn("[SongGhost] savedPlaylistsPrefsSliceFailed", { error });
    savedStations = hydrateSavedPlaylists(undefined, userId).stations;
  }

  try {
    const raw = readPrefsRaw(userId);
    if (!raw) {
      return {
        prefs: { ...DEFAULT_PREFERENCES, savedStations },
        canPersistPrefs: true,
      };
    }
    const stored = JSON.parse(raw) as Partial<UserPreferences>;
    // Pacing is engine-owned, so a value persisted by an older build must not stick.
    // Host ids are remapped rather than trusted: a retired persona would otherwise
    // leave the DJ label blank and send an unknown id to the script and voice APIs.
    return {
      prefs: {
        ...DEFAULT_PREFERENCES,
        ...stored,
        djPacingFrequency: DEFAULT_PREFERENCES.djPacingFrequency,
        activePersonaId: resolvePersonaId(stored.activePersonaId),
        chatterPacing: resolveChatterPacing(stored.chatterPacing),
        // The toolbar indexes straight into the preset list, so it has to come back
        // length-locked at six no matter what an older build wrote. The dedicated
        // memory mirror (readable mid-queue without waiting on this context) wins
        // when it already holds assignments; otherwise the prefs blob is the source.
        memoryPresets: (() => {
          const mirrored = loadMemoryPresetAssignments(userId);
          const fromPrefs = normalizeMemoryPresets(stored.memoryPresets);
          return mirrored.some(Boolean) ? mirrored : fromPrefs;
        })(),
        stationConfigs: normalizeStationConfigs(stored.stationConfigs),
        // A mode retired since this was written would leave the deck with no
        // renderer at all, so an unrecognized value falls back rather than sticks.
        visualizerMode: isVisualizerMode(stored.visualizerMode)
          ? stored.visualizerMode
          : DEFAULT_VISUALIZER_MODE,
        savedStations,
      },
      canPersistPrefs: true,
    };
  } catch (error) {
    // Leave the raw prefs blob untouched — in-memory defaults are session-only.
    console.warn("[SongGhost] preferencesHydrateFailed", { error });
    return {
      prefs: { ...DEFAULT_PREFERENCES, savedStations },
      canPersistPrefs: false,
    };
  }
}

function savePreferences(userId: string | null | undefined, prefs: UserPreferences) {
  if (typeof window === "undefined") return;
  try {
    writePrefsRaw(userId, JSON.stringify(prefs));
  } catch (error) {
    console.warn("[SongGhost] preferencesPersistFailed", { error });
  }
  // Dual-write dial memory so implicit-preference readers share the same six slots.
  saveMemoryPresetAssignments(prefs.memoryPresets, userId);
  // Dual-write saved playlists so the catalog survives prefs-blob failures.
  saveSavedPlaylists(prefs.savedStations, userId);
}

/** Drop one station's overrides without mutating the stored map. */
function withoutStationConfig(
  configs: UserPreferences["stationConfigs"],
  stationId: string,
): UserPreferences["stationConfigs"] {
  return Object.fromEntries(Object.entries(configs).filter(([id]) => id !== stationId));
}

export function UserPreferencesProvider({ children }: { children: ReactNode }) {
  const { userId, isLoaded } = useAuth();
  const [prefs, setPrefs] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [songCounter, setSongCounter] = useState(0);
  const songCounterRef = useRef(0);
  const [isHydrated, setIsHydrated] = useState(false);
  /** When false, the prefs blob stays untouched; playlist dual-write still runs. */
  const canPersistPrefsRef = useRef(true);
  /**
   * Account the current in-memory prefs belong to. Blocks cross-user writes and
   * prevents the initial DEFAULT_PREFERENCES snapshot from touching localStorage
   * while Clerk's `userId` is still undefined.
   */
  const hydratedUserRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    // Do not read or write preferences until Clerk has resolved auth.
    if (!isLoaded) return;

    let cancelled = false;
    setIsHydrated(false);
    hydratedUserRef.current = undefined;

    const loaded = loadPreferences(userId);
    if (cancelled) return;

    canPersistPrefsRef.current = loaded.canPersistPrefs;
    setPrefs(loaded.prefs);
    songCounterRef.current = 0;
    setSongCounter(0);
    hydratedUserRef.current = userId;
    setIsHydrated(true);

    return () => {
      cancelled = true;
    };
  }, [isLoaded, userId]);

  useEffect(() => {
    // Guard: never persist the blank default state during SSR / pre-auth hydration.
    if (!isLoaded || !isHydrated) return;
    if (hydratedUserRef.current !== userId) return;

    if (canPersistPrefsRef.current) {
      savePreferences(userId, prefs);
      return;
    }
    // Prefs blob was unreadable — never overwrite it with defaults, but keep the
    // dedicated playlist mirror current so new saves still survive a reload.
    saveSavedPlaylists(prefs.savedStations, userId);
  }, [prefs, userId, isHydrated, isLoaded]);

  const updatePrefs = useCallback((patch: Partial<UserPreferences>) => {
    setPrefs((prev) => ({ ...prev, ...patch }));
  }, []);

  const incrementSongCounter = useCallback(() => {
    songCounterRef.current += 1;
    setSongCounter(songCounterRef.current);
    return songCounterRef.current;
  }, []);

  const resetSongCounter = useCallback(() => {
    songCounterRef.current = 0;
    setSongCounter(0);
  }, []);

  const addToPlayHistory = useCallback(
    (entry: Omit<PlayHistoryEntry, "playedAt">) => {
      setPrefs((prev) => {
        const playedAt = new Date().toISOString();
        const newEntry = { ...entry, playedAt };
        const filtered = prev.playHistory.filter((h) => h.youtubeId !== entry.youtubeId);
        return {
          ...prev,
          playHistory: [newEntry, ...filtered].slice(0, 50),
        };
      });
    },
    [],
  );

  const toggleLikedTrack = useCallback((track: Omit<LikedTrack, "likedAt">) => {
    setPrefs((prev) => {
      const exists = prev.likedTracks.some((t) => t.youtubeId === track.youtubeId);
      if (exists) {
        return {
          ...prev,
          likedTracks: prev.likedTracks.filter((t) => t.youtubeId !== track.youtubeId),
        };
      }
      return {
        ...prev,
        likedTracks: [{ ...track, likedAt: new Date().toISOString() }, ...prev.likedTracks],
      };
    });
  }, []);

  const isTrackLiked = useCallback(
    (youtubeId: string) => prefs.likedTracks.some((t) => t.youtubeId === youtubeId),
    [prefs.likedTracks],
  );

  // Dynamic stations (artist-radio-*, song-radio-*, ai-curator-*) are serialized
  // into a complete Station payload so reboot can relaunch from savedStations.
  const saveStation = useCallback(
    (station: Station, config?: Partial<StationConfig> | null) => {
      setPrefs((prev) => ({
        ...prev,
        savedStations: upsertSavedStation(prev.savedStations, station, { config }),
      }));
    },
    [],
  );

  const saveCustomStation = useCallback(
    (station: StationDefinition) => {
      saveStation(station);
    },
    [saveStation],
  );

  const toggleSaveStation = useCallback(
    (station: Station, config?: Partial<StationConfig> | null) => {
      let saved = false;
      setPrefs((prev) => {
        const result = toggleSaveStationList(prev.savedStations, station, { config });
        saved = result.saved;
        return { ...prev, savedStations: result.stations };
      });
      return saved;
    },
    [],
  );

  // A deleted station leaves behind a dial button that tunes nowhere and an
  // override map entry nothing can ever read, so both are swept with it.
  const deleteCustomStation = useCallback((stationId: string) => {
    setPrefs((prev) => ({
      ...prev,
      savedStations: prev.savedStations.filter((s) => s.id !== stationId),
      memoryPresets: normalizeMemoryPresets(prev.memoryPresets).map((preset) =>
        preset?.stationId === stationId ? null : preset,
      ),
      stationConfigs: withoutStationConfig(prev.stationConfigs, stationId),
    }));
  }, []);

  const saveMemoryPreset = useCallback(
    (slot: number, preset: Omit<MemoryPreset, "slot" | "savedAt">, station?: Station) => {
      setPrefs((prev) => {
        const nextPresets = assignMemoryPreset(prev.memoryPresets, slot, preset);
        if (!station) {
          return { ...prev, memoryPresets: nextPresets };
        }
        // Bake any chatter/host override already on this station into the snapshot
        // so a memory-toolbar relaunch restores the same on-air feel.
        const config = prev.stationConfigs[station.id];
        return {
          ...prev,
          memoryPresets: nextPresets,
          savedStations: upsertSavedStation(prev.savedStations, station, { config }),
        };
      });
    },
    [],
  );

  const clearMemoryPreset = useCallback((slot: number) => {
    setPrefs((prev) => ({
      ...prev,
      memoryPresets: clearPresetSlot(prev.memoryPresets, slot),
    }));
  }, []);

  const clearPreset = clearMemoryPreset;

  const setStationConfig = useCallback((stationId: string, patch: Partial<StationConfig>) => {
    if (!stationId.trim()) return;
    setPrefs((prev) => ({
      ...prev,
      stationConfigs: {
        ...prev.stationConfigs,
        [stationId]: normalizeStationConfig(stationId, {
          ...prev.stationConfigs[stationId],
          ...patch,
        }),
      },
    }));
  }, []);

  const resetStationConfig = useCallback((stationId: string) => {
    setPrefs((prev) => ({
      ...prev,
      stationConfigs: withoutStationConfig(prev.stationConfigs, stationId),
    }));
  }, []);

  const getStationConfig = useCallback(
    (stationId: string) => prefs.stationConfigs[stationId],
    [prefs.stationConfigs],
  );

  const value = useMemo<UserPreferencesContextValue>(
    () => ({
      ...prefs,
      isHydrated,
      songCounter,
      incrementSongCounter,
      resetSongCounter,
      setUserTier: (tier) => updatePrefs({ userTier: tier }),
      setPreferredVoice: (voice) => updatePrefs({ preferredVoice: voice }),
      setActivePersonaId: (personaId) => updatePrefs({ activePersonaId: personaId }),
      setVisualizerMode: (mode) => updatePrefs({ visualizerMode: mode }),
      setChatterPacing: (pacing) => updatePrefs({ chatterPacing: resolveChatterPacing(pacing) }),
      addToPlayHistory,
      toggleLikedTrack,
      isTrackLiked,
      saveStation,
      saveCustomStation,
      toggleSaveStation,
      deleteCustomStation,
      saveMemoryPreset,
      clearMemoryPreset,
      clearPreset,
      getStationConfig,
      setStationConfig,
      resetStationConfig,
    }),
    [
      prefs,
      isHydrated,
      songCounter,
      incrementSongCounter,
      resetSongCounter,
      updatePrefs,
      addToPlayHistory,
      toggleLikedTrack,
      isTrackLiked,
      saveStation,
      saveCustomStation,
      toggleSaveStation,
      deleteCustomStation,
      saveMemoryPreset,
      clearMemoryPreset,
      clearPreset,
      getStationConfig,
      setStationConfig,
      resetStationConfig,
    ],
  );

  return (
    <UserPreferencesContext.Provider value={value}>{children}</UserPreferencesContext.Provider>
  );
}

export function useUserPreferences() {
  const ctx = useContext(UserPreferencesContext);
  if (!ctx) {
    throw new Error("useUserPreferences must be used within UserPreferencesProvider");
  }
  return ctx;
}

export { serializeStationForSave } from "@/lib/user/preferences";

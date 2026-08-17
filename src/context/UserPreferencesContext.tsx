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
  defaultAllowExplicit,
  type LikedTrack,
  type PlayHistoryEntry,
  type StationDefinition,
  type UserPreferences,
  type UserTier,
} from "@/types/user";
import { type PersonaId } from "@/data/personas";
import type { Station } from "@/data/stations";
import {
  resolveCommentaryFormat,
  resolveDjMood,
  resolveDjPersonality,
  type CommentaryFormat,
} from "@/types/dj";
import {
  assignMemoryPreset,
  clearMemoryPreset as clearPresetSlot,
  DEFAULT_CHATTER_PACING,
  normalizeMemoryPresets,
  normalizeStationConfig,
  resolveChatterPacing,
  type ChatterPacing,
  type MemoryPreset,
  type StationConfig,
} from "@/types/station";
import type { VisualizerMode } from "@/types/visuals";
import type { VoiceOption } from "@/types/voice";
import {
  loadMemoryPresetAssignments,
  saveMemoryPresetAssignments,
} from "@/lib/user/feedback";
import {
  hydrateSavedPlaylists,
  mergeSavedStationLists,
  saveSavedPlaylists,
} from "@/lib/station/saved-playlists";
import {
  fetchUserSync,
  hasAssignedMemoryPresets,
  pushUserSync,
  rehydrateStationConfigsFromSync,
  schedulePreferencesSync,
} from "@/hooks/useUserSync";
import {
  readPrefsRaw,
  toggleSaveStation as toggleSaveStationList,
  upsertSavedStation,
  writePrefsRaw,
  normalizeUserPreferences,
  mergeCloudPreferencesOverLocal,
  normalizeCloudPreferences,
  buildCloudPreferencesPayload,
} from "@/lib/user/preferences";
import {
  applyHostRetentionFromCloud,
  getSessionSnapshot,
  subscribeHostRetentionSync,
} from "@/lib/store/sessionStore";

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
  /** Persist Clean Mode — false drops explicit catalog tracks and censors DJ copy. */
  setAllowExplicit: (allow: boolean) => void;
  /** Persist lore / commentary depth (extended formats are Pro-gated in Host Settings). */
  setCommentaryFormat: (format: CommentaryFormat) => void;
  /** Persist Broadcast City for VPN-safe weather / local colour. */
  setHomeCity: (city: string) => void;
  /** Persist Host Studio vocal energy (global + optional per-station override). */
  setDjMood: (mood: string, stationId?: string) => void;
  /** Persist Host Studio personality colour (global + optional per-station override). */
  setDjPersonality: (personality: string, stationId?: string) => void;
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
   * Park a dial memory slot. When `station` is supplied for an authenticated
   * listener (Artist Radio, Song Radio, Curator, etc.), its full payload is also
   * written into `savedStations` so the toolbar can retune after a reboot.
   * Omit `station` for catalog / starter presets — memory slots only.
   */
  saveMemoryPreset: (
    slot: number,
    preset: Omit<MemoryPreset, "slot" | "savedAt">,
    station?: Station,
  ) => void;
  /** Alias for {@link saveMemoryPreset} — Phase 5B cloud-sync call sites. */
  parkMemoryPreset: (
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
  /** Persist the last tuned station id for cross-device Path B resume. */
  setLastStationId: (stationId: string) => void;
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

  const isAuthenticated = Boolean(userId?.trim());

  // Saved playlists are account-bound. Guests never hydrate local/default catalogs
  // into `savedStations` — that shelf stays empty until sign-in + cloud sync.
  let savedStations: StationDefinition[] = [];
  if (isAuthenticated) {
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
  }

  try {
    const raw = readPrefsRaw(userId);
    if (!raw) {
      return {
        prefs: {
          ...DEFAULT_PREFERENCES,
          allowExplicit: defaultAllowExplicit(userId),
          savedStations,
        },
        canPersistPrefs: true,
      };
    }
    const stored = JSON.parse(raw) as Partial<UserPreferences>;
    const normalized = normalizeUserPreferences(stored);
    // Host ids, pacing, mood, and personality are remapped inside
    // normalizeUserPreferences rather than trusted from the raw blob.
    return {
      prefs: {
        ...normalized,
        // Guests stay clean unless they opted in; signed-in accounts default open
        // when an older prefs blob never stored the flag.
        allowExplicit:
          typeof stored.allowExplicit === "boolean"
            ? stored.allowExplicit
            : defaultAllowExplicit(userId),
        // The toolbar indexes straight into the preset list, so it has to come back
        // length-locked at six no matter what an older build wrote. The dedicated
        // memory mirror (readable mid-queue without waiting on this context) wins
        // when it already holds assignments; otherwise the prefs blob is the source.
        memoryPresets: (() => {
          const mirrored = loadMemoryPresetAssignments(userId);
          const fromPrefs = normalized.memoryPresets;
          return mirrored.some(Boolean) ? mirrored : fromPrefs;
        })(),
        savedStations,
      },
      canPersistPrefs: true,
    };
  } catch (error) {
    // Leave the raw prefs blob untouched — in-memory defaults are session-only.
    console.warn("[SongGhost] preferencesHydrateFailed", { error });
    return {
      prefs: {
        ...DEFAULT_PREFERENCES,
        allowExplicit: defaultAllowExplicit(userId),
        savedStations,
      },
      canPersistPrefs: false,
    };
  }
}

function savePreferences(userId: string | null | undefined, prefs: UserPreferences) {
  if (typeof window === "undefined") return;
  const isAuthenticated = Boolean(userId?.trim());
  // Guests keep memory dials locally but never persist a saved-station library.
  const toPersist: UserPreferences = isAuthenticated
    ? prefs
    : { ...prefs, savedStations: [] };
  try {
    writePrefsRaw(userId, JSON.stringify(toPersist));
  } catch (error) {
    console.warn("[SongGhost] preferencesPersistFailed", { error });
  }
  // Dual-write dial memory so implicit-preference readers share the same six slots.
  saveMemoryPresetAssignments(toPersist.memoryPresets, userId);
  // Dual-write saved playlists so the catalog survives prefs-blob failures.
  // Guests always write [] so a prior starter-seed leak cannot reappear on reload.
  saveSavedPlaylists(toPersist.savedStations, userId);
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
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  /**
   * Skip the first cloud-prefs POST after local/cloud hydrate so a boot merge
   * cannot echo defaults back over a richer remote document.
   */
  const skipNextPrefsPushRef = useRef(true);
  /** Signed-in cloud GET has finished (or guest — no cloud). */
  const cloudPrefsReadyRef = useRef(false);

  const queuePreferencesSync = useCallback(() => {
    if (!userId) return;
    if (skipNextPrefsPushRef.current) return;
    schedulePreferencesSync(
      buildCloudPreferencesPayload(prefsRef.current, getSessionSnapshot()),
    );
  }, [userId]);

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
    prefsRef.current = loaded.prefs;
    songCounterRef.current = 0;
    setSongCounter(0);
    hydratedUserRef.current = userId;
    skipNextPrefsPushRef.current = true;
    cloudPrefsReadyRef.current = !userId;
    setIsHydrated(true);

    return () => {
      cancelled = true;
    };
  }, [isLoaded, userId]);

  // Phase 5B: after local hydrate, pull cloud memory + saved stations + the
  // JSONB preference slice for the signed-in Clerk account. Cloud wins on
  // conflict; localStorage remains the offline source of truth.
  useEffect(() => {
    if (!isLoaded || !isHydrated || !userId) return;
    if (hydratedUserRef.current !== userId) return;

    let cancelled = false;

    void (async () => {
      const remote = await fetchUserSync();
      if (cancelled) return;
      if (!remote) {
        skipNextPrefsPushRef.current = false;
        cloudPrefsReadyRef.current = true;
        queuePreferencesSync();
        return;
      }

      const remotePrefs = normalizeCloudPreferences(remote.preferences);
      if (remotePrefs?.hostRetention) {
        applyHostRetentionFromCloud(remotePrefs.hostRetention);
      }

      skipNextPrefsPushRef.current = true;
      let preservedLocalLastStation = false;
      setPrefs((prev) => {
        const nextMemory = hasAssignedMemoryPresets(remote.memoryPresets)
          ? normalizeMemoryPresets(remote.memoryPresets)
          : prev.memoryPresets;
        const nextSaved = mergeSavedStationLists(
          remote.savedStations,
          prev.savedStations,
        );
        // Restore parked hosts (and nested slot overrides) into stationConfigs
        // so resolveHostId works before the listener presses a memory dial.
        const nextStationConfigs = rehydrateStationConfigsFromSync(
          prev.stationConfigs,
          {
            memoryPresets: nextMemory,
            stationConfigs: remote.stationConfigs,
          },
        );
        const mergedBase: UserPreferences = {
          ...prev,
          memoryPresets: nextMemory,
          savedStations: nextSaved,
          stationConfigs: nextStationConfigs,
        };
        const merged = remotePrefs
          ? mergeCloudPreferencesOverLocal(mergedBase, remotePrefs)
          : mergedBase;
        prefsRef.current = merged;
        const localId = mergedBase.lastStationId?.trim() || "";
        const remoteId = remotePrefs?.lastStationId?.trim() || "";
        preservedLocalLastStation = Boolean(localId) && localId !== remoteId;
        // Keep a session-local lastStationId and still POST it so JSONB catches up.
        skipNextPrefsPushRef.current =
          Boolean(remotePrefs) && !preservedLocalLastStation;
        return merged;
      });
      cloudPrefsReadyRef.current = true;
      if (preservedLocalLastStation) {
        queuePreferencesSync();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isHydrated, userId, queuePreferencesSync]);

  useEffect(() => {
    if (!userId) return;
    return subscribeHostRetentionSync(() => {
      queuePreferencesSync();
    });
  }, [userId, queuePreferencesSync]);

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
    // Guests stay library-empty even on this fallback path.
    saveSavedPlaylists(userId ? prefs.savedStations : [], userId);
  }, [prefs, userId, isHydrated, isLoaded]);

  // Debounced cloud upsert for Host Studio + lastStationId (not play history).
  useEffect(() => {
    if (!isLoaded || !isHydrated || !userId) return;
    if (hydratedUserRef.current !== userId) return;
    if (!cloudPrefsReadyRef.current) return;
    if (skipNextPrefsPushRef.current) {
      skipNextPrefsPushRef.current = false;
      return;
    }
    schedulePreferencesSync(
      buildCloudPreferencesPayload(prefs, getSessionSnapshot()),
    );
  }, [
    isLoaded,
    isHydrated,
    userId,
    prefs.activePersonaId,
    prefs.commentaryFormat,
    prefs.mood,
    prefs.personality,
    prefs.stationConfigs,
    prefs.lastStationId,
  ]);

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
  // Guests cannot mutate the library — `savedStations` stays account-bound.
  const saveStation = useCallback(
    (station: Station, config?: Partial<StationConfig> | null) => {
      if (!userId) return;
      setPrefs((prev) => {
        const savedStations = upsertSavedStation(prev.savedStations, station, {
          config,
        });
        // Local first (prefs effect → localStorage), then background cloud upsert.
        pushUserSync({ savedStations });
        return { ...prev, savedStations };
      });
    },
    [userId],
  );

  const saveCustomStation = useCallback(
    (station: StationDefinition) => {
      saveStation(station);
    },
    [saveStation],
  );

  const toggleSaveStation = useCallback(
    (station: Station, config?: Partial<StationConfig> | null) => {
      if (!userId) return false;
      let saved = false;
      setPrefs((prev) => {
        const result = toggleSaveStationList(prev.savedStations, station, { config });
        saved = result.saved;
        return { ...prev, savedStations: result.stations };
      });
      return saved;
    },
    [userId],
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
        // Starter / catalog parks omit `station` so memory slots never spill into
        // the saved-station library. Guests also stay memory-only.
        if (!station || !userId) {
          if (userId) {
            pushUserSync({
              memoryPresets: nextPresets,
              stationConfigs: prev.stationConfigs,
            });
          }
          return { ...prev, memoryPresets: nextPresets };
        }
        // Bake any chatter/host override already on this station into the snapshot
        // so a memory-toolbar relaunch restores the same on-air feel.
        const config = prev.stationConfigs[station.id];
        const savedStations = upsertSavedStation(prev.savedStations, station, {
          config,
        });
        pushUserSync({
          memoryPresets: nextPresets,
          savedStations,
          stationConfigs: prev.stationConfigs,
        });
        return {
          ...prev,
          memoryPresets: nextPresets,
          savedStations,
        };
      });
    },
    [userId],
  );

  const parkMemoryPreset = saveMemoryPreset;

  const clearMemoryPreset = useCallback((slot: number) => {
    setPrefs((prev) => {
      const memoryPresets = clearPresetSlot(prev.memoryPresets, slot);
      if (userId) {
        pushUserSync({
          memoryPresets,
          stationConfigs: prev.stationConfigs,
        });
      }
      return { ...prev, memoryPresets };
    });
  }, [userId]);

  const clearPreset = clearMemoryPreset;

  const setStationConfig = useCallback((stationId: string, patch: Partial<StationConfig>) => {
    if (!stationId.trim()) return;
    setPrefs((prev) => {
      const next: UserPreferences = {
        ...prev,
        stationConfigs: {
          ...prev.stationConfigs,
          [stationId]: normalizeStationConfig(stationId, {
            ...prev.stationConfigs[stationId],
            ...patch,
          }),
        },
      };
      prefsRef.current = next;
      return next;
    });
  }, []);

  const resetStationConfig = useCallback((stationId: string) => {
    setPrefs((prev) => {
      const next: UserPreferences = {
        ...prev,
        stationConfigs: withoutStationConfig(prev.stationConfigs, stationId),
      };
      prefsRef.current = next;
      return next;
    });
  }, []);

  const getStationConfig = useCallback(
    (stationId: string) => prefs.stationConfigs[stationId],
    [prefs.stationConfigs],
  );

  const setLastStationId = useCallback((stationId: string) => {
    const id = stationId.trim();
    if (!id) return;
    setPrefs((prev) => {
      if (prev.lastStationId === id) return prev;
      const next: UserPreferences = { ...prev, lastStationId: id };
      prefsRef.current = next;
      return next;
    });
  }, []);

  const setDjMood = useCallback((mood: string, stationId?: string) => {
    const resolved = resolveDjMood(mood);
    setPrefs((prev) => {
      const next: UserPreferences = { ...prev, mood: resolved };
      const id = stationId?.trim();
      if (!id) return next;
      return {
        ...next,
        stationConfigs: {
          ...prev.stationConfigs,
          [id]: normalizeStationConfig(id, {
            ...prev.stationConfigs[id],
            mood: resolved,
          }),
        },
      };
    });
  }, []);

  const setDjPersonality = useCallback((personality: string, stationId?: string) => {
    const resolved = resolveDjPersonality(personality);
    setPrefs((prev) => {
      const next: UserPreferences = { ...prev, personality: resolved };
      const id = stationId?.trim();
      if (!id) return next;
      return {
        ...next,
        stationConfigs: {
          ...prev.stationConfigs,
          [id]: normalizeStationConfig(id, {
            ...prev.stationConfigs[id],
            personality: resolved,
          }),
        },
      };
    });
  }, []);

  const value = useMemo<UserPreferencesContextValue>(
    () => ({
      ...prefs,
      isHydrated,
      songCounter,
      incrementSongCounter,
      resetSongCounter,
      setUserTier: (tier) => {
        if (tier === "Free") {
          updatePrefs({
            userTier: tier,
            chatterPacing: DEFAULT_CHATTER_PACING,
          });
          return;
        }
        updatePrefs({ userTier: tier });
      },
      setPreferredVoice: (voice) => updatePrefs({ preferredVoice: voice }),
      setActivePersonaId: (personaId) => updatePrefs({ activePersonaId: personaId }),
      setVisualizerMode: (mode) => updatePrefs({ visualizerMode: mode }),
      setChatterPacing: (pacing) => updatePrefs({ chatterPacing: resolveChatterPacing(pacing) }),
      setAllowExplicit: (allow) => updatePrefs({ allowExplicit: allow }),
      setCommentaryFormat: (format) =>
        updatePrefs({ commentaryFormat: resolveCommentaryFormat(format) }),
      setHomeCity: (city) => {
        const trimmed = city.trim();
        updatePrefs({ homeCity: trimmed || undefined });
      },
      setDjMood,
      setDjPersonality,
      addToPlayHistory,
      toggleLikedTrack,
      isTrackLiked,
      saveStation,
      saveCustomStation,
      toggleSaveStation,
      deleteCustomStation,
      saveMemoryPreset,
      parkMemoryPreset,
      clearMemoryPreset,
      clearPreset,
      getStationConfig,
      setStationConfig,
      resetStationConfig,
      setLastStationId,
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
      parkMemoryPreset,
      clearMemoryPreset,
      clearPreset,
      getStationConfig,
      setStationConfig,
      resetStationConfig,
      setLastStationId,
      setDjMood,
      setDjPersonality,
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

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
  resolveDjEngine,
  type CommentaryFormat,
  type DjEngine,
} from "@/types/dj";
import {
  assignMemoryPreset,
  clearMemoryPreset as clearPresetSlot,
  DEFAULT_CHATTER_PACING,
  normalizeMemoryPresets,
  normalizeStationConfig,
  resolveChatterPacing,
  stripVibePromptsFromStationConfigs,
  type ChatterPacing,
  type MemoryPreset,
  type MemoryPresetProfile,
  type StationConfig,
} from "@/types/station";
import { copyStationSeeds, hasBlueprintSeeds } from "@/lib/station/blueprint";
import type { VisualizerMode } from "@/types/visuals";
import type { PreferredVoice } from "@/types/voice";
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
  migrateAccountDjEngine,
  resolveSignInDjSettings,
} from "@/lib/user/preferences";
import { subscribeDjSettingsRefresh } from "@/lib/user/dj-settings-refresh";
import { setNewerServerPreferencesHandler } from "@/lib/user/cloud-sync";
import {
  getDjBroadcastState,
  subscribeDjBroadcast,
} from "@/lib/dj/broadcast-state";
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
  setPreferredVoice: (voice: PreferredVoice) => void;
  setActivePersonaId: (personaId: PersonaId) => void;
  setVisualizerMode: (mode: VisualizerMode) => void;
  setChatterPacing: (pacing: ChatterPacing) => void;
  /** Persist Clean Mode — false drops explicit catalog tracks and censors DJ copy. */
  setAllowExplicit: (allow: boolean) => void;
  /** Persist lore / commentary depth (extended formats are Pro-gated in Host Settings). */
  setCommentaryFormat: (format: CommentaryFormat) => void;
  /** Persist which DJ sentence writer is on air. New is the default. */
  setDjEngine: (engine: DjEngine) => void;
  /** Persist the Host Settings voice slider (0–1) on this browser and the account. */
  setDjVolume: (volume: number) => void;
  /** Persist Broadcast City for VPN-safe weather / local colour. */
  setHomeCity: (city: string) => void;
  /**
   * Natural Pace only: when true, the host names every song (duck-announce or
   * catch-up recap). Global preference — no station-level override yet.
   */
  setAlwaysAnnounceSongs: (always: boolean) => void;
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
   * listener, its Station Profile JSON (seeds + StationConfig) is written into
   * `savedStations` so the toolbar can retune a fresh statutory stream.
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
  /** Mid-session Pro → Free: drop persisted `vibePrompt` from every station. */
  clearPersistedVibePrompts: () => void;
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
  /** True when a prefs blob was already stored for this user. Defaults are not a save. */
  hadStoredPrefs: boolean;
};

const DJ_STAMP_KEYS = new Set<string>([
  "preferredVoice",
  "activePersonaId",
  "chatterPacing",
  "commentaryFormat",
  "djEngine",
  "allowExplicit",
  "homeCity",
  "alwaysAnnounceSongs",
  "djVolume",
  "stationConfigs",
]);

function loadPreferences(userId: string | null | undefined): PreferencesLoadResult {
  if (typeof window === "undefined") {
    return { prefs: DEFAULT_PREFERENCES, canPersistPrefs: false, hadStoredPrefs: false };
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
      console.warn("[SongHost] savedPlaylistsPrefsSliceFailed", { error });
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
        hadStoredPrefs: false,
      };
    }
    const stored = JSON.parse(raw) as Partial<UserPreferences>;
    const normalized = normalizeUserPreferences(stored);
    // Host ids and pacing are remapped inside
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
      hadStoredPrefs: true,
    };
  } catch (error) {
    // Leave the raw prefs blob untouched — in-memory defaults are session-only.
    console.warn("[SongHost] preferencesHydrateFailed", { error });
    return {
      prefs: {
        ...DEFAULT_PREFERENCES,
        allowExplicit: defaultAllowExplicit(userId),
        savedStations,
      },
      canPersistPrefs: false,
      hadStoredPrefs: false,
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
    console.warn("[SongHost] preferencesPersistFailed", { error });
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
  /** Signed-in cloud GET has finished (or guest — no cloud). Pushes wait on this. */
  const cloudPrefsReadyRef = useRef(false);
  /** Disk blob from the latest auth hydrate. In-flight edits are not part of it. */
  const loadedBaseRef = useRef<UserPreferences | null>(null);
  const localWasStoredRef = useRef(false);
  /** DJ edits made after sign-in starts and before the account document arrives. */
  const pendingDjPatchRef = useRef<Partial<UserPreferences> | null>(null);
  const pendingStationPatchRef = useRef<Record<string, Partial<StationConfig>>>({});
  const pendingStationResetRef = useRef<Set<string>>(new Set());
  const pendingHostLockRef = useRef(false);
  const deferredDjRefreshRef = useRef(false);
  const deferredServerPrefsRef = useRef<ReturnType<typeof normalizeCloudPreferences>>(null);
  const accountLoadInFlightRef = useRef(false);
  const accountLoadGenerationRef = useRef(0);
  const [accountLoadNonce, setAccountLoadNonce] = useState(0);

  const clearPendingDjEdits = useCallback(() => {
    pendingDjPatchRef.current = null;
    pendingStationPatchRef.current = {};
    pendingStationResetRef.current = new Set();
    pendingHostLockRef.current = false;
  }, []);

  useEffect(() => {
    // Do not read or write preferences until Clerk has resolved auth.
    if (!isLoaded) return;

    let cancelled = false;
    setIsHydrated(false);
    hydratedUserRef.current = undefined;
    cloudPrefsReadyRef.current = false;
    clearPendingDjEdits();

    const loaded = loadPreferences(userId);
    if (cancelled) return;

    canPersistPrefsRef.current = loaded.canPersistPrefs;
    localWasStoredRef.current = loaded.hadStoredPrefs;
    loadedBaseRef.current = loaded.prefs;
    setPrefs(loaded.prefs);
    prefsRef.current = loaded.prefs;
    songCounterRef.current = 0;
    setSongCounter(0);
    hydratedUserRef.current = userId;
    if (!userId) {
      cloudPrefsReadyRef.current = true;
      setIsHydrated(true);
    }

    return () => {
      cancelled = true;
    };
  }, [isLoaded, userId, clearPendingDjEdits]);

  const applyServerDjSnapshot = useCallback((remotePrefs: NonNullable<ReturnType<typeof normalizeCloudPreferences>>) => {
    const migrated = migrateAccountDjEngine(remotePrefs);
    const remoteAt = migrated.preferencesUpdatedAt ?? 0;
    const localAt = prefsRef.current.preferencesUpdatedAt ?? 0;
    if (remoteAt <= localAt) return;
    if (getDjBroadcastState().isSpeaking) {
      deferredServerPrefsRef.current = migrated;
      return;
    }
    if (migrated.hostRetention) {
      applyHostRetentionFromCloud(migrated.hostRetention);
    }
    setPrefs((prev) => {
      const next = mergeCloudPreferencesOverLocal(prev, migrated);
      prefsRef.current = next;
      loadedBaseRef.current = next;
      return next;
    });
  }, []);

  // Account first. Do not upload this browser until that GET finishes.
  useEffect(() => {
    if (!isLoaded || !userId) return;
    if (hydratedUserRef.current !== userId) return;

    let cancelled = false;

    void (async () => {
      const generation = ++accountLoadGenerationRef.current;
      accountLoadInFlightRef.current = true;
      const remote = await fetchUserSync();
      if (generation !== accountLoadGenerationRef.current) return;
      accountLoadInFlightRef.current = false;
      if (cancelled || hydratedUserRef.current !== userId) return;
      if (!remote) {
        setIsHydrated(true);
        return;
      }

      const normalized = normalizeCloudPreferences(remote.preferences);
      const migrated = normalized ? migrateAccountDjEngine(normalized) : null;
      const base = loadedBaseRef.current ?? prefsRef.current;
      const decision = resolveSignInDjSettings({
        local: base,
        localWasStored: localWasStoredRef.current,
        remote: migrated,
        now: Date.now(),
      });
      const pendingScalar = pendingDjPatchRef.current;
      const pendingStations = { ...pendingStationPatchRef.current };
      const pendingResets = new Set(pendingStationResetRef.current);
      const pendingHostLock = pendingHostLockRef.current;
      const hasStationEdits = Object.keys(pendingStations).length > 0 || pendingResets.size > 0;
      const hasScalarEdits = Boolean(pendingScalar && Object.keys(pendingScalar).length > 0);
      const hasInFlightEdits = hasScalarEdits || hasStationEdits || pendingHostLock;
      clearPendingDjEdits();

      if (decision.apply?.hostRetention && !pendingHostLock) {
        applyHostRetentionFromCloud(decision.apply.hostRetention);
      }

      cloudPrefsReadyRef.current = true;
      setPrefs((prev) => {
        const nextMemory = hasAssignedMemoryPresets(remote.memoryPresets)
          ? normalizeMemoryPresets(remote.memoryPresets)
          : prev.memoryPresets;
        const nextSaved = mergeSavedStationLists(
          remote.savedStations,
          prev.savedStations,
        );
        let next: UserPreferences = {
          ...base,
          playHistory: prev.playHistory,
          likedTracks: prev.likedTracks,
          memoryPresets: nextMemory,
          savedStations: nextSaved,
          userTier: prev.userTier,
        };
        if (decision.apply) {
          next = mergeCloudPreferencesOverLocal(next, decision.apply);
        }
        if (decision.adoptStamp != null) {
          next = { ...next, preferencesUpdatedAt: decision.adoptStamp };
        }
        let stationConfigs = rehydrateStationConfigsFromSync(next.stationConfigs, {
          memoryPresets: nextMemory,
          stationConfigs: remote.stationConfigs,
        });
        if (hasStationEdits) {
          stationConfigs = { ...stationConfigs };
          for (const id of pendingResets) {
            delete stationConfigs[id];
          }
          for (const [id, patch] of Object.entries(pendingStations)) {
            stationConfigs[id] = normalizeStationConfig(id, {
              ...stationConfigs[id],
              ...patch,
            });
          }
        }
        next = {
          ...next,
          stationConfigs,
          ...(pendingScalar ?? {}),
          ...((hasInFlightEdits) ? { preferencesUpdatedAt: Date.now() } : {}),
        };
        prefsRef.current = next;
        loadedBaseRef.current = next;
        return next;
      });
      setIsHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, userId, clearPendingDjEdits, accountLoadNonce]);

  const refreshAccountDjSettings = useCallback(async () => {
    if (!userId) return;
    if (getDjBroadcastState().isSpeaking) {
      deferredDjRefreshRef.current = true;
      return;
    }
    if (!cloudPrefsReadyRef.current) {
      if (!accountLoadInFlightRef.current) {
        setAccountLoadNonce((n) => n + 1);
      }
      return;
    }
    const remote = await fetchUserSync();
    if (!remote || hydratedUserRef.current !== userId) return;
    const normalized = normalizeCloudPreferences(remote.preferences);
    if (!normalized) return;
    applyServerDjSnapshot(normalized);
  }, [userId, applyServerDjSnapshot]);

  useEffect(() => {
    if (!userId) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshAccountDjSettings();
      }
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId, refreshAccountDjSettings]);

  useEffect(() => {
    if (!userId) return;
    return subscribeDjSettingsRefresh(() => {
      void refreshAccountDjSettings();
    });
  }, [userId, refreshAccountDjSettings]);

  useEffect(() => {
    return subscribeDjBroadcast(() => {
      if (getDjBroadcastState().isSpeaking) return;
      const queued = deferredServerPrefsRef.current;
      deferredServerPrefsRef.current = null;
      const wantsPull = deferredDjRefreshRef.current;
      deferredDjRefreshRef.current = false;
      if (queued) {
        applyServerDjSnapshot(queued);
        return;
      }
      if (wantsPull) void refreshAccountDjSettings();
    });
  }, [applyServerDjSnapshot, refreshAccountDjSettings]);

  useEffect(() => {
    setNewerServerPreferencesHandler((remotePrefs) => {
      applyServerDjSnapshot(remotePrefs);
    });
    return () => setNewerServerPreferencesHandler(null);
  }, [applyServerDjSnapshot]);

  useEffect(() => {
    if (!userId) return;
    return subscribeHostRetentionSync(() => {
      if (!cloudPrefsReadyRef.current) {
        pendingHostLockRef.current = true;
        return;
      }
      setPrefs((prev) => {
        const next = { ...prev, preferencesUpdatedAt: Date.now() };
        prefsRef.current = next;
        return next;
      });
    });
  }, [userId]);

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

  // Debounced cloud upsert for Host Studio settings. Play history stays local.
  // The account document is the source of truth: this does not run until the
  // sign-in GET has finished, so a default snapshot cannot land first.
  useEffect(() => {
    if (!isLoaded || !isHydrated || !userId) return;
    if (hydratedUserRef.current !== userId) return;
    if (!cloudPrefsReadyRef.current) return;
    const current = prefsRef.current;
    if (typeof current.preferencesUpdatedAt !== "number") return;
    schedulePreferencesSync(
      buildCloudPreferencesPayload(current, getSessionSnapshot()),
    );
  }, [
    isLoaded,
    isHydrated,
    userId,
    prefs.activePersonaId,
    prefs.preferredVoice,
    prefs.djEngine,
    prefs.djEngineEpoch,
    prefs.commentaryFormat,
    prefs.chatterPacing,
    prefs.alwaysAnnounceSongs,
    prefs.allowExplicit,
    prefs.homeCity,
    prefs.djVolume,
    prefs.stationConfigs,
    prefs.lastStationId,
    prefs.preferencesUpdatedAt,
  ]);

  const commitPrefs = useCallback((prev: UserPreferences, patch: Partial<UserPreferences>) => {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof UserPreferences)[]) {
      if (!Object.is(prev[key], patch[key])) changed = true;
    }
    if (!changed) return prev;
    const touchesDj = Object.keys(patch).some((key) => DJ_STAMP_KEYS.has(key));
    if (touchesDj && userId && !cloudPrefsReadyRef.current) {
      const queuedPatch: Partial<UserPreferences> = {};
      for (const key of Object.keys(patch)) {
        if (DJ_STAMP_KEYS.has(key) && key !== "stationConfigs") {
          (queuedPatch as Record<string, unknown>)[key] = patch[key as keyof UserPreferences];
        }
      }
      if (Object.keys(queuedPatch).length > 0) {
        pendingDjPatchRef.current = { ...(pendingDjPatchRef.current ?? {}), ...queuedPatch };
      }
      const queued = { ...prev, ...patch };
      prefsRef.current = queued;
      return queued;
    }
    const next: UserPreferences = touchesDj
      ? { ...prev, ...patch, preferencesUpdatedAt: Date.now() }
      : { ...prev, ...patch };
    prefsRef.current = next;
    return next;
  }, [userId]);

  const updatePrefs = useCallback((patch: Partial<UserPreferences>) => {
    setPrefs((prev) => commitPrefs(prev, patch));
  }, [commitPrefs]);

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
    if (userId && !cloudPrefsReadyRef.current) {
      pendingStationResetRef.current.add(stationId);
      delete pendingStationPatchRef.current[stationId];
    }
    setPrefs((prev) => commitPrefs(prev, {
      savedStations: prev.savedStations.filter((s) => s.id !== stationId),
      memoryPresets: normalizeMemoryPresets(prev.memoryPresets).map((preset) =>
        preset?.stationId === stationId ? null : preset,
      ),
      stationConfigs: withoutStationConfig(prev.stationConfigs, stationId),
    }));
  }, [commitPrefs, userId]);

  const saveMemoryPreset = useCallback(
    (slot: number, preset: Omit<MemoryPreset, "slot" | "savedAt">, station?: Station) => {
      setPrefs((prev) => {
        const seeds = station ? copyStationSeeds(station) : preset.profile;
        const withProfile: Omit<MemoryPreset, "slot" | "savedAt"> = {
          ...preset,
          ...(seeds && hasBlueprintSeeds(seeds)
            ? { profile: seeds as MemoryPresetProfile }
            : {}),
        };
        const nextPresets = assignMemoryPreset(prev.memoryPresets, slot, withProfile);
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
        // Persist Station Profile JSON (seeds + StationConfig) — not a frozen queue.
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
      if (userId && !cloudPrefsReadyRef.current) {
        pendingStationPatchRef.current = {
          ...pendingStationPatchRef.current,
          [stationId]: { ...pendingStationPatchRef.current[stationId], ...patch },
        };
        pendingStationResetRef.current.delete(stationId);
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
      }
      return commitPrefs(prev, {
        stationConfigs: {
          ...prev.stationConfigs,
          [stationId]: normalizeStationConfig(stationId, {
            ...prev.stationConfigs[stationId],
            ...patch,
          }),
        },
      });
    });
  }, [commitPrefs, userId]);

  const resetStationConfig = useCallback((stationId: string) => {
    setPrefs((prev) => {
      if (userId && !cloudPrefsReadyRef.current) {
        pendingStationResetRef.current.add(stationId);
        delete pendingStationPatchRef.current[stationId];
        const next: UserPreferences = {
          ...prev,
          stationConfigs: withoutStationConfig(prev.stationConfigs, stationId),
        };
        prefsRef.current = next;
        return next;
      }
      return commitPrefs(prev, {
        stationConfigs: withoutStationConfig(prev.stationConfigs, stationId),
      });
    });
  }, [commitPrefs, userId]);

  const clearPersistedVibePrompts = useCallback(() => {
    setPrefs((prev) => {
      const stationConfigs = stripVibePromptsFromStationConfigs(prev.stationConfigs);
      if (stationConfigs === prev.stationConfigs) return prev;
      if (userId && !cloudPrefsReadyRef.current) {
        for (const [id, config] of Object.entries(stationConfigs)) {
          pendingStationPatchRef.current[id] = {
            ...pendingStationPatchRef.current[id],
            ...config,
          };
        }
        const next = { ...prev, stationConfigs };
        prefsRef.current = next;
        return next;
      }
      return commitPrefs(prev, { stationConfigs });
    });
  }, [commitPrefs, userId]);

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
      setDjEngine: (engine) => updatePrefs({ djEngine: resolveDjEngine(engine) }),
      setDjVolume: (volume) => {
        if (typeof volume !== "number" || !Number.isFinite(volume)) return;
        updatePrefs({ djVolume: Math.min(1, Math.max(0, volume)) });
      },
      setHomeCity: (city) => {
        const trimmed = city.trim();
        updatePrefs({ homeCity: trimmed || undefined });
      },
      setAlwaysAnnounceSongs: (always) => updatePrefs({ alwaysAnnounceSongs: always }),
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
      clearPersistedVibePrompts,
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
      clearPersistedVibePrompts,
      setLastStationId,
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

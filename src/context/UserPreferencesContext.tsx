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
import type { VoiceOption } from "@/types/voice";

type UserPreferencesContextValue = UserPreferences & {
  songCounter: number;
  incrementSongCounter: () => number;
  resetSongCounter: () => void;
  setUserTier: (tier: UserTier) => void;
  setPreferredVoice: (voice: VoiceOption) => void;
  setActivePersonaId: (personaId: PersonaId) => void;
  addToPlayHistory: (entry: Omit<PlayHistoryEntry, "playedAt">) => void;
  toggleLikedTrack: (track: Omit<LikedTrack, "likedAt">) => void;
  isTrackLiked: (youtubeId: string) => boolean;
  saveCustomStation: (station: StationDefinition) => void;
  deleteCustomStation: (stationId: string) => void;
};

const UserPreferencesContext = createContext<UserPreferencesContextValue | null>(null);

function storageKey(userId: string | null | undefined) {
  return userId ? `songghost-prefs-${userId}` : "songghost-prefs-guest";
}

function loadPreferences(userId: string | null | undefined): UserPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return DEFAULT_PREFERENCES;
    const stored = JSON.parse(raw) as Partial<UserPreferences>;
    // Pacing is engine-owned, so a value persisted by an older build must not stick.
    // Host ids are remapped rather than trusted: a retired persona would otherwise
    // leave the DJ label blank and send an unknown id to the script and voice APIs.
    return {
      ...DEFAULT_PREFERENCES,
      ...stored,
      djPacingFrequency: DEFAULT_PREFERENCES.djPacingFrequency,
      activePersonaId: resolvePersonaId(stored.activePersonaId),
      savedStations: (Array.isArray(stored.savedStations) ? stored.savedStations : []).map(
        (station) => ({
          ...station,
          defaultPersonaId: resolvePersonaId(station.defaultPersonaId),
        }),
      ),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function savePreferences(userId: string | null | undefined, prefs: UserPreferences) {
  if (typeof window === "undefined") return;
  localStorage.setItem(storageKey(userId), JSON.stringify(prefs));
}

export function UserPreferencesProvider({ children }: { children: ReactNode }) {
  const { userId, isLoaded } = useAuth();
  const [prefs, setPrefs] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [songCounter, setSongCounter] = useState(0);
  const songCounterRef = useRef(0);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;
    setPrefs(loadPreferences(userId));
    songCounterRef.current = 0;
    setSongCounter(0);
    setHydrated(true);
  }, [isLoaded, userId]);

  useEffect(() => {
    if (!hydrated) return;
    savePreferences(userId, prefs);
  }, [prefs, userId, hydrated]);

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

  // Station ids are derived from the name, so re-saving a mix under the same
  // name replaces it in place instead of stacking near-identical dial slots.
  const saveCustomStation = useCallback((station: StationDefinition) => {
    setPrefs((prev) => ({
      ...prev,
      savedStations: [
        station,
        ...prev.savedStations.filter((s) => s.id !== station.id),
      ],
    }));
  }, []);

  const deleteCustomStation = useCallback((stationId: string) => {
    setPrefs((prev) => ({
      ...prev,
      savedStations: prev.savedStations.filter((s) => s.id !== stationId),
    }));
  }, []);

  const value = useMemo<UserPreferencesContextValue>(
    () => ({
      ...prefs,
      songCounter,
      incrementSongCounter,
      resetSongCounter,
      setUserTier: (tier) => updatePrefs({ userTier: tier }),
      setPreferredVoice: (voice) => updatePrefs({ preferredVoice: voice }),
      setActivePersonaId: (personaId) => updatePrefs({ activePersonaId: personaId }),
      addToPlayHistory,
      toggleLikedTrack,
      isTrackLiked,
      saveCustomStation,
      deleteCustomStation,
    }),
    [
      prefs,
      songCounter,
      incrementSongCounter,
      resetSongCounter,
      updatePrefs,
      addToPlayHistory,
      toggleLikedTrack,
      isTrackLiked,
      saveCustomStation,
      deleteCustomStation,
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

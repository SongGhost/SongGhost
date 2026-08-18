"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AppleMusicLoader } from "@/components/auth/AppleMusicLoader";
import type {
  MusicKitInstance,
  MusicKitPlayer,
} from "@/lib/audio/legacy/appleMusicRemote";

type AppleMusicContextValue = {
  /** True once MusicKit JS has loaded and been configured. */
  isReady: boolean;
  isAuthorized: boolean;
  player: MusicKitPlayer | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  play: (trackIds: string[]) => Promise<void>;
  pause: () => Promise<void>;
  /** Set MusicKit volume in the 0–1 range. */
  setVolume: (volume: number) => void;
};

const AppleMusicContext = createContext<AppleMusicContextValue | null>(null);

function getMusicKitInstance(): MusicKitInstance {
  const MusicKit = window.MusicKit;
  if (!MusicKit) {
    throw new Error("MusicKit is not loaded");
  }
  return MusicKit.getInstance();
}

export function AppleMusicProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [player, setPlayer] = useState<MusicKitPlayer | null>(null);

  const syncAuthState = useCallback(() => {
    try {
      const instance = getMusicKitInstance();
      setIsAuthorized(Boolean(instance.isAuthorized));
      setPlayer(instance.player ?? null);
    } catch {
      setIsAuthorized(false);
      setPlayer(null);
    }
  }, []);

  const handleReady = useCallback(() => {
    setIsReady(true);
    syncAuthState();
  }, [syncAuthState]);

  const login = useCallback(async () => {
    const instance = getMusicKitInstance();
    await instance.authorize();
    syncAuthState();
  }, [syncAuthState]);

  const logout = useCallback(async () => {
    const instance = getMusicKitInstance();
    await instance.unauthorize();
    syncAuthState();
  }, [syncAuthState]);

  const play = useCallback(async (trackIds: string[]) => {
    if (trackIds.length === 0) {
      throw new Error("play() requires at least one Apple Music track id");
    }
    const instance = getMusicKitInstance();
    await instance.setQueue({ songs: trackIds });
    await instance.play();
  }, []);

  const pause = useCallback(async () => {
    const instance = getMusicKitInstance();
    await instance.pause();
  }, []);

  const setVolume = useCallback((volume: number) => {
    const instance = getMusicKitInstance();
    const clamped = Math.min(1, Math.max(0, volume));
    instance.volume = clamped;
    if (instance.player && typeof instance.player.volume === "number") {
      instance.player.volume = clamped;
    }
  }, []);

  const value = useMemo<AppleMusicContextValue>(
    () => ({
      isReady,
      isAuthorized,
      player,
      login,
      logout,
      play,
      pause,
      setVolume,
    }),
    [
      isReady,
      isAuthorized,
      player,
      login,
      logout,
      play,
      pause,
      setVolume,
    ],
  );

  return (
    <AppleMusicContext.Provider value={value}>
      <AppleMusicLoader onReady={handleReady} />
      {children}
    </AppleMusicContext.Provider>
  );
}

export function useAppleMusic(): AppleMusicContextValue {
  const ctx = useContext(AppleMusicContext);
  if (!ctx) {
    throw new Error("useAppleMusic must be used within AppleMusicProvider");
  }
  return ctx;
}

"use client";

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
  authorizeAppleMusic,
  getAppleMusicKit,
} from "@/lib/player/appleMusicRemote";
import {
  beginSpotifyAuth,
  captureSpotifyTokensFromUrl,
  clearSpotifyTokens,
  exchangeSpotifyAuthCode,
  loadPkceState,
  loadPkceVerifier,
  loadSpotifyTokens,
  resolveSpotifyRedirectUri,
  resolveSpotifyScopes,
  SPOTIFY_CALLBACK_PATH,
} from "@/lib/player/spotifyRemote";

export type MusicSourceProviderId = "spotify" | "apple_music";

/** Default DJ TTS / voice-break gain (0–1). Midpoint between prior 1.0 and 0.60 levels. */
export const DEFAULT_DJ_VOLUME = 0.85;

type MusicSourceContextValue = {
  activeProvider: MusicSourceProviderId | null;
  /** Switch the current audio transport without running a full reconnect flow. */
  setActiveProvider: (provider: MusicSourceProviderId) => void;
  isConnected: boolean;
  /** True while a connect flow is in progress. */
  isConnecting: boolean;
  connectSpotify: () => Promise<void>;
  connectApple: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Companion DJ voice gain (0–1). Applied to ElevenLabs TTS / voice-break playback. */
  djVolume: number;
  setDjVolume: (volume: number) => void;
};

const MusicSourceContext = createContext<MusicSourceContextValue | null>(null);

const STORAGE_ACTIVE_PROVIDER = "songghost_active_music_provider";
const STORAGE_APPLE_TOKEN = "songghost_apple_music_user_token";
const STORAGE_DJ_VOLUME = "songghost_dj_volume";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function clampDjVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DJ_VOLUME;
  return Math.min(1, Math.max(0, value));
}

function loadDjVolume(): number {
  if (!isBrowser()) return DEFAULT_DJ_VOLUME;
  const raw =
    sessionStorage.getItem(STORAGE_DJ_VOLUME) ??
    localStorage.getItem(STORAGE_DJ_VOLUME);
  if (raw == null) return DEFAULT_DJ_VOLUME;
  const parsed = Number.parseFloat(raw);
  return clampDjVolume(parsed);
}

function persistDjVolume(volume: number): void {
  if (!isBrowser()) return;
  const next = String(clampDjVolume(volume));
  localStorage.setItem(STORAGE_DJ_VOLUME, next);
  sessionStorage.setItem(STORAGE_DJ_VOLUME, next);
}

/** Migrate legacy `"apple"` storage values to `"apple_music"`. */
function coerceProviderId(raw: string | null): MusicSourceProviderId | null {
  if (raw === "spotify" || raw === "apple_music") return raw;
  if (raw === "apple") return "apple_music";
  return null;
}

function persistActiveProvider(provider: MusicSourceProviderId | null): void {
  if (!isBrowser()) return;
  if (provider) {
    localStorage.setItem(STORAGE_ACTIVE_PROVIDER, provider);
    sessionStorage.setItem(STORAGE_ACTIVE_PROVIDER, provider);
  } else {
    localStorage.removeItem(STORAGE_ACTIVE_PROVIDER);
    sessionStorage.removeItem(STORAGE_ACTIVE_PROVIDER);
  }
}

function saveAppleUserToken(token: string): void {
  if (!isBrowser()) return;
  localStorage.setItem(STORAGE_APPLE_TOKEN, token);
  sessionStorage.setItem(STORAGE_APPLE_TOKEN, token);
}

function clearAppleUserToken(): void {
  if (!isBrowser()) return;
  localStorage.removeItem(STORAGE_APPLE_TOKEN);
  sessionStorage.removeItem(STORAGE_APPLE_TOKEN);
}

function loadAppleUserToken(): string | null {
  if (!isBrowser()) return null;
  return (
    sessionStorage.getItem(STORAGE_APPLE_TOKEN) ??
    localStorage.getItem(STORAGE_APPLE_TOKEN)
  );
}

/** Spotify session is usable when a valid access token is already stored. */
function hasSpotifySession(): boolean {
  const tokens = loadSpotifyTokens();
  return Boolean(tokens?.accessToken);
}

async function hasAppleSession(): Promise<boolean> {
  if (loadAppleUserToken()) return true;

  try {
    const kit = await getAppleMusicKit();
    if (kit.isAuthorized) {
      if (kit.musicUserToken) {
        saveAppleUserToken(kit.musicUserToken);
      }
      return true;
    }
  } catch {
    // Developer token missing or MusicKit unavailable — treat as disconnected.
  }

  return false;
}

/**
 * Strip leftover OAuth callback params from the address bar without a reload.
 * Spotify token capture already removes provider-specific query keys.
 */
function purgeOAuthCallbackParams(): void {
  if (!isBrowser()) return;

  const parsed = new URL(window.location.href);
  let dirty = false;

  for (const key of [
    "code",
    "state",
    "spotify_auth",
    "spotify_error",
    "spotify_access_token",
    "spotify_refresh_token",
    "spotify_expires_in",
  ]) {
    if (parsed.searchParams.has(key)) {
      parsed.searchParams.delete(key);
      dirty = true;
    }
  }

  if (!dirty) return;

  const next = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  window.history.replaceState({}, "", next);
}

/**
 * Complete Authorization Code + PKCE when the callback handed `?code=` back
 * to the client (cookie/state missing on the server).
 *
 * The PKCE verifier is only cleared inside `exchangeSpotifyAuthCode` after a
 * successful token response — never before the request.
 */
async function completeSpotifyPkceFromUrl(): Promise<boolean> {
  if (!isBrowser()) return false;

  const parsed = new URL(window.location.href);
  const code = parsed.searchParams.get("code");
  if (!code) return false;

  // localStorage → sessionStorage → cookie; never throws on a missing key.
  const verifier = loadPkceVerifier();
  if (!verifier) {
    console.warn(
      "[SongGhost] Spotify PKCE verifier was not found. Clearing the callback URL — click Connect to Spotify to try again.",
    );
    purgeOAuthCallbackParams();
    return false;
  }

  const expectedState = loadPkceState();
  const returnedState = parsed.searchParams.get("state");
  if (expectedState && returnedState && expectedState !== returnedState) {
    console.warn(
      "[SongGhost] Spotify OAuth state mismatch. Clearing the callback URL — click Connect to Spotify to try again.",
    );
    purgeOAuthCallbackParams();
    return false;
  }

  // Same redirect_uri resolution as beginSpotifyAuth (env → window origin fallback).
  const redirectUri =
    process.env.NEXT_PUBLIC_SPOTIFY_REDIRECT_URI?.trim() ||
    (typeof window !== "undefined"
      ? `${window.location.origin}${SPOTIFY_CALLBACK_PATH}`
      : resolveSpotifyRedirectUri());

  try {
    await exchangeSpotifyAuthCode({
      code,
      codeVerifier: verifier,
      clientId: process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID?.trim(),
      redirectUri,
    });
    purgeOAuthCallbackParams();
    return true;
  } catch (error) {
    console.warn(
      "[SongGhost] Spotify client token exchange failed. You can click Connect to Spotify again.",
      error,
    );
    // Keep the verifier so a retry can reuse it if Spotify still accepts the code.
    purgeOAuthCallbackParams();
    return false;
  }
}

async function unauthorizeAppleMusic(): Promise<void> {
  try {
    const kit = await getAppleMusicKit();
    if (kit.isAuthorized) {
      await kit.unauthorize();
    }
  } catch {
    // Best-effort — local tokens are cleared regardless.
  }
}

export function MusicSourceProvider({ children }: { children: ReactNode }) {
  const [activeProvider, setActiveProviderState] =
    useState<MusicSourceProviderId | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [djVolume, setDjVolumeState] = useState(DEFAULT_DJ_VOLUME);
  const hydratedRef = useRef(false);
  const djVolumeHydratedRef = useRef(false);

  const setActiveProvider = useCallback((provider: MusicSourceProviderId) => {
    setActiveProviderState(provider);
    persistActiveProvider(provider);
  }, []);

  const setDjVolume = useCallback((volume: number) => {
    const next = clampDjVolume(volume);
    setDjVolumeState(next);
    persistDjVolume(next);
  }, []);

  useEffect(() => {
    if (djVolumeHydratedRef.current) return;
    djVolumeHydratedRef.current = true;
    setDjVolumeState(loadDjVolume());
  }, []);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    let cancelled = false;

    const hydrate = async () => {
      // 1) Client PKCE fallback (?code=…) when the server could not verify cookies.
      // 2) Server success redirect (?spotify_access_token=…).
      const exchangedFromCode = await completeSpotifyPkceFromUrl();
      if (cancelled) return;

      const capturedFromUrl = captureSpotifyTokensFromUrl();
      purgeOAuthCallbackParams();

      const spotifyReady =
        exchangedFromCode || capturedFromUrl || hasSpotifySession();
      if (spotifyReady) {
        // Prefer Spotify immediately so the modal shows CONNECTED with a green badge.
        if (!cancelled) {
          setActiveProvider("spotify");
        }
        return;
      }

      const appleReady = await hasAppleSession();
      if (cancelled) return;

      if (appleReady) {
        setActiveProvider("apple_music");
        return;
      }

      // Migrate any legacy persisted value, then clear if no session.
      const stored = coerceProviderId(
        sessionStorage.getItem(STORAGE_ACTIVE_PROVIDER) ??
          localStorage.getItem(STORAGE_ACTIVE_PROVIDER),
      );
      if (stored === "spotify" && hasSpotifySession()) {
        setActiveProvider("spotify");
        return;
      }
      if (stored === "apple_music" && (await hasAppleSession())) {
        if (!cancelled) setActiveProvider("apple_music");
        return;
      }

      setActiveProviderState(null);
      persistActiveProvider(null);
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, [setActiveProvider]);

  const disconnectProvider = useCallback(async (provider: MusicSourceProviderId) => {
    if (provider === "spotify") {
      clearSpotifyTokens();
    } else {
      clearAppleUserToken();
      await unauthorizeAppleMusic();
    }
  }, []);

  const disconnect = useCallback(async () => {
    const current = activeProvider;
    if (!current) return;

    setIsConnecting(true);
    try {
      await disconnectProvider(current);
      setActiveProviderState(null);
      persistActiveProvider(null);
    } finally {
      setIsConnecting(false);
    }
  }, [activeProvider, disconnectProvider]);

  const connectSpotify = useCallback(async () => {
    if (isConnecting) return;
    setIsConnecting(true);

    try {
      if (activeProvider === "apple_music") {
        await disconnectProvider("apple_music");
        setActiveProviderState(null);
        persistActiveProvider(null);
      }

      // Persist intent before the OAuth redirect so hydrate restores Spotify.
      persistActiveProvider("spotify");

      // Explicit client-side env resolution for authorize URL generation.
      const clientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID?.trim() ?? "";
      const redirectUri =
        process.env.NEXT_PUBLIC_SPOTIFY_REDIRECT_URI?.trim() ||
        (typeof window !== "undefined"
          ? `${window.location.origin}${SPOTIFY_CALLBACK_PATH}`
          : "");
      const scopes = resolveSpotifyScopes();

      const authorizeUrl = await beginSpotifyAuth({
        clientId,
        redirectUri,
        scopes,
      });
      console.log("[Spotify Auth Debug]", {
        hasClientId: !!clientId,
        clientIdPrefix: clientId ? clientId.substring(0, 5) + "..." : "MISSING",
        redirectUri,
        scopes,
        constructedUrl: authorizeUrl,
      });
      window.location.href = authorizeUrl;
    } catch (error) {
      console.error("[SongGhost] Spotify connect failed:", error);
      setIsConnecting(false);
      throw error;
    }
  }, [activeProvider, disconnectProvider, isConnecting]);

  const connectApple = useCallback(async () => {
    if (isConnecting) return;
    setIsConnecting(true);

    try {
      if (activeProvider === "spotify") {
        await disconnectProvider("spotify");
        setActiveProviderState(null);
        persistActiveProvider(null);
      }

      const token = await authorizeAppleMusic();
      saveAppleUserToken(token);
      setActiveProvider("apple_music");
    } catch (error) {
      console.error("[SongGhost] Apple Music connect failed:", error);
      throw error;
    } finally {
      setIsConnecting(false);
    }
  }, [activeProvider, disconnectProvider, isConnecting, setActiveProvider]);

  const value = useMemo<MusicSourceContextValue>(
    () => ({
      activeProvider,
      setActiveProvider,
      isConnected: activeProvider !== null,
      isConnecting,
      connectSpotify,
      connectApple,
      disconnect,
      djVolume,
      setDjVolume,
    }),
    [
      activeProvider,
      setActiveProvider,
      isConnecting,
      connectSpotify,
      connectApple,
      disconnect,
      djVolume,
      setDjVolume,
    ],
  );

  return (
    <MusicSourceContext.Provider value={value}>{children}</MusicSourceContext.Provider>
  );
}

export function useMusicSource(): MusicSourceContextValue {
  const ctx = useContext(MusicSourceContext);
  if (!ctx) {
    throw new Error("useMusicSource must be used within MusicSourceProvider");
  }
  return ctx;
}

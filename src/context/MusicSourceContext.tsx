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
  SPOTIFY_AUTH_INIT_PATH,
  SPOTIFY_CALLBACK_PATH,
} from "@/lib/player/spotifyRemote";
import { useDjVolume } from "@/hooks/useDjVolume";

export type MusicSourceProviderId = "spotify" | "apple_music";

/** Re-export so existing imports keep working. */
export { DEFAULT_DJ_VOLUME } from "@/hooks/useDjVolume";

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
  /** True after DJ volume has been restored from localStorage. */
  djVolumeReady: boolean;
};

const MusicSourceContext = createContext<MusicSourceContextValue | null>(null);

const STORAGE_ACTIVE_PROVIDER = "songhost_active_music_provider";
const LEGACY_STORAGE_ACTIVE_PROVIDER = "songghost_active_music_provider";
const STORAGE_APPLE_TOKEN = "songhost_apple_music_user_token";
const LEGACY_STORAGE_APPLE_TOKEN = "songghost_apple_music_user_token";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/** Migrate legacy `"apple"` storage values to `"apple_music"`. */
function coerceProviderId(raw: string | null): MusicSourceProviderId | null {
  if (raw === "spotify" || raw === "apple_music") return raw;
  if (raw === "apple") return "apple_music";
  return null;
}

function removeStoragePair(canonical: string, legacy: string): void {
  for (const key of [canonical, legacy]) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }
}

function readMigratingDualStorage(canonical: string, legacy: string): string | null {
  const existing =
    sessionStorage.getItem(canonical) ?? localStorage.getItem(canonical);
  if (existing != null) return existing;
  const fromLegacy =
    sessionStorage.getItem(legacy) ?? localStorage.getItem(legacy);
  if (fromLegacy == null) return null;
  localStorage.setItem(canonical, fromLegacy);
  sessionStorage.setItem(canonical, fromLegacy);
  return fromLegacy;
}

function persistActiveProvider(provider: MusicSourceProviderId | null): void {
  if (!isBrowser()) return;
  if (provider) {
    localStorage.setItem(STORAGE_ACTIVE_PROVIDER, provider);
    sessionStorage.setItem(STORAGE_ACTIVE_PROVIDER, provider);
  } else {
    removeStoragePair(STORAGE_ACTIVE_PROVIDER, LEGACY_STORAGE_ACTIVE_PROVIDER);
  }
}

function saveAppleUserToken(token: string): void {
  if (!isBrowser()) return;
  localStorage.setItem(STORAGE_APPLE_TOKEN, token);
  sessionStorage.setItem(STORAGE_APPLE_TOKEN, token);
}

function clearAppleUserToken(): void {
  if (!isBrowser()) return;
  removeStoragePair(STORAGE_APPLE_TOKEN, LEGACY_STORAGE_APPLE_TOKEN);
}

function loadAppleUserToken(): string | null {
  if (!isBrowser()) return null;
  return readMigratingDualStorage(STORAGE_APPLE_TOKEN, LEGACY_STORAGE_APPLE_TOKEN);
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

/** Map callback `spotify_error` codes to a listener-facing sentence. */
function formatSpotifyOAuthError(code: string): string {
  switch (code) {
    case "access_denied":
      return "Spotify access was denied. Connect again to continue.";
    case "missing_code":
      return "Spotify did not return an authorization code. Try connecting again.";
    case "missing_cookies":
      return "Spotify sign-in expired. Please try connecting again.";
    case "invalid_state":
      return "Spotify sign-in could not be verified. Try connecting again.";
    case "missing_client_id":
      return "Spotify is not configured. Check the app environment.";
    case "missing_scopes":
    case "pkce_challenge_failed":
      return "Couldn't start Spotify sign-in. Try connecting again.";
    case "token_exchange_failed":
    case "token_exchange_error":
      return "Couldn't finish connecting to Spotify. Try again.";
    case "incomplete_token_response":
      return "Spotify returned an incomplete login. Try connecting again.";
    default:
      return `Spotify connection failed (${code}). Try connecting again.`;
  }
}

function readSpotifyOAuthErrorFromUrl(): string | null {
  if (!isBrowser()) return null;
  return new URL(window.location.href).searchParams.get("spotify_error");
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
      "[SongHost] Spotify PKCE verifier was not found. Clearing the callback URL — click Connect to Spotify to try again.",
    );
    purgeOAuthCallbackParams();
    return false;
  }

  const expectedState = loadPkceState();
  const returnedState = parsed.searchParams.get("state");
  if (expectedState && returnedState && expectedState !== returnedState) {
    console.warn(
      "[SongHost] Spotify OAuth state mismatch. Clearing the callback URL — click Connect to Spotify to try again.",
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
      "[SongHost] Spotify client token exchange failed. You can click Connect to Spotify again.",
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
  const [spotifyOAuthError, setSpotifyOAuthError] = useState<string | null>(null);
  const { djVolume, setDjVolume, djVolumeReady } = useDjVolume();
  const hydratedRef = useRef(false);

  const setActiveProvider = useCallback((provider: MusicSourceProviderId) => {
    setActiveProviderState(provider);
    persistActiveProvider(provider);
  }, []);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    let cancelled = false;

    const hydrate = async () => {
      // Surface callback failures before stripping query params.
      const oauthErrorCode = readSpotifyOAuthErrorFromUrl();
      if (oauthErrorCode) {
        setSpotifyOAuthError(formatSpotifyOAuthError(oauthErrorCode));
      }

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
        readMigratingDualStorage(
          STORAGE_ACTIVE_PROVIDER,
          LEGACY_STORAGE_ACTIVE_PROVIDER,
        ),
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

  useEffect(() => {
    if (!spotifyOAuthError) return;
    const id = window.setTimeout(() => setSpotifyOAuthError(null), 8000);
    return () => window.clearTimeout(id);
  }, [spotifyOAuthError]);

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
    setSpotifyOAuthError(null);

    try {
      if (activeProvider === "apple_music") {
        await disconnectProvider("apple_music");
        setActiveProviderState(null);
        persistActiveProvider(null);
      }

      // Drop stale / invalid tokens so a new OAuth session cannot be masked.
      clearSpotifyTokens();

      // Persist intent before the OAuth redirect so hydrate restores Spotify.
      persistActiveProvider("spotify");

      const initUrl = await beginSpotifyAuth();
      console.log("[Spotify Auth Debug]", {
        initPath: SPOTIFY_AUTH_INIT_PATH,
        constructedUrl: initUrl,
      });
      window.location.assign(initUrl);
    } catch (error) {
      console.error("[SongHost] Spotify connect failed:", error);
      setSpotifyOAuthError(
        error instanceof Error
          ? error.message
          : "Couldn't start Spotify sign-in. Try connecting again.",
      );
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
      console.error("[SongHost] Apple Music connect failed:", error);
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
      djVolumeReady,
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
      djVolumeReady,
    ],
  );

  return (
    <MusicSourceContext.Provider value={value}>
      {spotifyOAuthError ? (
        <div
          role="alert"
          className="pointer-events-auto fixed left-1/2 top-4 z-[110] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 rounded-md border border-amber-700/50 bg-zinc-950/95 px-4 py-3 font-sans text-sm text-amber-100 shadow-lg backdrop-blur-sm"
        >
          <p>{spotifyOAuthError}</p>
          <button
            type="button"
            onClick={() => setSpotifyOAuthError(null)}
            className="mt-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-amber-200/80 hover:text-amber-50"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {children}
    </MusicSourceContext.Provider>
  );
}

export function useMusicSource(): MusicSourceContextValue {
  const ctx = useContext(MusicSourceContext);
  if (!ctx) {
    throw new Error("useMusicSource must be used within MusicSourceProvider");
  }
  return ctx;
}

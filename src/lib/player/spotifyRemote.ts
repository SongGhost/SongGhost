/**
 * Spotify remote companion controller — Authorization Code + PKCE token helpers
 * and Web API playback commands for the Pause–Talk–Play orchestrator.
 *
 * Tokens live in browser sessionStorage / localStorage. The PKCE verifier is
 * mirrored into a short-lived cookie so `/api/auth/spotify/callback` can finish
 * the code exchange on the server.
 */

export type SpotifyTrack = {
  id: string;
  uri: string;
  name: string;
  artists: string[];
  album?: string;
  albumArtUrl?: string;
  durationMs?: number;
  isPlaying: boolean;
  progressMs?: number;
};

/** Structured failure when Spotify has no open client to command. */
export type SpotifyNoActiveDevice = {
  success: false;
  reason: "NO_ACTIVE_DEVICE";
};

export type SpotifyPlaybackResult = boolean | SpotifyNoActiveDevice;

export type SpotifyTokenSet = {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
};

const SPOTIFY_AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_BASE = "https://api.spotify.com/v1";

const STORAGE_ACCESS = "songghost_spotify_access_token";
const STORAGE_REFRESH = "songghost_spotify_refresh_token";
const STORAGE_EXPIRES = "songghost_spotify_token_expires_at";
const STORAGE_VERIFIER = "songghost_spotify_code_verifier";
const STORAGE_STATE = "songghost_spotify_oauth_state";

/** Cookie read by the server callback during PKCE code exchange. */
export const SPOTIFY_PKCE_VERIFIER_COOKIE = "sg_spotify_pkce_verifier";
export const SPOTIFY_OAUTH_STATE_COOKIE = "sg_spotify_oauth_state";

const DEFAULT_SCOPES = [
  "user-read-currently-playing",
  "user-read-playback-state",
  "user-modify-playback-state",
].join(" ");

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function getClientId(): string {
  const clientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID?.trim();
  if (!clientId) {
    throw new Error("NEXT_PUBLIC_SPOTIFY_CLIENT_ID is not configured");
  }
  return clientId;
}

function getRedirectUri(): string {
  const configured = process.env.NEXT_PUBLIC_SPOTIFY_REDIRECT_URI?.trim();
  if (configured) return configured;
  if (!isBrowser()) {
    throw new Error("NEXT_PUBLIC_SPOTIFY_REDIRECT_URI is not configured");
  }
  return `${window.location.origin}/api/auth/spotify/callback`;
}

function generateRandomString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const data = new TextEncoder().encode(plain);
  return crypto.subtle.digest("SHA-256", data);
}

/** Create a PKCE code_verifier (43–128 chars). */
export function createCodeVerifier(length = 64): string {
  const safeLength = Math.min(128, Math.max(43, length));
  return generateRandomString(safeLength);
}

/** Derive S256 code_challenge from a verifier. */
export async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await sha256(verifier);
  return base64UrlEncode(digest);
}

function setCookie(name: string, value: string, maxAgeSeconds: number): void {
  if (!isBrowser()) return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}`;
}

function clearCookie(name: string): void {
  if (!isBrowser()) return;
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/** Persist PKCE verifier + OAuth state for the authorize → callback round-trip. */
export function storePkceSession(verifier: string, state: string): void {
  if (!isBrowser()) return;
  sessionStorage.setItem(STORAGE_VERIFIER, verifier);
  sessionStorage.setItem(STORAGE_STATE, state);
  // Server callback needs the verifier; keep it short-lived.
  setCookie(SPOTIFY_PKCE_VERIFIER_COOKIE, verifier, 600);
  setCookie(SPOTIFY_OAUTH_STATE_COOKIE, state, 600);
}

export function clearPkceSession(): void {
  if (!isBrowser()) return;
  sessionStorage.removeItem(STORAGE_VERIFIER);
  sessionStorage.removeItem(STORAGE_STATE);
  clearCookie(SPOTIFY_PKCE_VERIFIER_COOKIE);
  clearCookie(SPOTIFY_OAUTH_STATE_COOKIE);
}

export function saveSpotifyTokens(tokens: SpotifyTokenSet): void {
  if (!isBrowser()) return;
  localStorage.setItem(STORAGE_ACCESS, tokens.accessToken);
  localStorage.setItem(STORAGE_REFRESH, tokens.refreshToken);
  localStorage.setItem(STORAGE_EXPIRES, String(tokens.expiresAt));
  sessionStorage.setItem(STORAGE_ACCESS, tokens.accessToken);
  sessionStorage.setItem(STORAGE_REFRESH, tokens.refreshToken);
  sessionStorage.setItem(STORAGE_EXPIRES, String(tokens.expiresAt));
}

export function clearSpotifyTokens(): void {
  if (!isBrowser()) return;
  for (const key of [STORAGE_ACCESS, STORAGE_REFRESH, STORAGE_EXPIRES]) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }
}

export function loadSpotifyTokens(): SpotifyTokenSet | null {
  if (!isBrowser()) return null;

  const accessToken =
    sessionStorage.getItem(STORAGE_ACCESS) ?? localStorage.getItem(STORAGE_ACCESS);
  const refreshToken =
    sessionStorage.getItem(STORAGE_REFRESH) ?? localStorage.getItem(STORAGE_REFRESH);
  const expiresRaw =
    sessionStorage.getItem(STORAGE_EXPIRES) ?? localStorage.getItem(STORAGE_EXPIRES);

  if (!accessToken || !refreshToken || !expiresRaw) return null;

  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt)) return null;

  return { accessToken, refreshToken, expiresAt };
}

/**
 * Build the Spotify authorize URL and stash PKCE material for the callback.
 * Caller should navigate to the returned URL (`window.location.assign`).
 */
export async function beginSpotifyAuth(options?: {
  scopes?: string;
  clientId?: string;
  redirectUri?: string;
}): Promise<string> {
  if (!isBrowser()) {
    throw new Error("beginSpotifyAuth must run in the browser");
  }

  const clientId = options?.clientId ?? getClientId();
  const redirectUri = options?.redirectUri ?? getRedirectUri();
  const scopes = options?.scopes ?? DEFAULT_SCOPES;

  const verifier = createCodeVerifier();
  const challenge = await createCodeChallenge(verifier);
  const state = generateRandomString(32);
  storePkceSession(verifier, state);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: scopes,
    state,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });

  return `${SPOTIFY_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Exchange an authorization code for tokens (browser-side fallback).
 * Prefer the server callback route; this exists for tests / SPA recovery.
 */
export async function exchangeSpotifyAuthCode(input: {
  code: string;
  codeVerifier: string;
  clientId?: string;
  redirectUri?: string;
}): Promise<SpotifyTokenSet> {
  const clientId = input.clientId ?? getClientId();
  const redirectUri = input.redirectUri ?? getRedirectUri();

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: input.codeVerifier,
  });

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Spotify token exchange failed (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  const existing = loadSpotifyTokens();
  const tokens: SpotifyTokenSet = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? existing?.refreshToken ?? "",
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  if (!tokens.refreshToken) {
    throw new Error("Spotify token response missing refresh_token");
  }

  saveSpotifyTokens(tokens);
  clearPkceSession();
  return tokens;
}

/** Refresh the access token using the stored refresh token. */
export async function refreshSpotifyAccessToken(
  refreshToken?: string,
  clientId?: string,
): Promise<SpotifyTokenSet> {
  const stored = loadSpotifyTokens();
  const token = refreshToken ?? stored?.refreshToken;
  if (!token) {
    throw new Error("No Spotify refresh token available");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: token,
    client_id: clientId ?? getClientId(),
  });

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Spotify token refresh failed (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  const tokens: SpotifyTokenSet = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  saveSpotifyTokens(tokens);
  return tokens;
}

/**
 * Return a valid access token, refreshing when within 60s of expiry.
 */
export async function getValidSpotifyAccessToken(): Promise<string | null> {
  const stored = loadSpotifyTokens();
  if (!stored) return null;

  if (stored.expiresAt > Date.now() + 60_000) {
    return stored.accessToken;
  }

  try {
    const refreshed = await refreshSpotifyAccessToken(stored.refreshToken);
    return refreshed.accessToken;
  } catch {
    clearSpotifyTokens();
    return null;
  }
}

/**
 * Pull tokens out of a dashboard redirect (`?spotify_access_token=…`) and
 * persist them locally. Returns true when tokens were captured.
 */
export function captureSpotifyTokensFromUrl(
  url: string | URL = typeof window !== "undefined" ? window.location.href : "",
): boolean {
  if (!url || !isBrowser()) return false;

  const parsed = typeof url === "string" ? new URL(url, window.location.origin) : url;
  const accessToken = parsed.searchParams.get("spotify_access_token");
  const refreshToken = parsed.searchParams.get("spotify_refresh_token");
  const expiresIn = Number(parsed.searchParams.get("spotify_expires_in") ?? "3600");

  if (!accessToken || !refreshToken) return false;

  saveSpotifyTokens({
    accessToken,
    refreshToken,
    expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000,
  });
  clearPkceSession();

  // Strip secrets from the address bar.
  parsed.searchParams.delete("spotify_access_token");
  parsed.searchParams.delete("spotify_refresh_token");
  parsed.searchParams.delete("spotify_expires_in");
  parsed.searchParams.delete("spotify_auth");
  window.history.replaceState({}, "", `${parsed.pathname}${parsed.search}${parsed.hash}`);
  return true;
}

function isNoActiveDeviceResult(value: unknown): value is SpotifyNoActiveDevice {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    (value as SpotifyNoActiveDevice).success === false &&
    (value as SpotifyNoActiveDevice).reason === "NO_ACTIVE_DEVICE"
  );
}

async function spotifyPlayerCommand(
  method: "POST" | "PUT",
  path: string,
  accessToken: string,
): Promise<SpotifyPlaybackResult> {
  const response = await fetch(`${SPOTIFY_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  // Spotify returns 204 on success; 404 when nothing is active.
  if (response.status === 204 || response.ok) {
    return true;
  }

  if (response.status === 404) {
    return { success: false, reason: "NO_ACTIVE_DEVICE" };
  }

  return false;
}

/**
 * Pause the listener's active Spotify device.
 * Returns `true` on success, `false` on generic failure, or
 * `{ success: false, reason: "NO_ACTIVE_DEVICE" }` when no device is open.
 *
 * Uses POST per companion-controller contract; falls back to Spotify's
 * documented PUT if the gateway rejects POST.
 */
export async function pauseSpotifyPlayback(
  accessToken: string,
): Promise<SpotifyPlaybackResult> {
  const postResult = await spotifyPlayerCommand("POST", "/me/player/pause", accessToken);
  if (postResult === true || isNoActiveDeviceResult(postResult)) {
    return postResult;
  }
  return spotifyPlayerCommand("PUT", "/me/player/pause", accessToken);
}

/** Resume / start playback on the listener's active Spotify device. */
export async function resumeSpotifyPlayback(
  accessToken: string,
): Promise<SpotifyPlaybackResult> {
  return spotifyPlayerCommand("PUT", "/me/player/play", accessToken);
}

type SpotifyCurrentlyPlayingPayload = {
  is_playing?: boolean;
  progress_ms?: number;
  item?: {
    id?: string;
    uri?: string;
    name?: string;
    duration_ms?: number;
    artists?: Array<{ name?: string }>;
    album?: {
      name?: string;
      images?: Array<{ url?: string }>;
    };
  } | null;
};

/** Read the track currently playing on the listener's Spotify account. */
export async function getCurrentlyPlaying(
  accessToken: string,
): Promise<SpotifyTrack | null> {
  const response = await fetch(`${SPOTIFY_API_BASE}/me/player/currently-playing`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 204 || response.status === 404) {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as SpotifyCurrentlyPlayingPayload;
  const item = data.item;
  if (!item?.id || !item.name) {
    return null;
  }

  return {
    id: item.id,
    uri: item.uri ?? `spotify:track:${item.id}`,
    name: item.name,
    artists: (item.artists ?? [])
      .map((artist) => artist.name?.trim() ?? "")
      .filter(Boolean),
    album: item.album?.name,
    albumArtUrl: item.album?.images?.[0]?.url,
    durationMs: item.duration_ms,
    isPlaying: Boolean(data.is_playing),
    progressMs: data.progress_ms,
  };
}

export { isNoActiveDeviceResult };

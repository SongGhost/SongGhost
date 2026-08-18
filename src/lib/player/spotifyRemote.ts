/**
 * Spotify remote companion controller — Authorization Code + PKCE token helpers
 * and Web API playback commands for the Duck–Talk–Swell orchestrator.
 *
 * OAuth initiation is server-owned: `GET /api/auth/spotify` generates PKCE
 * `state` + `code_verifier` and sets HttpOnly cookies (`sg_spotify_oauth_state`,
 * `sg_spotify_pkce_verifier`) before 302ing to Spotify. The callback at
 * `/api/auth/spotify/callback` reads those cookies for token exchange.
 * Access tokens still persist in localStorage / sessionStorage after success.
 */

import {
  fetchSpotifyGetWithRetry,
  isSpotifyCircuitOpen,
} from "@/lib/spotify/fetchWithRetry";

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
  /** Original requested catalog id when Spotify relinked the playable track. */
  linkedFromId?: string | null;
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

export const SPOTIFY_AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_BASE = "https://api.spotify.com/v1";

const STORAGE_ACCESS = "songhost_spotify_access_token";
const STORAGE_REFRESH = "songhost_spotify_refresh_token";
const STORAGE_EXPIRES = "songhost_spotify_token_expires_at";
const LEGACY_STORAGE_ACCESS = "songghost_spotify_access_token";
const LEGACY_STORAGE_REFRESH = "songghost_spotify_refresh_token";
const LEGACY_STORAGE_EXPIRES = "songghost_spotify_token_expires_at";
/** PKCE verifier — localStorage so callback recovery survives cookie loss. */
export const STORAGE_VERIFIER = "spotify_code_verifier";
/** OAuth CSRF state — localStorage (same durability as the verifier). */
export const STORAGE_STATE = "spotify_auth_state";

/** Cookie read by the server callback during PKCE code exchange. */
export const SPOTIFY_PKCE_VERIFIER_COOKIE = "sg_spotify_pkce_verifier";
export const SPOTIFY_OAUTH_STATE_COOKIE = "sg_spotify_oauth_state";

/** Canonical OAuth callback path — never the reversed `/api/auth/callback/spotify`. */
export const SPOTIFY_CALLBACK_PATH = "/api/auth/spotify/callback";

/**
 * Server-side OAuth initiation path. Sets HttpOnly PKCE cookies then 302s
 * to Spotify authorize. All client connect flows MUST navigate here.
 */
export const SPOTIFY_AUTH_INIT_PATH = "/api/auth/spotify";

/** PKCE cookie lifetime (15 minutes) — long enough for mobile OAuth round-trips. */
export const SPOTIFY_PKCE_COOKIE_MAX_AGE = 900;

/**
 * Local-dev URI registered in the Spotify Developer Dashboard.
 * Spotify OAuth forbids the hostname `localhost` — always use `127.0.0.1`.
 */
export const SPOTIFY_DEFAULT_REDIRECT_URI =
  `http://127.0.0.1:3000${SPOTIFY_CALLBACK_PATH}`;

const REVERSED_CALLBACK_PATH = "/api/auth/callback/spotify";

/**
 * Scopes the Web Playback SDK's `check_scope` requires. Omitting
 * `user-read-private` / `user-read-email` yields a 403 even when `streaming`
 * is present. `user-modify-playback-state` is required for volume ducking.
 */
const REQUIRED_SCOPES = [
  "streaming",
  "user-modify-playback-state",
  "user-read-private",
  "user-read-email",
] as const;

const DEFAULT_SCOPES = [
  "streaming",
  "user-read-currently-playing",
  "user-read-playback-state",
  "user-top-read",
  "user-modify-playback-state",
  "user-read-private",
  "user-read-email",
].join(" ");

/**
 * Resolve authorize scopes from `NEXT_PUBLIC_SPOTIFY_SCOPES` (space/comma
 * separated) or the built-in defaults. Always guarantees `streaming`,
 * `user-modify-playback-state`, `user-read-private`, and `user-read-email`
 * (Web Playback SDK `check_scope` 403 without the private/email pair).
 */
export function resolveSpotifyScopes(override?: string): string {
  const fromEnv = process.env.NEXT_PUBLIC_SPOTIFY_SCOPES?.trim();
  const raw = (override?.trim() || fromEnv || DEFAULT_SCOPES).trim();
  const parts = raw
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  for (const required of REQUIRED_SCOPES) {
    if (!parts.includes(required)) {
      console.warn(
        `[SpotifyRemote] ${required} missing from scopes; appending it`,
      );
      parts.push(required);
    }
  }
  return parts.join(" ");
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/** Explicit client-side read of `NEXT_PUBLIC_SPOTIFY_CLIENT_ID`. */
export function getSpotifyClientId(): string {
  const clientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID?.trim() ?? "";
  if (!clientId) {
    throw new Error("NEXT_PUBLIC_SPOTIFY_CLIENT_ID is not configured");
  }
  return clientId;
}

/** @deprecated Prefer {@link getSpotifyClientId}. */
function getClientId(): string {
  return getSpotifyClientId();
}

/**
 * Loopback hosts that must never appear in a Spotify `redirect_uri`.
 * Spotify OAuth rejects `localhost` (and IPv6 loopback) outright.
 */
function isLocalDevelopmentHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/**
 * Force the canonical callback path. Corrects the common NextAuth-style reverse
 * (`/api/auth/callback/spotify` → `/api/auth/spotify/callback`).
 *
 * **Redirect URI invariant:** local development always emits
 * {@link SPOTIFY_DEFAULT_REDIRECT_URI} (`http://127.0.0.1:3000/api/auth/spotify/callback`).
 * `localhost` is rewritten — never forwarded to Spotify.
 */
export function canonicalizeSpotifyRedirectUri(raw: string): string {
  try {
    const url = new URL(raw);
    if (
      url.pathname === REVERSED_CALLBACK_PATH ||
      url.pathname.endsWith("/callback/spotify")
    ) {
      console.warn(
        `[SpotifyRemote] Correcting reversed redirect path ${url.pathname} → ${SPOTIFY_CALLBACK_PATH}`,
      );
    }
    if (isLocalDevelopmentHost(url.hostname)) {
      if (url.hostname === "localhost" || url.hostname === "[::1]" || url.hostname === "::1") {
        console.warn(
          `[SpotifyRemote] Rewriting forbidden local host ${url.hostname} → 127.0.0.1`,
        );
      }
      return SPOTIFY_DEFAULT_REDIRECT_URI;
    }
    return `${url.origin}${SPOTIFY_CALLBACK_PATH}`;
  } catch {
    return SPOTIFY_DEFAULT_REDIRECT_URI;
  }
}

/**
 * Authorize + token-exchange redirect URI.
 *
 * Prefer `NEXT_PUBLIC_SPOTIFY_REDIRECT_URI` when set. Otherwise fall back to
 * `${window.location.origin}/api/auth/spotify/callback` in the browser, or an
 * empty string on the server (canonicalized to the local-dev default).
 *
 * Local loopback (`localhost`, `::1`, `127.0.0.1`) is always rewritten to
 * {@link SPOTIFY_DEFAULT_REDIRECT_URI} — Spotify forbids `localhost` URIs.
 *
 * Prefer {@link resolveSpotifyRedirectUriFromRequest} in API routes so the
 * exchange URI matches the callback hit Spotify actually redirected to.
 */
export function resolveSpotifyRedirectUri(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_SPOTIFY_REDIRECT_URI?.trim() ||
    process.env.SPOTIFY_REDIRECT_URI?.trim() ||
    "";

  if (fromEnv) {
    return canonicalizeSpotifyRedirectUri(fromEnv);
  }

  // Safe browser/SSR fallback when the public env var is unset.
  const fallback =
    typeof window !== "undefined"
      ? `${window.location.origin}${SPOTIFY_CALLBACK_PATH}`
      : "";

  return canonicalizeSpotifyRedirectUri(fallback || SPOTIFY_DEFAULT_REDIRECT_URI);
}

/**
 * Server-side redirect URI derived from the inbound callback request.
 * Guarantees token-exchange `redirect_uri` matches the authorize request that
 * landed on this host (same origin Spotify redirected to).
 */
export function resolveSpotifyRedirectUriFromRequest(request: Request): string {
  try {
    const origin = new URL(request.url).origin;
    return canonicalizeSpotifyRedirectUri(`${origin}${SPOTIFY_CALLBACK_PATH}`);
  } catch {
    return resolveSpotifyRedirectUri();
  }
}

export function generateRandomString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

/** OAuth CSRF `state` (32 chars by default). */
export function createOAuthState(length = 32): string {
  return generateRandomString(length);
}

/**
 * HttpOnly PKCE cookie flags for `GET /api/auth/spotify`.
 * `secure` is true only on HTTPS so local `http://127.0.0.1` still works.
 */
export function spotifyPkceCookieOptions(secure: boolean): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: SPOTIFY_PKCE_COOKIE_MAX_AGE,
  };
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

function readCookieValue(name: string): string | null {
  if (!isBrowser()) return null;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    try {
      return decodeURIComponent(trimmed.slice(eq + 1));
    } catch {
      return trimmed.slice(eq + 1);
    }
  }
  return null;
}

/**
 * Persist PKCE verifier + OAuth state for the authorize → callback round-trip.
 * Mirrored across localStorage, sessionStorage, and short-lived cookies so the
 * client can recover if one store is purged early (e.g. cookie-only server path).
 */
export function storePkceSession(verifier: string, state: string): void {
  if (!isBrowser()) return;
  localStorage.setItem(STORAGE_VERIFIER, verifier);
  localStorage.setItem(STORAGE_STATE, state);
  sessionStorage.setItem(STORAGE_VERIFIER, verifier);
  sessionStorage.setItem(STORAGE_STATE, state);
  setCookie(SPOTIFY_PKCE_VERIFIER_COOKIE, verifier, 600);
  setCookie(SPOTIFY_OAUTH_STATE_COOKIE, state, 600);
}

/**
 * Clear PKCE material. Call only after a successful token exchange (or an
 * intentional abort) — never before the Spotify token request succeeds.
 */
export function clearPkceSession(): void {
  if (!isBrowser()) return;
  localStorage.removeItem(STORAGE_VERIFIER);
  localStorage.removeItem(STORAGE_STATE);
  sessionStorage.removeItem(STORAGE_VERIFIER);
  sessionStorage.removeItem(STORAGE_STATE);
  clearCookie(SPOTIFY_PKCE_VERIFIER_COOKIE);
  clearCookie(SPOTIFY_OAUTH_STATE_COOKIE);
}

/**
 * Read the PKCE verifier without removing it. Falls back across localStorage →
 * sessionStorage → cookie so a missing key never throws.
 */
export function loadPkceVerifier(): string | null {
  if (!isBrowser()) return null;
  try {
    return (
      localStorage.getItem(STORAGE_VERIFIER) ??
      sessionStorage.getItem(STORAGE_VERIFIER) ??
      readCookieValue(SPOTIFY_PKCE_VERIFIER_COOKIE)
    );
  } catch {
    // Storage access can throw in locked-down / private contexts.
    return readCookieValue(SPOTIFY_PKCE_VERIFIER_COOKIE);
  }
}

export function loadPkceState(): string | null {
  if (!isBrowser()) return null;
  try {
    return (
      localStorage.getItem(STORAGE_STATE) ??
      sessionStorage.getItem(STORAGE_STATE) ??
      readCookieValue(SPOTIFY_OAUTH_STATE_COOKIE)
    );
  } catch {
    return readCookieValue(SPOTIFY_OAUTH_STATE_COOKIE);
  }
}

function readMigratingStorageValue(canonical: string, legacy: string): string | null {
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
  for (const key of [
    STORAGE_ACCESS,
    STORAGE_REFRESH,
    STORAGE_EXPIRES,
    LEGACY_STORAGE_ACCESS,
    LEGACY_STORAGE_REFRESH,
    LEGACY_STORAGE_EXPIRES,
  ]) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }
}

export function loadSpotifyTokens(): SpotifyTokenSet | null {
  if (!isBrowser()) return null;

  const accessToken = readMigratingStorageValue(STORAGE_ACCESS, LEGACY_STORAGE_ACCESS);
  const refreshToken = readMigratingStorageValue(STORAGE_REFRESH, LEGACY_STORAGE_REFRESH);
  const expiresRaw = readMigratingStorageValue(STORAGE_EXPIRES, LEGACY_STORAGE_EXPIRES);

  if (!accessToken || !refreshToken || !expiresRaw) return null;

  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt)) return null;

  return { accessToken, refreshToken, expiresAt };
}

/**
 * Build Spotify's authorize URL (PKCE S256). Used by `GET /api/auth/spotify`
 * after the server has set HttpOnly PKCE cookies.
 */
export function buildSpotifyAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  scopes: string;
  state: string;
  codeChallenge: string;
}): string {
  return (
    `${SPOTIFY_AUTHORIZE_URL}` +
    `?client_id=${encodeURIComponent(input.clientId)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(input.redirectUri)}` +
    `&scope=${encodeURIComponent(input.scopes)}` +
    `&state=${encodeURIComponent(input.state)}` +
    `&code_challenge_method=S256` +
    `&code_challenge=${encodeURIComponent(input.codeChallenge)}`
  );
}

/**
 * Start Spotify OAuth. PKCE cookies must be HttpOnly, so this returns the
 * server initiation path (`GET /api/auth/spotify`) rather than a client-built
 * authorize URL. Caller should `window.location.assign` the result.
 */
export async function beginSpotifyAuth(_options?: {
  scopes?: string;
  clientId?: string;
  redirectUri?: string;
}): Promise<string> {
  if (!isBrowser()) {
    throw new Error("beginSpotifyAuth must run in the browser");
  }
  if (!process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID?.trim()) {
    throw new Error("NEXT_PUBLIC_SPOTIFY_CLIENT_ID is not configured");
  }
  return SPOTIFY_AUTH_INIT_PATH;
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
  const clientId =
    input.clientId?.trim() ||
    process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID?.trim() ||
    "";
  if (!clientId) {
    throw new Error("NEXT_PUBLIC_SPOTIFY_CLIENT_ID is not configured");
  }
  // Must match the redirect_uri used in beginSpotifyAuth (env → origin fallback).
  const redirectUri = canonicalizeSpotifyRedirectUri(
    input.redirectUri?.trim() ||
      process.env.NEXT_PUBLIC_SPOTIFY_REDIRECT_URI?.trim() ||
      (typeof window !== "undefined"
        ? `${window.location.origin}${SPOTIFY_CALLBACK_PATH}`
        : resolveSpotifyRedirectUri()),
  );

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

/**
 * Optional Web Playback SDK player. Volume *ramps* use local `setVolume`
 * only; REST `PUT /me/player/volume` is reserved for the listener fader
 * and the final ramp endpoint. Transport resume/seek prefer SDK methods
 * before Connect REST. `setVolume` expects normalized 0.0–1.0.
 */
export type SpotifySdkVolumePlayer = {
  setVolume: (volumeNormalized: number) => Promise<void> | void;
  /** Optional SDK volume read (normalized 0.0–1.0) for pre-break capture. */
  getVolume?: () => Promise<number> | number;
  /** Device id from the SDK `ready` event when this tab hosts playback. */
  device_id?: string | null;
  getDeviceId?: () => string | null | undefined;
  /**
   * Web Playback SDK `player.pause()` — preferred on tab foreground / WS
   * reconnect so local ghost audio is stopped even when REST lags.
   */
  pause?: () => Promise<void> | void;
  /**
   * Web Playback SDK `player.resume()` — preferred for Mode A/B unpause so
   * local playhead motion is not gated on Connect `PUT /me/player/play`.
   */
  resume?: () => Promise<void> | void;
  /**
   * Web Playback SDK `player.seek(position_ms)` — preferred for Mode B
   * 0:00 holds so the local playhead matches REST seek.
   */
  seek?: (positionMs: number) => Promise<void> | void;
  /** Optional SDK state probe used to acknowledge pause / resume / playhead. */
  getCurrentState?: () => Promise<{
    paused?: boolean;
    position?: number;
    duration?: number;
    track_window?: {
      current_track?: {
        id: string | null;
        name: string;
        artists: Array<{ name: string }>;
        album: {
          name: string;
          images: Array<{ url?: string }>;
        };
      } | null;
    } | null;
  } | null>;
};

let sdkVolumePlayer: SpotifySdkVolumePlayer | null = null;
/** Cached active Spotify Connect / Web Playback device id for volume PUTs. */
let activeDeviceId: string | null = null;

/** Register (or clear) a Web Playback SDK player for local volume control. */
export function registerSpotifySdkPlayer(
  player: SpotifySdkVolumePlayer | null,
): void {
  sdkVolumePlayer = player;
  const fromPlayer =
    player?.device_id?.trim() ||
    player?.getDeviceId?.()?.trim() ||
    null;
  if (fromPlayer) {
    activeDeviceId = fromPlayer;
  }
}

/** Live Web Playback SDK bridge (volume + optional pause), if registered. */
export function getSpotifySdkPlayer(): SpotifySdkVolumePlayer | null {
  return sdkVolumePlayer;
}

/** Cache the active Spotify device id (e.g. from Web Playback SDK `ready`). */
export function setSpotifyActiveDeviceId(deviceId: string | null): void {
  activeDeviceId = deviceId?.trim() || null;
}

/** Read the cached active device id, if any. */
export function getSpotifyActiveDeviceId(): string | null {
  return activeDeviceId;
}

/**
 * Transfer Spotify Connect playback onto a local Web Playback SDK device
 * (the embedded SongHost Radio player). Uses `PUT /v1/me/player` with
 * `{ device_ids: [deviceId], play }`.
 *
 * Default `play: false` registers SongHost Radio as the active destination without
 * forcing playback to start.
 */
export async function transferPlaybackToLocalDevice(
  deviceId: string,
  play: boolean = false,
): Promise<SpotifyPlaybackResult> {
  const trimmed = deviceId.trim();
  if (!trimmed) {
    console.warn("[SpotifyRemote] transferPlaybackToLocalDevice: empty deviceId");
    return false;
  }

  const accessToken = await getValidSpotifyAccessToken();
  if (!accessToken) {
    console.warn("[SpotifyRemote] transferPlaybackToLocalDevice: no access token");
    return false;
  }

  setSpotifyActiveDeviceId(trimmed);

  try {
    const res = await fetch(`${SPOTIFY_API_BASE}/me/player`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        device_ids: [trimmed],
        play,
      }),
    });

    console.log(
      "[SpotifyRemote] Transfer playback status:",
      res.status,
      "device:",
      trimmed,
      "play:",
      play,
    );

    if (res.status === 204 || res.ok) {
      return true;
    }

    if (res.status === 403) {
      console.warn("Spotify Premium or user-modify-playback-state scope required");
      return false;
    }

    if (res.status === 404) {
      console.warn("No active Spotify device found during transfer");
      return { success: false, reason: "NO_ACTIVE_DEVICE" };
    }

    const detail = await res.text().catch(() => "");
    console.warn(
      "[SpotifyRemote] transferPlaybackToLocalDevice failed:",
      res.status,
      detail || "(empty)",
    );
    return false;
  } catch (error) {
    console.warn("[SpotifyRemote] transferPlaybackToLocalDevice error:", error);
    return false;
  }
}

type SpotifyDevicesPayload = {
  devices?: Array<{
    id?: string | null;
    is_active?: boolean;
    is_restricted?: boolean;
    name?: string;
  }>;
};

/**
 * Resolve the device that should receive volume commands.
 * Prefer the cached / SDK id; otherwise query `GET /me/player/devices`.
 */
export async function resolveSpotifyActiveDeviceId(
  accessToken: string,
): Promise<string | null> {
  if (activeDeviceId) return activeDeviceId;

  const fromSdk =
    sdkVolumePlayer?.device_id?.trim() ||
    sdkVolumePlayer?.getDeviceId?.()?.trim() ||
    null;
  if (fromSdk) {
    activeDeviceId = fromSdk;
    return activeDeviceId;
  }

  try {
    const res = await fetch(`${SPOTIFY_API_BASE}/me/player/devices`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      console.warn("[SpotifyRemote] devices lookup failed:", res.status);
      return null;
    }

    const data = (await res.json()) as SpotifyDevicesPayload;
    const devices = data.devices ?? [];
    const active =
      devices.find((device) => device.is_active && device.id) ??
      devices.find((device) => device.id && !device.is_restricted);
    const resolved = active?.id?.trim() || null;
    if (resolved) {
      activeDeviceId = resolved;
    }
    return resolved;
  } catch (error) {
    console.warn("[SpotifyRemote] devices lookup error:", error);
    return null;
  }
}

/**
 * Clamp a gain to the 0–1 unit interval used by SongHost ducking math and
 * the Web Playback SDK `player.setVolume(0.0–1.0)`.
 */
export function clampSpotifyVolumeNormalized(volume: number): number {
  const n = typeof volume === "number" ? volume : Number(volume);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Map a normalized 0.0–1.0 gain to the integer percent expected by
 * `PUT /me/player/volume?volume_percent=`.
 *
 * Always uses `Math.round(volumeFloat * 100)` for unit-interval inputs so
 * duck `0.2` becomes `20` (never `0.2` or `0`).
 *
 * Examples: `0.2 → 20`, `0.5 → 50`, `1 → 100`, `0 → 0`.
 * Values already in the 0–100 percent range (> 1) are treated as percent so a
 * mistaken double-scale call cannot silently floor to 0%.
 */
export function toSpotifyRestVolumePercent(volumeNormalized: number): number {
  const volumeFloat =
    typeof volumeNormalized === "number"
      ? volumeNormalized
      : Number(volumeNormalized);
  if (!Number.isFinite(volumeFloat)) return 0;
  if (volumeFloat > 1) {
    return Math.min(100, Math.max(0, Math.round(volumeFloat)));
  }
  // Critical: REST mute bug happens when 0.2 is sent raw — always scale.
  return Math.min(100, Math.max(0, Math.round(volumeFloat * 100)));
}

/**
 * Local Web Playback SDK volume write. Ramp ticks MUST use this path only
 * so a 12-step swell cannot storm `PUT /me/player/volume` (429s).
 */
export async function applySdkVolume(normalized: number): Promise<boolean> {
  if (!sdkVolumePlayer) return false;
  try {
    // Web Playback SDK expects a float in [0.0, 1.0] — pass through as-is
    // (e.g. 0.2 for duck, 1.0 for full). Never scale to 0–100 here.
    console.log("[TELEMETRY: SDK Volume]", normalized);
    await sdkVolumePlayer.setVolume(normalized);
    console.log("[SpotifyRemote] SDK setVolume:", normalized);
    return true;
  } catch (error) {
    console.warn("[SpotifyRemote] SDK setVolume failed", error);
    return false;
  }
}

async function applyRestVolume(
  accessToken: string,
  volumePercentInteger: number,
  deviceId: string | null,
): Promise<SpotifyPlaybackResult> {
  // REST requires an integer 0–100. Callers must pre-convert via
  // Math.round(volumeFloat * 100) / toSpotifyRestVolumePercent — never pass
  // a normalized float (0.5 would be rejected / misread).
  console.log(
    "[Spotify Volume REST] Sending volume_percent:",
    volumePercentInteger,
  );

  const params = new URLSearchParams({
    volume_percent: String(volumePercentInteger),
  });
  if (deviceId) {
    params.set("device_id", deviceId);
  }

  const res = await fetch(
    `${SPOTIFY_API_BASE}/me/player/volume?${params.toString()}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  const body = await res.text().catch((err) => {
    console.error("[SongHost TRACE ERROR]", err);
    return "";
  });

  console.log("[Spotify Volume]", res.status);
  console.log(
    "[SongHost TRACE] Spotify volume API status:",
    res.status,
    "body:",
    body || "(empty)",
  );

  if (res.status === 204 || res.ok) {
    return true;
  }

  if (res.status === 401 || res.status === 403 || res.status === 404) {
    console.warn(
      `[Spotify Volume] rejected (${res.status})`,
      body || "(empty body)",
    );
  }

  if (res.status === 403) {
    console.warn("Spotify Premium or user-modify-playback-state scope required");
    return false;
  }

  if (res.status === 404) {
    console.warn("No active Spotify device found");
    // Cached id may be stale — clear so the next attempt re-resolves.
    if (deviceId && activeDeviceId === deviceId) {
      activeDeviceId = null;
    }
    return { success: false, reason: "NO_ACTIVE_DEVICE" };
  }

  return false;
}

type SpotifyPlayerVolumePayload = {
  device?: {
    volume_percent?: number | null;
  } | null;
};

/**
 * Read the listener's current Spotify volume as a normalized 0–1 gain.
 * Prefers the Web Playback SDK `getVolume()` when registered; otherwise
 * `GET /me/player` → `device.volume_percent / 100`.
 *
 * Used to capture the pre-break base volume before Duck–Talk–Swell so the
 * swell restores the user's level instead of hardcoding 1.0 (volume creep).
 */
export async function getCurrentSpotifyVolume(
  accessToken?: string,
): Promise<number> {
  if (sdkVolumePlayer?.getVolume) {
    try {
      const sdkVolume = await sdkVolumePlayer.getVolume();
      if (typeof sdkVolume === "number" && Number.isFinite(sdkVolume)) {
        const normalized = clampSpotifyVolumeNormalized(sdkVolume);
        console.log("[SpotifyRemote] getCurrentSpotifyVolume (SDK):", normalized);
        return normalized;
      }
    } catch (error) {
      console.warn("[SpotifyRemote] SDK getVolume failed", error);
    }
  }

  const token = accessToken ?? (await getValidSpotifyAccessToken());
  if (!token) {
    console.warn("[SpotifyRemote] getCurrentSpotifyVolume: no access token");
    return 1;
  }

  try {
    const res = await fetch(`${SPOTIFY_API_BASE}/me/player`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      console.warn(
        "[SpotifyRemote] getCurrentSpotifyVolume player lookup failed:",
        res.status,
      );
      return 1;
    }

    if (res.status === 204) {
      return 1;
    }

    const data = (await res.json()) as SpotifyPlayerVolumePayload;
    const percent = data.device?.volume_percent;
    if (typeof percent === "number" && Number.isFinite(percent)) {
      const normalized = clampSpotifyVolumeNormalized(percent / 100);
      console.log("[SpotifyRemote] getCurrentSpotifyVolume (REST):", {
        volume_percent: percent,
        normalized,
      });
      return normalized;
    }

    console.warn(
      "[SpotifyRemote] getCurrentSpotifyVolume: missing device.volume_percent",
    );
    return 1;
  } catch (error) {
    console.warn("[SpotifyRemote] getCurrentSpotifyVolume error:", error);
    return 1;
  }
}

/**
 * Cached / SDK device id for Connect REST command URLs (`device_id=`).
 * Prefer this over a devices GET on the hot path (resume / seek / play).
 */
function restDeviceId(): string {
  return (
    activeDeviceId?.trim() ||
    sdkVolumePlayer?.device_id?.trim() ||
    sdkVolumePlayer?.getDeviceId?.()?.trim() ||
    ""
  );
}

/**
 * Set the listener's active Spotify device volume from a normalized 0–1 gain.
 *
 * Dual-path REST is reserved for **user-initiated** deck fader changes
 * (and the final landing write of a ramp). Intermediate duck/swell ticks
 * must call {@link applySdkVolume} only — never this helper — or Connect
 * will 429 on ~33 ms `PUT /me/player/volume` storms.
 *
 * Requires Spotify Premium + `user-modify-playback-state` scope.
 */
export async function setSpotifyVolume(
  accessToken: string,
  volumeNormalized: number,
): Promise<SpotifyPlaybackResult> {
  // Destination-specific conversion:
  // - SDK: normalized float 0.0–1.0 (pass through) — e.g. setSpotifyVolume(…, 0.2)
  // - REST: integer percent 0–100 via Math.round(float * 100) — e.g. volume_percent=20
  const volumeFloat = clampSpotifyVolumeNormalized(volumeNormalized);
  const volumePercentInteger = toSpotifyRestVolumePercent(volumeFloat);
  const deviceId = await resolveSpotifyActiveDeviceId(accessToken);

  console.log("[SongHost TRACE] setSpotifyVolume", {
    volumeFloat,
    volumePercentInteger,
    deviceId,
    // Explicit sanity check: duck 0.2 → 20, never 0.2 or 0.
    restMath: `Math.round(${volumeFloat} * 100) = ${Math.round(volumeFloat * 100)}`,
  });

  const [sdkOk, restResult] = await Promise.all([
    applySdkVolume(volumeFloat),
    applyRestVolume(accessToken, volumePercentInteger, deviceId),
  ]);

  console.log("[SongHost TRACE] setSpotifyVolume result", {
    sdkOk,
    restResult,
  });

  if (restResult === true || sdkOk) {
    return true;
  }

  return restResult;
}

/** Default Duck–Talk–Swell fade-up window after DJ speech (swell). */
export const SPOTIFY_VOLUME_RAMP_MS = 600;
/** Fade-down window before DJ speech begins. */
export const SPOTIFY_VOLUME_DUCK_RAMP_MS = 400;

/** Floor so log-space interpolation never hits `log(0)`. */
const VOLUME_RAMP_LOG_EPSILON = 1e-4;

/**
 * Interpolate amplitude on a logarithmic (perceived-loudness) curve.
 * Linear step deltas sound front-loaded; equal ratios track human hearing.
 */
export function lerpSpotifyVolumeLog(
  from: number,
  to: number,
  t: number,
): number {
  const progress = Math.min(1, Math.max(0, t));
  const a = clampSpotifyVolumeNormalized(from);
  const b = clampSpotifyVolumeNormalized(to);
  if (progress <= 0) return a;
  if (progress >= 1) return b;

  // Near-mute endpoints: ease with a power curve that can actually reach 0.
  if (a < VOLUME_RAMP_LOG_EPSILON || b < VOLUME_RAMP_LOG_EPSILON) {
    const eased = progress * progress;
    return clampSpotifyVolumeNormalized(a + (b - a) * eased);
  }

  return clampSpotifyVolumeNormalized(
    Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * progress),
  );
}

/**
 * Smoothly ramp Spotify volume across `steps` using a logarithmic amplitude
 * curve (equal-ratio steps for perceived loudness). Intermediate ticks write
 * **local SDK `setVolume` only**. REST `PUT /me/player/volume` fires once at
 * the final endpoint so Connect stays in sync without a 429 storm.
 *
 * When no SDK player is registered (remote Connect-only), ticks fall back to
 * REST so a phone/desktop device still ducks.
 *
 * @example
 *   await rampSpotifyVolume(token, 1.0, 0.2, 400); // duck
 *   await rampSpotifyVolume(token, 0.2, 1.0, 600); // swell
 */
export async function rampSpotifyVolume(
  accessToken: string,
  fromVolume: number,
  toVolume: number,
  durationMs: number = SPOTIFY_VOLUME_RAMP_MS,
  options?: { signal?: AbortSignal },
): Promise<SpotifyPlaybackResult> {
  const steps = 12;
  const from = clampSpotifyVolumeNormalized(fromVolume);
  const to = clampSpotifyVolumeNormalized(toVolume);
  const safeDuration =
    typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0
      ? durationMs
      : SPOTIFY_VOLUME_RAMP_MS;
  const intervalMs = safeDuration / steps;
  const sdkOnlyTicks = Boolean(sdkVolumePlayer);
  let lastResult: SpotifyPlaybackResult = true;

  console.log("[SongHost TRACE] rampSpotifyVolume", {
    from,
    to,
    durationMs: safeDuration,
    steps,
    intervalMs,
    curve: "logarithmic",
    ticks: sdkOnlyTicks ? "sdk-only" : "rest-fallback",
  });

  for (let i = 1; i <= steps; i++) {
    if (options?.signal?.aborted) {
      console.log("[SongHost TRACE] rampSpotifyVolume aborted", { step: i });
      break;
    }

    const current = lerpSpotifyVolumeLog(from, to, i / steps);
    if (sdkOnlyTicks) {
      lastResult = (await applySdkVolume(current)) ? true : lastResult;
    } else {
      lastResult = await setSpotifyVolume(accessToken, current);
      if (isNoActiveDeviceResult(lastResult)) {
        return lastResult;
      }
    }

    if (i < steps) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, intervalMs);
        const onAbort = () => {
          clearTimeout(timer);
          resolve();
        };
        if (options?.signal) {
          if (options.signal.aborted) {
            onAbort();
            return;
          }
          options.signal.addEventListener("abort", onAbort, { once: true });
        }
      });
    }
  }

  if (options?.signal?.aborted) {
    return lastResult;
  }

  // Land exactly on the target (dual-path) so Connect matches the SDK floor.
  lastResult = await setSpotifyVolume(accessToken, to);
  return lastResult;
}

/**
 * Extract a bare Spotify track id from a URI, open.spotify.com URL, or id.
 *
 * Examples:
 * - `spotify:track:7hanhZrUArC9qUerln4jh1` → `7hanhZrUArC9qUerln4jh1`
 * - `https://open.spotify.com/track/7hanhZrUArC9qUerln4jh1` → `7hanhZrUArC9qUerln4jh1`
 * - `7hanhZrUArC9qUerln4jh1` → `7hanhZrUArC9qUerln4jh1`
 *
 * Returns null when the input is empty or not a recognizable Spotify track id
 * (e.g. a YouTube video id used as a station-queue seed).
 */
export function normalizeSpotifyTrackId(uriOrId: string): string | null {
  const raw = uriOrId.trim();
  if (!raw) return null;

  const uriMatch = /^spotify:track:([A-Za-z0-9]+)/i.exec(raw);
  if (uriMatch?.[1]) return uriMatch[1];

  const urlMatch =
    /(?:open\.)?spotify\.com\/(?:intl-[a-z]+\/)?track\/([A-Za-z0-9]+)/i.exec(
      raw,
    );
  if (urlMatch?.[1]) return urlMatch[1];

  // Spotify catalog ids are 22-char base62; reject shorter ids (e.g. YouTube).
  if (/^[A-Za-z0-9]{22}$/.test(raw)) return raw;

  return null;
}

export type SpotifyPlayOptions = {
  /** Spotify track/episode URIs to start (e.g. `spotify:track:…`). */
  uris?: string[];
  /** Optional context URI (album/playlist) when not using `uris`. */
  context_uri?: string;
  /** Resume position inside the first URI, in milliseconds. */
  position_ms?: number;
};

/**
 * Start / replace playback on the listener's active Spotify device.
 * SongHost Radio must call this on Launch Radio so the remote player switches to
 * the station's selected track rather than whatever was already playing.
 *
 * Shape mirrors the Web Playback SDK: `play({ uris: [trackUri] })`.
 */
export async function play(
  accessToken: string,
  options: SpotifyPlayOptions = {},
): Promise<SpotifyPlaybackResult> {
  const body: Record<string, unknown> = {};
  if (options.uris?.length) body.uris = options.uris;
  if (options.context_uri) body.context_uri = options.context_uri;
  if (
    typeof options.position_ms === "number" &&
    Number.isFinite(options.position_ms)
  ) {
    body.position_ms = Math.max(0, Math.floor(options.position_ms));
  }

  // Prefer the Web Playback SDK device so play-after-refresh lands on SongHost Radio
  // rather than a stale phone/desktop Connect target (or 404 with no device).
  const deviceId = getSpotifyActiveDeviceId()?.trim() || "";
  const playUrl = deviceId
    ? `${SPOTIFY_API_BASE}/me/player/play?device_id=${encodeURIComponent(deviceId)}`
    : `${SPOTIFY_API_BASE}/me/player/play`;

  const res = await fetch(playUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: Object.keys(body).length ? JSON.stringify(body) : undefined,
  });

  console.log("[SpotifyRemote] Play status:", res.status, options.uris?.[0] ?? options.context_uri ?? "resume");

  if (res.status === 204 || res.ok) {
    return true;
  }

  if (res.status === 403) {
    console.warn("Spotify Premium or user-modify-playback-state scope required");
    return false;
  }

  if (res.status === 404) {
    console.warn("No active Spotify device found");
    return { success: false, reason: "NO_ACTIVE_DEVICE" };
  }

  return false;
}

/** Convenience alias used by the companion session controller. */
export async function playSpotifyTrack(
  accessToken: string,
  trackUri: string,
): Promise<SpotifyPlaybackResult> {
  return play(accessToken, { uris: [trackUri] });
}

type SpotifySearchTrackPayload = {
  tracks?: {
    items?: Array<{
      id?: string;
      uri?: string;
      name?: string;
      artists?: Array<{ name?: string }>;
      album?: {
        name?: string;
        images?: Array<{ url?: string }>;
      };
      duration_ms?: number;
    }>;
  };
};

/** Max resolved / negative Search entries; eviction drops the oldest key. */
export const SEARCH_URI_CACHE_LIMIT = 256;
/** TTL for 429s and circuit-open fail-fasts so identical queries cannot storm Search. */
export const SEARCH_NEGATIVE_TTL_MS = 60_000;
/** TTL for empty catalog misses so sanitizer updates can retry (not permanent). */
export const SEARCH_EMPTY_TTL_MS = 15_000;
/** Max parallel Spotify Search GETs. Station handoff maps up to 30 titles through this slot. */
export const SEARCH_CONCURRENCY = 2;

type SpotifyUriSearchCacheEntry = {
  uri: string | null;
  /** Epoch ms when a negative entry expires. Hits have no TTL. */
  expiresAt?: number;
};

/** Successful URIs and confirmed misses (`null`). Negative 429s expire. */
const spotifyUriSearchCache = new Map<string, SpotifyUriSearchCacheEntry>();
/** In-flight Search promises, keyed the same as {@link spotifyUriSearchCache}. */
const spotifyUriSearchInFlight = new Map<string, Promise<string | null>>();

let searchSlotsInUse = 0;
const searchSlotWaiters: Array<() => void> = [];

function acquireSearchSlot(): Promise<void> {
  if (searchSlotsInUse < SEARCH_CONCURRENCY) {
    searchSlotsInUse += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    searchSlotWaiters.push(() => {
      searchSlotsInUse += 1;
      resolve();
    });
  });
}

function releaseSearchSlot(): void {
  searchSlotsInUse = Math.max(0, searchSlotsInUse - 1);
  const next = searchSlotWaiters.shift();
  if (next) next();
}

function readUriSearchCache(key: string): string | null | undefined {
  const entry = spotifyUriSearchCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
    spotifyUriSearchCache.delete(key);
    return undefined;
  }
  // LRU: refresh insertion order on hit.
  spotifyUriSearchCache.delete(key);
  spotifyUriSearchCache.set(key, entry);
  return entry.uri;
}

function writeUriSearchCache(
  key: string,
  uri: string | null,
  ttlMs?: number,
): void {
  spotifyUriSearchCache.delete(key);
  spotifyUriSearchCache.set(key, {
    uri,
    expiresAt: ttlMs !== undefined ? Date.now() + ttlMs : undefined,
  });
  while (spotifyUriSearchCache.size > SEARCH_URI_CACHE_LIMIT) {
    const oldest = spotifyUriSearchCache.keys().next().value;
    if (oldest === undefined) break;
    spotifyUriSearchCache.delete(oldest);
  }
}

function rememberEmptySearch(key: string): void {
  writeUriSearchCache(key, null, SEARCH_EMPTY_TTL_MS);
}

function rememberNegativeSearch(key: string): void {
  writeUriSearchCache(key, null, SEARCH_NEGATIVE_TTL_MS);
}

export function resetSpotifyUriSearchCacheForTests(): void {
  spotifyUriSearchCache.clear();
  spotifyUriSearchInFlight.clear();
  searchSlotsInUse = 0;
  searchSlotWaiters.length = 0;
}

/**
 * YouTube aggregator / event / label channels that must not be sent as `artist:`.
 * A match makes {@link sanitizeSpotifySearchArtist} return `""` so Search falls
 * back to track-only matching.
 */
const SPOTIFY_IGNORED_CHANNEL_RE =
  /audiotree|smtown|kexp|vevo|audacy|audio\s+video\s+musica|\brecords\b|\bofficial\b/i;

/**
 * Strip YouTube title junk so Spotify `track:"…"` queries match catalog names.
 *
 * Removes straight (`"`) and curly (`“` `”`) double quotes, single quotes, and
 * leftover brackets; video resolution tags (`1080p`, `720p`, `480p`, `4k`, `8k`,
 * `hd`, `hq`, `mv`); standalone 4-digit years (`1967`, `2021`); 8-digit date
 * stamps (`19880110`); featuring credits (`ft.`, `feat.`, `featuring` plus the
 * featured-artist string); and generic parenthetical metadata (`(Official Video)`,
 * `(Lyric Video)`, `(Audio)`, `(Remastered)`, `(EXCLUSIVE Performance!)`,
 * `(With Intro)`, …). Structural tags (`pt. 1`, `part 2`, `radio edit`,
 * `single version`) are preserved. Trailing dashes, pipes, and whitespace are
 * trimmed. `Artist - Song` keeps only the song portion.
 */
export function sanitizeSpotifySearchTitle(rawTitle: string): string {
  let title = rawTitle.trim();
  if (!title) return "";

  // "| Live From Madison Square Garden"
  title = title.replace(/\s*\|.+$/, "");
  // "[Official Video]", "[4K]", "[MV]" — strip whole tags before leftover brackets
  title = title.replace(/\s*\[[^\]]*\]/g, "");
  // Straight / curly quotes and leftover bracket characters
  title = title.replace(/["“”‘’']/g, "");
  title = title.replace(/[[\]{}]/g, "");
  // "(live at ...)", "(Live From ...)"
  title = title.replace(/\s*\(\s*live\b[^)]*\)/gi, "");
  // Parenthetical featuring credits: (feat. Drake), (ft. Lainey Wilson)
  title = title.replace(
    /\s*\(\s*(?:featuring|feat|ft)\.?\s+[^)]*\)/gi,
    "",
  );
  // Generic YouTube parenthetical metadata — keep pt./title parens
  title = title.replace(
    /\s*\(\s*(?:exclusive\b[^)]*|official\b[^)]*|(?:music\s+)?video\b[^)]*|lyric(?:s)?(?:\s+video)?[^)]*|\baudio\b[^)]*|remaster(?:ed)?\b[^)]*|performance\b[^)]*|visualizer\b[^)]*|colorized\b[^)]*|(?:hd|hq|4k|8k|1080p|720p|480p|mv))\s*\)/gi,
    "",
  );
  // Remaining generic parentheticals (`(With Intro)`) — keep structural tags.
  title = title.replace(/\s*\(([^)]*)\)/g, (full, inner: string) => {
    const text = inner.trim();
    if (
      /^(?:pt\.?\s*\d+|part\s*\d+|radio\s+edit|single\s+version)$/i.test(text)
    ) {
      return full;
    }
    return "";
  });
  // Quality / video tags (standalone, dashed, or parenthetical)
  title = title.replace(
    /\s*(?:[\-–—:]\s*)?\(?\b(?:official\s+(?:music\s+)?video|official\s+audio|official\s+lyric(?:s)?(?:\s+video)?|lyric(?:s)?(?:\s+video)?|music\s+video)\b\)?/gi,
    "",
  );
  title = title.replace(
    /\s*(?:[\-–—:]\s*)?\(?\b(?:mv|m\/v|4k|8k|hd|hq|1080p|720p|480p)\b\)?/gi,
    "",
  );

  // 8-digit date stamps (YYYYMMDD) e.g. 19880110
  title = title.replace(/\b\d{8}\b/g, "");

  // Standalone 4-digit years. Preserve the string when the title *is* the year
  // (e.g. Prince "1999") so catalog search still has a query.
  const withoutYears = title
    .replace(/\b(?:19|20)\d{2}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (withoutYears) title = withoutYears;

  title = title.replace(/\s*\(\s*\)/g, "");
  title = title.replace(/\s*[\-–—:|]+\s*$/g, "");
  title = title.replace(/\s+/g, " ").trim();

  const dashParts = title.split(/\s+[\-–—]\s+/);
  if (dashParts.length >= 2) {
    const song = dashParts.slice(1).join(" - ").trim();
    if (song) title = song;
  }

  // Trailing featuring credits after the song portion: "ft. Lainey Wilson..."
  title = title.replace(/\s+(?:featuring|feat|ft)\.?\s+.+$/gi, "");

  return title.replace(/\s+/g, " ").trim();
}

/**
 * Clean a YouTube channel name for Spotify `artist:"…"`. Drops `- Topic` and
 * ignores aggregator/event/label channels (Audiotree, SMTOWN, KEXP, Vevo,
 * Audacy, Audio Video Musica, `records`, `official`, …). A match returns `""`
 * so {@link searchSpotifyTrackUri} omits the `artist:` field and falls back to
 * track-only matching.
 *
 * Featuring phrases (`ft.`, `feat.`, `featuring`) and anything after them are
 * stripped. When multiple artists are joined by `&`, `,`, or `and` / `AND`,
 * only the primary (first) name is kept for matching.
 */
export function sanitizeSpotifySearchArtist(rawArtist: string): string {
  let artist = rawArtist.trim();
  if (!artist) return "";

  artist = artist.replace(/\s*[\-–—]\s*topic\s*$/i, "").trim();
  if (!artist || SPOTIFY_IGNORED_CHANNEL_RE.test(artist)) return "";

  artist = artist.replace(
    /\s*\(\s*(?:featuring|feat|ft)\.?\s+[^)]*\)/gi,
    "",
  );
  artist = artist.replace(/\s+(?:featuring|feat|ft)\.?\s+.+$/i, "").trim();

  const primary = artist.split(/\s*[&,]\s*|\s+and\s+/i)[0]?.trim() ?? "";
  return primary;
}

function spotifyUriSearchCacheKey(title: string, artist: string): string {
  return `${title.toLowerCase()}\u0000${artist.toLowerCase()}`;
}

type SpotifySearchAttempt = {
  status: number;
  uri: string | null;
  itemCount: number;
  networkError: boolean;
};

function uriFromSearchPayload(data: SpotifySearchTrackPayload): {
  uri: string | null;
  itemCount: number;
} {
  const items = data.tracks?.items ?? [];
  const hit = items[0];
  const uri = hit?.uri ?? (hit?.id ? `spotify:track:${hit.id}` : null);
  return { uri, itemCount: items.length };
}

/**
 * One Search GET via {@link fetchSpotifyGetWithRetry}. Network failures after
 * retries are returned as `networkError` so the caller can run the plain-query
 * fallback instead of throwing out of station launch.
 */
async function fetchSpotifySearchAttempt(
  accessToken: string,
  query: string,
): Promise<SpotifySearchAttempt> {
  const params = new URLSearchParams({
    q: query,
    type: "track",
    limit: "1",
  });
  try {
    const response = await fetchSpotifyGetWithRetry(
      `${SPOTIFY_API_BASE}/search?${params}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!response.ok) {
      return {
        status: response.status,
        uri: null,
        itemCount: 0,
        networkError: false,
      };
    }
    const data = (await response.json()) as SpotifySearchTrackPayload;
    const { uri, itemCount } = uriFromSearchPayload(data);
    return { status: response.status, uri, itemCount, networkError: false };
  } catch {
    return { status: 0, uri: null, itemCount: 0, networkError: true };
  }
}

function shouldRunPlainSearchFallback(attempt: SpotifySearchAttempt): boolean {
  if (attempt.status === 429 || isSpotifyCircuitOpen()) return false;
  if (attempt.uri) return false;
  return true;
}

function logSearchAttempt(
  phase: "primary" | "fallback" | "title-only",
  query: string,
  attempt: SpotifySearchAttempt,
): void {
  if (attempt.networkError) {
    console.warn(`[SpotifyRemote] Search ${phase} network error:`, { q: query });
    return;
  }
  if (!attempt.uri && attempt.status !== 200) {
    console.warn(`[SpotifyRemote] Search ${phase} failed:`, attempt.status, {
      q: query,
    });
    return;
  }
  if (attempt.itemCount === 0 || !attempt.uri) {
    console.warn(`[SpotifyRemote] Search ${phase} empty:`, { q: query });
  }
}

/**
 * Resolve a catalog title/artist pair to a Spotify track URI via Search.
 * Returns null when nothing matchable is found.
 *
 * Lookup order: LRU cache (incl. in-flight) → 429 circuit fail-fast →
 * bounded Search GET (max {@link SEARCH_CONCURRENCY} in parallel).
 *
 * Search is three-tier. Each later tier runs only when the previous produced
 * no track URI and was not circuit-blocked / HTTP 429:
 * - **Tier 1 (primary):** quoted fields
 *   `track:"${qTitle}" artist:"${qArtist}"` (or `track:"${qTitle}"` when
 *   artist is empty / an ignored YouTube channel)
 * - **Tier 2 (un-fielded):** `${qTitle} ${qArtist}`.trim()
 * - **Tier 3 (title-only):** `${qTitle}` — skipped when it would duplicate
 *   Tier 2 (empty artist). HTTP 429 does not trigger a later tier (circuit /
 *   negative cache still apply). Each attempt logs 502s and empty result sets.
 */
export async function searchSpotifyTrackUri(
  accessToken: string,
  title: string,
  artist: string,
): Promise<string | null> {
  const qTitle = sanitizeSpotifySearchTitle(title);
  const qArtist = sanitizeSpotifySearchArtist(artist);
  if (!qTitle) return null;

  const cacheKey = spotifyUriSearchCacheKey(qTitle, qArtist);
  const cached = readUriSearchCache(cacheKey);
  if (cached !== undefined) return cached;

  const existing = spotifyUriSearchInFlight.get(cacheKey);
  if (existing) return existing;

  const request = (async (): Promise<string | null> => {
    if (isSpotifyCircuitOpen()) {
      rememberNegativeSearch(cacheKey);
      return null;
    }

    await acquireSearchSlot();
    try {
      if (isSpotifyCircuitOpen()) {
        rememberNegativeSearch(cacheKey);
        return null;
      }

      const primaryQuery = qArtist
        ? `track:"${qTitle}" artist:"${qArtist}"`
        : `track:"${qTitle}"`;

      let attempt = await fetchSpotifySearchAttempt(accessToken, primaryQuery);
      logSearchAttempt("primary", primaryQuery, attempt);

      if (shouldRunPlainSearchFallback(attempt)) {
        const fallbackQuery = `${qTitle} ${qArtist}`.trim();
        attempt = await fetchSpotifySearchAttempt(accessToken, fallbackQuery);
        logSearchAttempt("fallback", fallbackQuery, attempt);
      }

      const titleOnlyQuery = qTitle;
      if (
        shouldRunPlainSearchFallback(attempt) &&
        titleOnlyQuery !== `${qTitle} ${qArtist}`.trim()
      ) {
        attempt = await fetchSpotifySearchAttempt(accessToken, titleOnlyQuery);
        logSearchAttempt("title-only", titleOnlyQuery, attempt);
      }

      if (attempt.status === 429 || isSpotifyCircuitOpen()) {
        rememberNegativeSearch(cacheKey);
        return null;
      }

      if (attempt.networkError || (attempt.status !== 200 && !attempt.uri)) {
        return null;
      }

      if (!attempt.uri) {
        rememberEmptySearch(cacheKey);
        return null;
      }

      writeUriSearchCache(cacheKey, attempt.uri);
      return attempt.uri;
    } finally {
      releaseSearchSlot();
    }
  })();

  spotifyUriSearchInFlight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    spotifyUriSearchInFlight.delete(cacheKey);
  }
}

/**
 * Fire when the active Spotify track is inside the last N ms (DJ prefetch window).
 * Mirrors {@link PREFETCH_LOOKAHEAD_SECONDS} (30s) — keep numeric so this transport
 * module does not import the DJ prefetch engine.
 */
export const SPOTIFY_NEAR_END_MS = 30_000;

/** Treat the item as finished inside this window (poll granularity ~2s). */
export const SPOTIFY_ENDED_MS = 500;

export type SpotifyPlaybackState = {
  track: SpotifyTrack | null;
  /** Milliseconds remaining on the active item; null when unknown. */
  remainingMs: number | null;
  /** True when remainingMs is within {@link SPOTIFY_NEAR_END_MS} (prefetch window). */
  isNearEnd: boolean;
  /**
   * True when the active item has completed (or is inside the final
   * {@link SPOTIFY_ENDED_MS}). When Spotify's own queue is empty, Autopilot
   * advances via `playNextTrack()`; mid-queue hops still rely on
   * `registerTrack` for Duck–Talk–Swell.
   */
  isEnded: boolean;
};

export type SpotifyPlaybackSubscription = {
  /** Stop polling. */
  stop: () => void;
};

/**
 * Continuously poll Spotify's currently-playing endpoint and emit state
 * updates (remote stand-in for Web Playback SDK `player_state_changed`).
 */
export function subscribeSpotifyPlaybackState(
  getAccessToken: () => Promise<string | null>,
  onState: (state: SpotifyPlaybackState) => void,
  options?: {
    intervalMs?: number;
    nearEndMs?: number;
    signal?: AbortSignal;
  },
): SpotifyPlaybackSubscription {
  const intervalMs = options?.intervalMs ?? 2000;
  const nearEndMs = options?.nearEndMs ?? SPOTIFY_NEAR_END_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  /** Last non-null item — used when Spotify returns 204 after a single-URI finish. */
  let lastTrack: SpotifyTrack | null = null;

  const emit = (track: SpotifyTrack | null) => {
    // Single-URI playback often clears currently-playing (204) at the end.
    // Re-emit the prior item as ended so autopilot can advance the queue.
    if (!track) {
      if (lastTrack) {
        const ended = lastTrack;
        lastTrack = null; // consume — later 204s must not re-fire the same end
        onState({
          track: {
            ...ended,
            isPlaying: false,
            progressMs: ended.durationMs,
          },
          remainingMs: 0,
          isNearEnd: true,
          isEnded: true,
        });
      } else {
        onState({
          track: null,
          remainingMs: null,
          isNearEnd: false,
          isEnded: false,
        });
      }
      return;
    }

    const duration = track.durationMs;
    const progress = track.progressMs;
    const remainingMs =
      typeof duration === "number" &&
      typeof progress === "number" &&
      Number.isFinite(duration) &&
      Number.isFinite(progress)
        ? Math.max(0, duration - progress)
        : null;
    // Prefetch window: final N ms while still playing (or already stopped).
    const isNearEnd =
      remainingMs != null &&
      remainingMs <= nearEndMs &&
      (track.isPlaying || remainingMs <= SPOTIFY_ENDED_MS);
    // Completion: Spotify often reports is_playing=false at remaining≈0.
    const isEnded =
      remainingMs != null &&
      remainingMs <= SPOTIFY_ENDED_MS &&
      (!track.isPlaying || remainingMs <= 0);

    // Keep a resume copy for the 204 path, but drop it once this item has
    // ended so a stalled currently-playing clear cannot double-advance.
    lastTrack = isEnded ? null : track;

    onState({
      track,
      remainingMs,
      isNearEnd,
      isEnded,
    });
  };

  const tick = async () => {
    if (stopped || options?.signal?.aborted) return;
    if (inFlight) {
      timer = setTimeout(() => void tick(), intervalMs);
      return;
    }

    inFlight = true;
    try {
      const token = await getAccessToken();
      if (!token || stopped) return;
      const track = await getCurrentlyPlaying(token);
      if (!stopped) emit(track);
    } catch (error) {
      console.warn("[SpotifyRemote] playback poll failed:", error);
    } finally {
      inFlight = false;
      if (!stopped && !options?.signal?.aborted) {
        timer = setTimeout(() => void tick(), intervalMs);
      }
    }
  };

  const onAbort = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
  options?.signal?.addEventListener("abort", onAbort, { once: true });

  void tick();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      options?.signal?.removeEventListener("abort", onAbort);
    },
  };
}

/**
 * Pause the listener's active Spotify device.
 * Returns `true` on success, `false` on generic failure, or
 * `{ success: false, reason: "NO_ACTIVE_DEVICE" }` when no device is open.
 *
 * Requires Spotify Premium + `user-modify-playback-state` scope.
 * Prefer {@link setSpotifyVolume} for DJ breaks (Duck–Talk–Swell).
 */
export async function pauseSpotifyPlayback(
  accessToken: string,
): Promise<SpotifyPlaybackResult> {
  // Prefer the local SDK pause first — WebSocket reconnect can resume the
  // embedded player before REST `/me/player/pause` reaches Connect.
  let sdkPaused = false;
  if (sdkVolumePlayer?.pause) {
    try {
      await sdkVolumePlayer.pause();
      sdkPaused = true;
      if (sdkVolumePlayer.getCurrentState) {
        const state = await sdkVolumePlayer.getCurrentState();
        sdkPaused = state?.paused !== false;
      }
    } catch (err) {
      console.warn("[SpotifyRemote] SDK player.pause() failed", err);
    }
  }

  const res = await fetch(`${SPOTIFY_API_BASE}/me/player/pause`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  console.log("[SpotifyRemote] Pause status:", res.status);

  // Spotify returns 204 on success; 404 when nothing is active.
  if (res.status === 204 || res.ok) {
    return true;
  }

  if (res.status === 403) {
    console.warn("Spotify Premium or user-modify-playback-state scope required");
    return sdkPaused ? true : false;
  }

  if (res.status === 404) {
    console.warn("No active Spotify device found");
    // Local SDK may still have been paused even with no Connect device.
    if (sdkPaused) return true;
    return { success: false, reason: "NO_ACTIVE_DEVICE" };
  }

  return sdkPaused ? true : false;
}

/**
 * Resume / start playback on the listener's active Spotify device.
 * Prefers Web Playback SDK `player.resume()` (and verifies
 * `getCurrentState().paused === false`) before Connect REST, with
 * `device_id` on the REST URL so the local SongHost Radio device is targeted.
 * Requires Spotify Premium + `user-modify-playback-state` scope.
 */
export async function resumeSpotifyPlayback(
  accessToken: string,
): Promise<SpotifyPlaybackResult> {
  let sdkResumed = false;
  if (sdkVolumePlayer?.resume) {
    try {
      await sdkVolumePlayer.resume();
      sdkResumed = true;
      if (sdkVolumePlayer.getCurrentState) {
        let state = await sdkVolumePlayer.getCurrentState();
        sdkResumed = state?.paused === false;
        if (!sdkResumed) {
          await sdkVolumePlayer.resume();
          state = await sdkVolumePlayer.getCurrentState();
          sdkResumed = state?.paused === false;
        }
      }
    } catch (err) {
      console.warn("[SpotifyRemote] SDK player.resume() failed", err);
      sdkResumed = false;
    }
  }

  const deviceId = restDeviceId();
  const playUrl = deviceId
    ? `${SPOTIFY_API_BASE}/me/player/play?device_id=${encodeURIComponent(deviceId)}`
    : `${SPOTIFY_API_BASE}/me/player/play`;

  const res = await fetch(playUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  console.log("[SpotifyRemote] Resume status:", res.status, {
    sdkResumed,
    deviceId: getSpotifyActiveDeviceId(),
  });

  if (res.status === 204 || res.ok) {
    return true;
  }

  if (res.status === 403) {
    console.warn("Spotify Premium or user-modify-playback-state scope required");
    return sdkResumed ? true : false;
  }

  if (res.status === 404) {
    console.warn("No active Spotify device found");
    if (sdkResumed) return true;
    return { success: false, reason: "NO_ACTIVE_DEVICE" };
  }

  return sdkResumed ? true : false;
}

/** Deck alias — {@link resumeSpotifyPlayback}. */
export const resume = resumeSpotifyPlayback;

/** Deck alias — {@link pauseSpotifyPlayback}. */
export const pause = pauseSpotifyPlayback;

/**
 * Parse a Spotify player command response into {@link SpotifyPlaybackResult}.
 */
async function playbackCommandResult(
  res: Response,
  label: string,
): Promise<SpotifyPlaybackResult> {
  console.log(`[SpotifyRemote] ${label} status:`, res.status);

  if (res.status === 204 || res.ok) {
    return true;
  }

  if (res.status === 403) {
    console.warn("Spotify Premium or user-modify-playback-state scope required");
    return false;
  }

  if (res.status === 404) {
    console.warn("No active Spotify device found");
    return { success: false, reason: "NO_ACTIVE_DEVICE" };
  }

  return false;
}

/**
 * Skip to the next track on the active Spotify device.
 * Requires Spotify Premium + `user-modify-playback-state` scope.
 */
export async function next(
  accessToken: string,
): Promise<SpotifyPlaybackResult> {
  const res = await fetch(`${SPOTIFY_API_BASE}/me/player/next`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  return playbackCommandResult(res, "Next");
}

/**
 * Skip to the previous track on the active Spotify device.
 * Requires Spotify Premium + `user-modify-playback-state` scope.
 */
export async function previous(
  accessToken: string,
): Promise<SpotifyPlaybackResult> {
  const res = await fetch(`${SPOTIFY_API_BASE}/me/player/previous`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });
  return playbackCommandResult(res, "Previous");
}

/**
 * Seek within the currently playing Spotify item.
 * Prefers Web Playback SDK `player.seek(ms)` before Connect REST, and
 * appends `device_id` so the local SongHost Radio device is targeted.
 * @param positionMs Position from the start of the track, in milliseconds.
 */
export async function seek(
  accessToken: string,
  positionMs: number,
): Promise<SpotifyPlaybackResult> {
  const ms = Math.max(0, Math.floor(positionMs));
  let sdkSeeked = false;
  if (sdkVolumePlayer?.seek) {
    try {
      await sdkVolumePlayer.seek(ms);
      sdkSeeked = true;
    } catch (err) {
      console.warn("[SpotifyRemote] SDK player.seek() failed", err);
    }
  }

  const params = new URLSearchParams({ position_ms: String(ms) });
  const deviceId = restDeviceId();
  if (deviceId) {
    params.set("device_id", deviceId);
  }

  const res = await fetch(
    `${SPOTIFY_API_BASE}/me/player/seek?${params.toString()}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    },
  );
  const restResult = await playbackCommandResult(res, "Seek");
  if (restResult === true || sdkSeeked) return true;
  return restResult;
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
    linked_from?: {
      id?: string | null;
      uri?: string | null;
    } | null;
  } | null;
};

function mapSpotifyApiTrack(
  item: {
    id?: string;
    uri?: string;
    name?: string;
    duration_ms?: number;
    artists?: Array<{ name?: string }>;
    album?: {
      name?: string;
      images?: Array<{ url?: string }>;
    };
    linked_from?: {
      id?: string | null;
      uri?: string | null;
    } | null;
  } | null | undefined,
  playback?: { isPlaying?: boolean; progressMs?: number },
): SpotifyTrack | null {
  if (!item?.id || !item.name) return null;
  const linkedFromId =
    item.linked_from?.id?.trim() ||
    (item.linked_from?.uri
      ? normalizeSpotifyTrackId(item.linked_from.uri)
      : null) ||
    null;
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
    isPlaying: Boolean(playback?.isPlaying),
    progressMs: playback?.progressMs,
    linkedFromId: linkedFromId || null,
  };
}

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
  return mapSpotifyApiTrack(data.item, {
    isPlaying: data.is_playing,
    progressMs: data.progress_ms,
  });
}

type SpotifyPlayerQueuePayload = {
  currently_playing?: SpotifyCurrentlyPlayingPayload["item"];
  queue?: Array<NonNullable<SpotifyCurrentlyPlayingPayload["item"]>>;
};

/** Snapshot of Spotify's live player queue (`GET /me/player/queue`). */
export type SpotifyPlayerQueue = {
  currentlyPlaying: SpotifyTrack | null;
  /** Upcoming items in Spotify's own queue (may be empty for single-URI plays). */
  queue: SpotifyTrack[];
};

/**
 * Read Spotify's actual upcoming queue (Web API stand-in for SDK
 * `player_state_changed` queue). Used so autopilot prefetch matches the
 * song Spotify will play next — not a stale local guess.
 *
 * Requires `user-read-playback-state`.
 */
export async function getSpotifyPlayerQueue(
  accessToken: string,
): Promise<SpotifyPlayerQueue | null> {
  const response = await fetch(`${SPOTIFY_API_BASE}/me/player/queue`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 204 || response.status === 404) {
    return null;
  }

  if (!response.ok) {
    console.warn("[SpotifyRemote] Queue fetch failed:", response.status);
    return null;
  }

  const data = (await response.json()) as SpotifyPlayerQueuePayload;
  const currentlyPlaying = mapSpotifyApiTrack(data.currently_playing ?? null, {
    isPlaying: true,
  });
  const queue = (data.queue ?? [])
    .map((item) => mapSpotifyApiTrack(item, { isPlaying: false }))
    .filter((track): track is SpotifyTrack => Boolean(track));

  return { currentlyPlaying, queue };
}

export { isNoActiveDeviceResult };

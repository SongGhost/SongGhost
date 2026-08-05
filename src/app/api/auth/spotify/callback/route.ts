import { NextResponse } from "next/server";
import {
  SPOTIFY_OAUTH_STATE_COOKIE,
  SPOTIFY_PKCE_VERIFIER_COOKIE,
} from "@/lib/player/spotifyRemote";

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";

type SpotifyTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
};

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;

  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    if (key !== name) continue;
    return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return null;
}

function clearPkceCookies(response: NextResponse): void {
  response.cookies.set(SPOTIFY_PKCE_VERIFIER_COOKIE, "", {
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(SPOTIFY_OAUTH_STATE_COOKIE, "", {
    path: "/",
    maxAge: 0,
  });
}

function dashboardRedirect(
  request: Request,
  params: Record<string, string>,
): NextResponse {
  const url = new URL("/", request.url);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = NextResponse.redirect(url);
  clearPkceCookies(response);
  return response;
}

function errorRedirect(request: Request, reason: string): NextResponse {
  return dashboardRedirect(request, {
    spotify_auth: "error",
    spotify_error: reason,
  });
}

/**
 * Spotify Authorization Code + PKCE callback.
 * Exchanges `code` for access/refresh tokens and redirects to the dashboard
 * with session tokens in the query string for the client to persist.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return errorRedirect(request, oauthError);
  }

  if (!code) {
    return errorRedirect(request, "missing_code");
  }

  const expectedState = readCookie(request, SPOTIFY_OAUTH_STATE_COOKIE);
  if (!state || !expectedState || state !== expectedState) {
    return errorRedirect(request, "invalid_state");
  }

  const codeVerifier = readCookie(request, SPOTIFY_PKCE_VERIFIER_COOKIE);
  if (!codeVerifier) {
    return errorRedirect(request, "missing_pkce_verifier");
  }

  const clientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID?.trim();
  if (!clientId) {
    return errorRedirect(request, "missing_client_id");
  }

  const redirectUri =
    process.env.NEXT_PUBLIC_SPOTIFY_REDIRECT_URI?.trim() ||
    `${url.origin}/api/auth/spotify/callback`;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  });

  // Confidential clients may also send a secret; PKCE public clients omit it.
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  const headers: HeadersInit = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  }

  let tokenPayload: SpotifyTokenResponse;
  try {
    const tokenResponse = await fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers,
      body,
    });

    if (!tokenResponse.ok) {
      const detail = await tokenResponse.text().catch(() => "");
      console.error("Spotify token exchange failed:", tokenResponse.status, detail);
      return errorRedirect(request, "token_exchange_failed");
    }

    tokenPayload = (await tokenResponse.json()) as SpotifyTokenResponse;
  } catch (error) {
    console.error("Spotify token exchange error:", error);
    return errorRedirect(request, "token_exchange_error");
  }

  if (!tokenPayload.access_token || !tokenPayload.refresh_token) {
    return errorRedirect(request, "incomplete_token_response");
  }

  return dashboardRedirect(request, {
    spotify_auth: "success",
    spotify_access_token: tokenPayload.access_token,
    spotify_refresh_token: tokenPayload.refresh_token,
    spotify_expires_in: String(tokenPayload.expires_in ?? 3600),
  });
}

import { NextResponse } from "next/server";
import {
  buildSpotifyAuthorizeUrl,
  createCodeChallenge,
  createCodeVerifier,
  createOAuthState,
  resolveSpotifyRedirectUriFromRequest,
  resolveSpotifyScopes,
  SPOTIFY_OAUTH_STATE_COOKIE,
  SPOTIFY_PKCE_VERIFIER_COOKIE,
  spotifyPkceCookieOptions,
} from "@/lib/audio/legacy/spotifyRemote";

export const dynamic = "force-dynamic";

function homeErrorRedirect(request: Request, reason: string): NextResponse {
  const url = new URL("/", resolveSpotifyRedirectUriFromRequest(request));
  url.searchParams.set("spotify_auth", "error");
  url.searchParams.set("spotify_error", reason);
  return NextResponse.redirect(url, 302);
}

/**
 * Spotify OAuth initiation — generates PKCE material, sets HttpOnly cookies,
 * then 302s to Spotify authorize. Client connect flows navigate here so
 * mobile Safari cannot drop a JS-set (non-HttpOnly) verifier cookie.
 */
export async function GET(request: Request) {
  const clientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID?.trim();
  if (!clientId) {
    return homeErrorRedirect(request, "missing_client_id");
  }

  const redirectUri = resolveSpotifyRedirectUriFromRequest(request);
  const scopes = resolveSpotifyScopes();
  if (!scopes.trim()) {
    return homeErrorRedirect(request, "missing_scopes");
  }

  const verifier = createCodeVerifier();
  const challenge = await createCodeChallenge(verifier);
  if (!challenge) {
    return homeErrorRedirect(request, "pkce_challenge_failed");
  }
  const state = createOAuthState();

  const authorizeUrl = buildSpotifyAuthorizeUrl({
    clientId,
    redirectUri,
    scopes,
    state,
    codeChallenge: challenge,
  });

  const secure = new URL(request.url).protocol === "https:";
  const cookieOptions = spotifyPkceCookieOptions(secure);

  const response = NextResponse.redirect(authorizeUrl, 302);
  response.cookies.set(SPOTIFY_OAUTH_STATE_COOKIE, state, cookieOptions);
  response.cookies.set(SPOTIFY_PKCE_VERIFIER_COOKIE, verifier, cookieOptions);
  return response;
}

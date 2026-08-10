/**
 * Spotify Client Credentials token helper for server-side catalog calls
 * (search, recommendations). Tokens are cached in-process until near expiry.
 *
 * Note: User OAuth (Authorization Code + PKCE) lives in
 * `src/lib/player/spotifyRemote.ts` — this module only handles app credentials.
 */

type SpotifyTokenCache = {
  accessToken: string;
  expiresAt: number;
};

let spotifyTokenCache: SpotifyTokenCache | null = null;

export async function getSpotifyAppToken(): Promise<string | null> {
  // Explicit env reads — same public client id used by browser PKCE authorize.
  const clientId = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;

  if (spotifyTokenCache && Date.now() < spotifyTokenCache.expiresAt - 30_000) {
    return spotifyTokenCache.accessToken;
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    console.warn("[spotify/app-auth] Token exchange failed:", res.status);
    return null;
  }

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) return null;

  spotifyTokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return spotifyTokenCache.accessToken;
}

export type SpotifyImage = { url?: string; height?: number; width?: number };

export function pickSpotifyArtwork(
  images: SpotifyImage[] | undefined,
): string | undefined {
  if (!images?.length) return undefined;
  const sorted = [...images].sort(
    (a, b) => (b.height ?? 0) - (a.height ?? 0),
  );
  // Prefer ~300px thumbnails for list rows.
  const mid =
    sorted.find((img) => (img.height ?? 0) >= 200 && (img.height ?? 0) <= 400) ??
    sorted[Math.min(1, sorted.length - 1)] ??
    sorted[0];
  return mid?.url?.trim() || undefined;
}

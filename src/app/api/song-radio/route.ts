import { GET as getArtistRadio } from "../artist-radio/route";

export const dynamic = "force-dynamic";

/**
 * Old Song Radio URL.
 * It used to weave Last.fm similar artists around the seed.
 * A leftover call now opens the shared Artist Mix builder on that exact song.
 * Songs Mix / Radio in the search list call /api/artist-radio directly.
 */
export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const title = incoming.searchParams.get("title")?.trim() ?? "";
  const artist = incoming.searchParams.get("artist")?.trim() ?? "";
  const params = new URLSearchParams();
  if (artist) params.set("artist", artist);
  const seedTitle = incoming.searchParams.get("seedTitle")?.trim() || title;
  if (seedTitle) params.set("seedTitle", seedTitle);
  params.set("mode", incoming.searchParams.get("mode") === "artist-only" ? "artist-only" : "mixed");
  const itunesTrackId = incoming.searchParams.get("itunesTrackId");
  if (itunesTrackId) params.set("itunesTrackId", itunesTrackId);
  for (const key of ["excludeNeighbors", "excludeYoutubeIds", "exclude"] as const) {
    const value = incoming.searchParams.get(key);
    if (value) params.set(key, value);
  }
  return getArtistRadio(new Request(`http://localhost/api/artist-radio?${params.toString()}`));
}

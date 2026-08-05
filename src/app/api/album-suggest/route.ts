import { NextResponse } from "next/server";
import { searchITunesAlbums } from "@/lib/itunes";

/** Suggestions come from a live iTunes album lookup and must not be statically cached. */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json({ albums: [] });
  }

  const albums = await searchITunesAlbums(q, 8);
  return NextResponse.json({
    albums: albums.map((album) => ({
      collectionId: album.collectionId,
      albumTitle: album.albumTitle,
      artist: album.artist,
      releaseYear: album.releaseYear ?? null,
      coverArtUrl: album.coverArtUrl ?? null,
      trackCount: album.trackCount ?? null,
    })),
  });
}

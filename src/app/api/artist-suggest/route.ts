import { NextResponse } from "next/server";
import { searchITunesArtists } from "@/lib/itunes";

/** Suggestions come from a live iTunes lookup and must not be statically cached. */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json({ suggestions: [] });
  }

  const suggestions = await searchITunesArtists(q, 8);
  return NextResponse.json({ suggestions });
}

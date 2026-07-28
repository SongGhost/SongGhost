import { NextResponse } from "next/server";
import { searchITunesArtists } from "@/lib/itunes";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json({ suggestions: [] });
  }

  const suggestions = await searchITunesArtists(q, 8);
  return NextResponse.json({ suggestions });
}

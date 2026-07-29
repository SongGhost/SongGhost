import { NextResponse } from "next/server";
import { findNearbyArtistEvent } from "@/lib/artist-events";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const artist = searchParams.get("artist")?.trim();
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));

  if (!artist) {
    return NextResponse.json({ error: "artist is required" }, { status: 400 });
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ event: null });
  }

  const event = await findNearbyArtistEvent(artist, lat, lng);
  return NextResponse.json({ event });
}

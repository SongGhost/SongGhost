import { NextResponse } from "next/server";
import { getStationById, type Station, type StationTrack } from "@/data/stations";
import { filterTracksByGenre, trackMatchesGenre } from "@/lib/genre-match";
import { searchITunesSongs } from "@/lib/itunes";

type YouTubeSearchItem = {
  id: { videoId: string };
  snippet: { title: string; channelTitle: string };
};

async function searchYouTube(query: string, maxResults = 5): Promise<StationTrack[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return [];

  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=${maxResults}&order=relevance&q=${encodeURIComponent(query)}&key=${apiKey}`;

  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) return [];

  const data = (await res.json()) as { items?: YouTubeSearchItem[] };
  const tracks: StationTrack[] = [];
  const seen = new Set<string>();

  for (const item of data.items ?? []) {
    const videoId = item.id?.videoId;
    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);

    const title = item.snippet.title
      .replace(/\s*\(official.*?\)/gi, "")
      .replace(/\s*\[official.*?\]/gi, "")
      .trim();

    tracks.push({
      youtubeId: videoId,
      title: title || item.snippet.title,
      artist: item.snippet.channelTitle,
    });
  }

  return tracks;
}

async function fetchGenreTracks(station: Station): Promise<StationTrack[]> {
  const searchTerms = `${station.name} ${station.description}`;
  const tracks: StationTrack[] = [];
  const genreByTrack = new Map<string, string>();
  const seen = new Set<string>();

  const ytResults = await searchYouTube(`${searchTerms} official music`, 25);
  for (const t of ytResults) {
    if (seen.has(t.youtubeId)) continue;
    if (!trackMatchesGenre(t, station)) continue;
    seen.add(t.youtubeId);
    tracks.push(t);
  }

  if (tracks.length < 20) {
    const itunesSongs = await searchITunesSongs(station.name, 25);
    for (const song of itunesSongs) {
      if (tracks.length >= 20) break;

      const candidate: StationTrack = {
        youtubeId: "",
        title: song.title,
        artist: song.artist,
      };

      if (!trackMatchesGenre(candidate, station, song.primaryGenreName)) continue;

      const yt = await searchYouTube(`${song.artist} ${song.title} official`, 1);
      for (const t of yt) {
        if (seen.has(t.youtubeId)) continue;
        const resolved: StationTrack = { ...t, artist: song.artist, title: song.title };
        if (!trackMatchesGenre(resolved, station, song.primaryGenreName)) continue;
        seen.add(t.youtubeId);
        if (song.primaryGenreName) genreByTrack.set(t.youtubeId, song.primaryGenreName);
        tracks.push(resolved);
      }
    }
  }

  return filterTracksByGenre(tracks, station, genreByTrack).slice(0, 20);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const stationId = searchParams.get("stationId")?.trim();
  const exclude = searchParams.get("exclude")?.split(",").filter(Boolean) ?? [];

  if (!stationId) {
    return NextResponse.json({ error: "stationId is required" }, { status: 400 });
  }

  const station = getStationById(stationId);
  if (!station) {
    return NextResponse.json({ error: "Station not found" }, { status: 404 });
  }

  const excludeSet = new Set(exclude);
  let tracks = await fetchGenreTracks(station);

  // Same-station curated fallback only — never bleed across genres/categories
  if (tracks.length === 0) {
    tracks = station.tracks.filter((t) => !excludeSet.has(t.youtubeId));
  }

  tracks = tracks.filter((t) => !excludeSet.has(t.youtubeId));

  return NextResponse.json({ tracks });
}

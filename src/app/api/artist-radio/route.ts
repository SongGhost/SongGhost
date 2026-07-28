import { NextResponse } from "next/server";

import {

  buildArtistRadioResult,

  findTracksInLibrary,

  type ArtistRadioResult,

} from "@/lib/artist-radio";

import { searchITunesSongs } from "@/lib/itunes";

import type { StationTrack } from "@/data/stations";



type YouTubeSearchItem = {

  id: { videoId: string };

  snippet: {

    title: string;

    channelTitle: string;

  };

};



async function searchYouTubeForTrack(artist: string, title: string): Promise<string | null> {

  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) return null;



  const query = encodeURIComponent(`${artist} ${title} official`);

  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=1&order=relevance&q=${query}&key=${apiKey}`;



  const res = await fetch(url, { next: { revalidate: 3600 } });

  if (!res.ok) return null;



  const data = (await res.json()) as { items?: YouTubeSearchItem[] };

  return data.items?.[0]?.id?.videoId ?? null;

}



async function fetchYouTubeArtistTracks(artistName: string): Promise<StationTrack[]> {

  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) return [];



  const query = encodeURIComponent(`${artistName} official music`);

  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=12&order=relevance&q=${query}&key=${apiKey}`;



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

      .replace(/\s*-\s*official.*$/gi, "")

      .trim();



    tracks.push({

      youtubeId: videoId,

      title: title || item.snippet.title,

      artist: artistName,

    });

  }



  return tracks;

}



async function fetchITunesArtistTracks(artistName: string): Promise<StationTrack[]> {

  const songs = await searchITunesSongs(artistName, 25);

  const tracks: StationTrack[] = [];

  const seen = new Set<string>();



  for (const song of songs) {

    let youtubeId: string | null = null;



    const libraryMatch = findTracksInLibrary(song.artist).find(

      (t) =>

        t.title.toLowerCase().includes(song.title.toLowerCase().slice(0, 8)) ||

        song.title.toLowerCase().includes(t.title.toLowerCase().slice(0, 8)),

    );

    if (libraryMatch) {

      youtubeId = libraryMatch.youtubeId;

    } else {

      youtubeId = await searchYouTubeForTrack(song.artist, song.title);

    }



    if (!youtubeId || seen.has(youtubeId)) continue;

    seen.add(youtubeId);

    tracks.push({ youtubeId, title: song.title, artist: song.artist });

  }



  return tracks;

}



export async function GET(request: Request) {

  const { searchParams } = new URL(request.url);

  const artist = searchParams.get("artist")?.trim();



  if (!artist) {

    return NextResponse.json({ error: "artist query parameter is required" }, { status: 400 });

  }



  let tracks = await fetchYouTubeArtistTracks(artist);

  // Fall back to iTunes when YouTube key is missing, request fails, or returns no results
  if (tracks.length === 0) {
    tracks = await fetchITunesArtistTracks(artist);
  }



  if (tracks.length === 0) {

    tracks = findTracksInLibrary(artist);

  }



  if (tracks.length === 0) {

    return NextResponse.json(

      {

        error: `No tracks found for "${artist}". Try another artist name.`,

      },

      { status: 404 },

    );

  }



  const result: ArtistRadioResult = buildArtistRadioResult(artist, tracks);

  return NextResponse.json(result);

}


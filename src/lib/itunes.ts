import type { StationTrack } from "@/data/stations";

type ITunesArtistResult = {
  artistName: string;
};

type ITunesSongResult = {
  trackName: string;
  artistName: string;
  trackId: number;
  primaryGenreName?: string;
};

export type ITunesSong = {
  title: string;
  artist: string;
  primaryGenreName?: string;
};

export async function searchITunesArtists(term: string, limit = 8): Promise<string[]> {
  const query = encodeURIComponent(term);
  const url = `https://itunes.apple.com/search?term=${query}&entity=musicArtist&limit=${limit}`;

  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) return [];

  const data = (await res.json()) as { results?: ITunesArtistResult[] };
  const seen = new Set<string>();
  const artists: string[] = [];

  for (const item of data.results ?? []) {
    const name = item.artistName?.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    artists.push(name);
  }

  return artists;
}

export async function searchITunesSongs(artist: string, limit = 25): Promise<ITunesSong[]> {
  const query = encodeURIComponent(artist);
  const url = `https://itunes.apple.com/search?term=${query}&entity=song&limit=${limit}`;

  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) return [];

  const data = (await res.json()) as { results?: ITunesSongResult[] };
  const seen = new Set<string>();
  const songs: ITunesSong[] = [];

  for (const item of data.results ?? []) {
    const title = item.trackName?.trim();
    const artistName = item.artistName?.trim();
    if (!title || !artistName) continue;

    const key = `${artistName.toLowerCase()}::${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    songs.push({
      title,
      artist: artistName,
      primaryGenreName: item.primaryGenreName?.trim(),
    });
  }

  return songs;
}

export function itunesSongsToStationTracks(
  songs: { title: string; artist: string }[],
  youtubeIds: Map<string, string>,
): StationTrack[] {
  const tracks: StationTrack[] = [];
  const seen = new Set<string>();

  for (const song of songs) {
    const key = `${song.artist.toLowerCase()}::${song.title.toLowerCase()}`;
    const youtubeId = youtubeIds.get(key);
    if (!youtubeId || seen.has(youtubeId)) continue;
    seen.add(youtubeId);
    tracks.push({ youtubeId, title: song.title, artist: song.artist });
  }

  return tracks;
}

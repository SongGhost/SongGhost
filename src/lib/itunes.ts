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
  const url = `https://itunes.apple.com/search?term=${query}&entity=song&limit=${Math.min(limit, 50)}`;

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

export async function searchITunesGenreSongs(term: string, limit = 50): Promise<ITunesSong[]> {
  const query = encodeURIComponent(term);
  const url = `https://itunes.apple.com/search?term=${query}&entity=song&limit=${Math.min(limit, 200)}`;

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

  return songs.slice(0, limit);
}

export async function findITunesArtist(query: string): Promise<string | null> {
  const artists = await searchITunesArtists(query, 12);
  if (!artists.length) return null;

  const norm = query.toLowerCase().trim();
  return (
    artists.find((a) => a.toLowerCase() === norm) ??
    artists.find((a) => a.toLowerCase().includes(norm) || norm.includes(a.toLowerCase())) ??
    artists[0]
  );
}

export async function searchSongsByArtist(artistName: string, limit = 25): Promise<ITunesSong[]> {
  const songs = await searchITunesSongs(artistName, 50);
  const norm = artistName.toLowerCase().trim();

  return songs
    .filter((song) => {
      const artist = song.artist.toLowerCase();
      return artist === norm || artist.includes(norm) || norm.includes(artist);
    })
    .slice(0, limit);
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

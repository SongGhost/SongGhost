/** Track hit from `GET /api/search` (Spotify, with iTunes fallback). */
export type SearchTrackResult = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  durationSec?: number;
  previewUrl?: string;
  spotifyId?: string;
};

/** Artist hit from `GET /api/search`. */
export type SearchArtistResult = {
  id: string;
  name: string;
  imageUrl?: string;
  genres?: string[];
  spotifyId?: string;
};

/** Album hit from `GET /api/search`. */
export type SearchAlbumResult = {
  id: string;
  title: string;
  artist: string;
  artworkUrl?: string;
  releaseYear?: number | null;
  trackCount?: number | null;
  spotifyId?: string;
};

export type SearchEntityType = "track" | "artist" | "album";

/** Categorized payload from `GET /api/search`. */
export type SmartSearchResponse = {
  tracks: SearchTrackResult[];
  artists: SearchArtistResult[];
  albums: SearchAlbumResult[];
  source?: "spotify" | "itunes";
};

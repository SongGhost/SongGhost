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

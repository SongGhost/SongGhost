/**
 * The playlist on screen is the playlist that plays.
 * Copy only — never shuffle, rotate, or swap in a second build.
 */
export function orderedPlaylistSnapshot<T>(tracks: readonly T[]): T[] {
  return tracks.slice();
}

export type PlaylistRow = {
  title?: string;
  artist?: string;
  youtubeId?: string;
  spotifyId?: string;
  itunesTrackId?: string | number;
  streamUrl?: string;
};

/** Title, artist, and id as shown on the row. */
export function playlistRowId(track: PlaylistRow): string {
  return [
    track.youtubeId?.trim() || "",
    track.spotifyId?.trim() || "",
    track.itunesTrackId != null ? String(track.itunesTrackId) : "",
    track.streamUrl?.trim() || "",
    (track.artist ?? "").trim(),
    (track.title ?? "").trim(),
  ].join("|");
}

export function samePlaylistOrder(
  shown: readonly PlaylistRow[],
  playing: readonly PlaylistRow[],
): boolean {
  if (shown.length !== playing.length) return false;
  return shown.every((row, index) => playlistRowId(row) === playlistRowId(playing[index]!));
}

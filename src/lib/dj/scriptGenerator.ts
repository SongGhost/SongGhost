/**
 * Fast, non-LLM station-launch liners.
 *
 * Track #0 openings skip the slow generate-script LLM path and feed one of
 * these templates straight to TTS via `/api/generate-script` `customText`.
 */

/** Swell music from the launch duck floor back to full after the liner ends. */
export const STATION_LAUNCH_RESTORE_MS = 600;

type LaunchLinerTemplate = (
  stationName: string,
  artist: string,
  title: string,
) => string;

const STATION_LAUNCH_LINERS: readonly LaunchLinerTemplate[] = [
  (stationName, artist, title) =>
    `Welcome to ${stationName}. Up first, here's ${title} by ${artist}.`,
  (stationName, artist, title) =>
    `You're locked into ${stationName}. Kicking things off with ${title} by ${artist}.`,
  (stationName, artist, title) =>
    `${stationName} is on the air. First up — ${title} by ${artist}.`,
  (stationName, artist, title) =>
    `Thanks for tuning in to ${stationName}. Here's ${artist} with ${title}.`,
];

/**
 * Pick a short station-launch liner. Rotates randomly across the template set
 * so reopenings don't feel canned.
 */
export function getStationLaunchLiner(
  stationName: string,
  artist: string,
  title: string,
): string {
  const name = stationName.trim() || "SongHost Radio";
  const trackArtist = artist.trim() || "the artist";
  const trackTitle = title.trim() || "this one";
  const index = Math.floor(Math.random() * STATION_LAUNCH_LINERS.length);
  const template = STATION_LAUNCH_LINERS[index] ?? STATION_LAUNCH_LINERS[0];
  return template(name, trackArtist, trackTitle);
}

/**
 * Vocal-protection gate for Track #0 launch breaks.
 *
 * - Playhead still at 0:00 → assume lead vocals may start immediately; pause.
 * - Playhead already into the bed → treat as an instrumental intro and duck.
 */
export function shouldPauseForStationLaunchVocals(positionMs: number): boolean {
  return !Number.isFinite(positionMs) || positionMs <= 0;
}

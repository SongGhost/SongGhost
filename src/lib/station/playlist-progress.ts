/**
 * What the playlist window shows while a station hour is being built.
 * Stages come from the catalog build. The fun lines rotate on the client.
 */

export type PlaylistBuildStage = "lineup" | "songs" | "polish" | "ready" | "error";

export type PlaylistBuildUpdate = {
  stage: PlaylistBuildStage;
  songs: number;
};

export const PLAYLIST_BUILD_LINES = [
  "Dusting off the crates.",
  "Finding songs that belong in the same room.",
  "Checking the year so the era stays honest.",
  "This hour is going to feel like a good drive.",
  "Pulling records a fan of this lane would actually play.",
  "No filler. Just the good ones.",
  "Lining them up so the handoff feels right.",
  "The host is going to have a lot to talk about.",
  "Sorting the deep cuts from the obvious ones.",
  "Making sure the first song earns the dial.",
  "This station is getting a proper stack.",
  "Warming up the turntables.",
  "One more pass so the same artist does not crowd the hour.",
  "Building you an hour, not a shuffle button.",
  "The playlist is taking shape.",
  "Almost a show. Hang on.",
] as const;

/** Shuffle once per open so the lines do not play in the same order every time. */
export function shufflePlaylistLines(seed: number): string[] {
  const lines = [...PLAYLIST_BUILD_LINES];
  let state = seed >>> 0 || 1;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  for (let index = lines.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1));
    const current = lines[index];
    lines[index] = lines[swap] ?? current;
    lines[swap] = current;
  }
  return lines;
}

export function playlistStageCopy(stage: PlaylistBuildStage, songs: number): string {
  if (stage === "polish" || stage === "ready") return "Putting the hour in order";
  if (stage === "songs") {
    if (songs <= 0) return "Collecting songs";
    return songs === 1 ? "1 song collected" : `${songs} songs collected`;
  }
  if (stage === "error") return "That hour did not come together";
  return "Picking who belongs here";
}

/** Bar position from the real stage. Song count moves it. It holds short of full until the hour is finished. */
export function playlistBarPercent(stage: PlaylistBuildStage, songs: number): number {
  if (stage === "ready") return 100;
  if (stage === "polish") return 94;
  if (stage === "songs") return Math.min(88, 22 + Math.max(0, songs) * 3);
  if (stage === "error") return 8;
  return 14;
}

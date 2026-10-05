/**
 * Who is allowed to start music.
 *
 * Refresh may show the last station. It is not Play.
 * Pause stays paused until the listener hits Play or Next, or picks a new station.
 * Host handoff, stall recovery, video load, and two-ahead warmup are not Play.
 */
export type MusicStartReason =
  | "user-play"
  | "user-next"
  | "new-station"
  | "hydrate"
  | "host-release"
  | "stall-recovery"
  | "load-video"
  | "ensure-playback"
  | "two-ahead";

export function mayStartMusic(input: {
  reason: MusicStartReason;
  /** Listener hit Pause. Only Play, Next, or a new station may clear this. */
  listenerPaused: boolean;
  /** True after Play, Next, or a card/station launch that means Play. */
  userAskedToPlay: boolean;
}): boolean {
  switch (input.reason) {
    case "hydrate":
    case "two-ahead":
    case "load-video":
    case "ensure-playback":
      return false;
    case "user-play":
    case "user-next":
    case "new-station":
      return true;
    case "host-release":
    case "stall-recovery":
      return input.userAskedToPlay && !input.listenerPaused;
    default:
      return false;
  }
}

/** Deck copy when a chosen station has nothing to play. The old song stays off. */
export function emptyPlaylistNotice(stationName: string): {
  title: string;
  detail: string;
} {
  const name = stationName.trim() || "that station";
  return {
    title: `Couldn't start ${name}`,
    detail: "No songs turned up. Nothing is playing.",
  };
}

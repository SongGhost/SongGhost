/** Deck copy while a station is handing off and no new track is on air yet. */
export const TUNING_IN_TITLE = "Tuning in…";

const READY_TITLE = "Ready to Tune In";
const IDLE_ARTIST = "Select a station or search...";

function isIdlePlaceholder(title: string, idle?: boolean): boolean {
  const trimmed = title.trim();
  return Boolean(idle) || !trimmed || trimmed === READY_TITLE;
}

/**
 * What the deck title should say.
 * "Tuning in…" is a handoff, not a cue to keep the previous song's title.
 */
export function shownDeckTitle(input: {
  title: string;
  idle?: boolean;
  djBreakActive?: boolean;
  isSpotifySyncPending?: boolean;
  orchestratorTitle?: string | null;
}): string {
  const trimmed = input.title.trim();
  if (input.isSpotifySyncPending) return TUNING_IN_TITLE;
  if (input.djBreakActive) return input.title;
  if (trimmed === TUNING_IN_TITLE) return TUNING_IN_TITLE;
  if (isIdlePlaceholder(input.title, input.idle)) {
    return input.orchestratorTitle?.trim() || trimmed || READY_TITLE;
  }
  return trimmed;
}

/** Artist line under the deck title. A handoff keeps the line we set, not the last song. */
export function shownDeckArtist(input: {
  artist: string;
  title: string;
  idle?: boolean;
  djBreakActive?: boolean;
  isSpotifySyncPending?: boolean;
  stationName?: string;
  orchestratorArtist?: string | null;
}): string {
  const trimmedArtist = input.artist.trim();
  if (input.isSpotifySyncPending) {
    return input.stationName?.trim() || TUNING_IN_TITLE;
  }
  if (input.djBreakActive) return input.artist;
  if (input.title.trim() === TUNING_IN_TITLE) {
    return trimmedArtist || "Artist Radio";
  }
  if (isIdlePlaceholder(input.title, input.idle)) {
    return input.orchestratorArtist?.trim() || trimmedArtist || IDLE_ARTIST;
  }
  return trimmedArtist || input.orchestratorArtist?.trim() || IDLE_ARTIST;
}

/** Cover art. A handoff does not keep the previous song's picture. */
export function shownDeckArt(input: {
  title: string;
  albumArt?: string;
  idle?: boolean;
  isSpotifySyncPending?: boolean;
  orchestratorArt?: string | null;
}): string {
  if (input.isSpotifySyncPending) return "";
  const propArt = (input.albumArt ?? "").trim();
  if (input.title.trim() === TUNING_IN_TITLE) return propArt;
  if (isIdlePlaceholder(input.title, input.idle)) {
    return (input.orchestratorArt ?? "").trim() || propArt;
  }
  return propArt || (input.orchestratorArt ?? "").trim();
}

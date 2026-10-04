/**
 * Song 1 station welcome on the New engine.
 * A stall skip or a station change can abort the liner before any song
 * is actually playing. That does not spend the welcome. The first track
 * that plays still gets it once. Music Only never gets it. A welcome that
 * already aired is not spoken again.
 */

const KEEPS_WELCOME = new Set([
  "stall_skip",
  "station_change",
  "track_change",
  "superseded",
  "queue_advance",
]);

export function openingWelcomeStillOwed(input: {
  engine: string;
  hostOn: boolean;
  welcomeAired: boolean;
  abortReason: string | null;
}): boolean {
  if (input.engine !== "new") return false;
  if (!input.hostOn) return false;
  if (input.welcomeAired) return false;
  if (!input.abortReason) return false;
  return KEEPS_WELCOME.has(input.abortReason);
}

/** Reason passed to AbortController.abort, or null when this attempt was not aborted. */
export function readAbortReason(signal: AbortSignal): string | null {
  if (!signal.aborted) return null;
  const reason = signal.reason;
  if (typeof reason === "string" && reason.trim()) return reason;
  return "superseded";
}

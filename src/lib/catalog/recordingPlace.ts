/**
 * A recording place is a studio, or it is a live room.
 * New speech may say "recorded at" only for a studio.
 * An arena, hall, or concert venue is a different fact, and this pass
 * does not speak it as the place a studio album was recorded.
 */

const VENUE_NAME =
  /\b(?:arena|stadium|theatre|theater|amphitheatre|amphitheater|ballroom|auditorium|coliseum|colosseum|pavilion|hippodrome|palladium|zenith|z[eé]nith|palais|hall|garden|bowl|dome|forum|nightclub|playhouse|opera house|concert hall|music hall|indoor arena)\b/i;

const LIVE_PREFIX = /^(?:live\s+at|recorded\s+live\s+at)\b/i;

/** True when this name is a concert place, not a studio. */
export function isLiveVenueName(name: string): boolean {
  const clean = name.replace(/\s+/g, " ").trim();
  if (!clean) return false;
  if (LIVE_PREFIX.test(clean)) return true;
  if (/\bstudios?\b/i.test(clean) && !VENUE_NAME.test(clean)) return false;
  return VENUE_NAME.test(clean);
}

/**
 * MusicBrainz "recorded at" may point at a studio or a concert place.
 * Only a studio place may be spoken as "recorded at".
 * A live attribute, or a place type other than Studio, is not a studio.
 * When the type is missing, the name itself has to say studio.
 */
export function isStudioRecordingPlace(place: {
  name?: string;
  type?: string;
  attributes?: readonly string[];
}): boolean {
  const attributes = (place.attributes ?? []).map((value) => value.trim().toLowerCase());
  if (attributes.includes("live")) return false;
  const name = place.name?.replace(/\s+/g, " ").trim() ?? "";
  if (!name || isLiveVenueName(name)) return false;
  const type = place.type?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
  if (type === "studio") return true;
  if (type) return false;
  return /\bstudios?\b/i.test(name);
}

import { isLikelyRadioTrack } from "@/lib/station-genre-profiles";

/** Radio singles: reject shorts and longform dumps. */
export const MIN_TRACK_DURATION_SEC = 90;
export const MAX_TRACK_DURATION_SEC = 600;

/**
 * Case-insensitive substrings that mark album dumps, mixes, and hour-long
 * streams rather than individual radio tracks.
 */
export const CATALOG_TITLE_BLACKLIST = [
  "full album",
  "compilation",
  "greatest hits",
  "megamix",
  "1 hour",
  "2 hour",
  "3 hour",
  "10 hours",
  "discography",
  "best of mix",
] as const;

const ARTIST_RADIO_JUNK_PATTERN =
  /\b(karaoke|cover version|cover of|tribute to|in the style of|8d audio|slowed.?reverb|bass boosted|nightcore|lyrics? video|fan made|fanmade|reaction video|how to play|tutorial|instrumental cover|piano cover|guitar cover|acoustic cover|remix|reupload|extended version|1 hour|2 hour|3 hour|full concert|bootleg)\b/i;

export function normalizeArtistName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function artistNamesMatch(songArtist: string, queryArtist: string): boolean {
  const a = normalizeArtistName(songArtist);
  const b = normalizeArtistName(queryArtist);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.startsWith(`${b} `) || b.startsWith(`${a} `)) return true;
  if (a.startsWith(`${b} feat`) || a.startsWith(`${b},`)) return true;
  return false;
}

/** True when the title contains a blacklisted longform/album keyword. */
export function hasBlacklistedTitle(title: string): boolean {
  const haystack = title.toLowerCase();
  return CATALOG_TITLE_BLACKLIST.some((keyword) => haystack.includes(keyword));
}

/**
 * Strict radio duration window. Unknown duration is treated as acceptable so
 * title-only sources can still contribute; callers that have a duration must
 * pass it so longform dumps get rejected.
 */
export function isAcceptableTrackDuration(
  durationSeconds: number | null | undefined,
): boolean {
  if (durationSeconds == null || !Number.isFinite(durationSeconds)) return true;
  return (
    durationSeconds >= MIN_TRACK_DURATION_SEC && durationSeconds <= MAX_TRACK_DURATION_SEC
  );
}

export function durationMsToSeconds(durationMs: number | null | undefined): number | undefined {
  if (durationMs == null || !Number.isFinite(durationMs)) return undefined;
  return durationMs / 1000;
}

/**
 * Shared catalog gate used by iTunes / YouTube candidate pools: title blacklist
 * first, then duration when known.
 */
export function isAcceptableCatalogTrack(track: {
  title: string;
  durationSeconds?: number | null;
  durationMs?: number | null;
}): boolean {
  if (hasBlacklistedTitle(track.title)) return false;
  if (!isLikelyRadioTrack(track.title)) return false;

  const seconds =
    track.durationSeconds ?? durationMsToSeconds(track.durationMs ?? undefined);
  return isAcceptableTrackDuration(seconds);
}

export function isAcceptableArtistRadioTrack(
  title: string,
  duration?: { durationSeconds?: number | null; durationMs?: number | null },
): boolean {
  if (!isAcceptableCatalogTrack({ title, ...duration })) return false;
  return !ARTIST_RADIO_JUNK_PATTERN.test(title);
}

export function trackBelongsToArtist(
  track: { title: string; artist: string },
  artistName: string,
): boolean {
  if (artistNamesMatch(track.artist, artistName)) return true;

  const norm = normalizeArtistName(artistName);
  if (norm.length < 3) return false;

  const haystack = normalizeArtistName(`${track.title} ${track.artist}`);
  return haystack.includes(norm);
}

export function scoreVideoMatch(
  track: { title: string; artist: string },
  artist: string,
  title: string,
): number {
  let score = 0;
  const haystack = `${track.title} ${track.artist}`.toLowerCase();
  const normArtist = normalizeArtistName(artist);
  const normTitle = title.toLowerCase().trim();

  if (normTitle && haystack.includes(normTitle)) score += 4;
  if (normArtist && haystack.includes(normArtist)) score += 4;
  if (artistNamesMatch(track.artist, artist)) score += 3;
  if (/\bofficial\b/i.test(track.title)) score += 2;
  if (/vevo/i.test(track.artist)) score += 2;
  if (/\blive\b/i.test(track.title)) score -= 2;
  if (ARTIST_RADIO_JUNK_PATTERN.test(track.title)) score -= 12;
  if (hasBlacklistedTitle(track.title)) score -= 20;
  if (!isLikelyRadioTrack(track.title)) score -= 8;

  return score;
}

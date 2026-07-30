import { isLikelyRadioTrack } from "@/lib/station-genre-profiles";

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

export function isAcceptableArtistRadioTrack(title: string): boolean {
  if (!isLikelyRadioTrack(title)) return false;
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
  if (!isLikelyRadioTrack(track.title)) score -= 8;

  return score;
}

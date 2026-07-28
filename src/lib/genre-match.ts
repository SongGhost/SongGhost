import type { Station, StationTrack } from "@/data/stations";
import {
  getStationGenreProfile,
  isLikelyRadioTrack,
  itunesGenreMatchesStation,
} from "@/lib/station-genre-profiles";

const STOP_WORDS = new Set([
  "and",
  "the",
  "for",
  "with",
  "from",
  "hits",
  "music",
  "radio",
  "station",
  "classic",
  "sound",
  "sounds",
  "mix",
  "anthems",
  "vibes",
  "era",
  "modern",
  "90s",
  "80s",
  "70s",
  "60s",
]);

/** Build genre keyword profile from station metadata. */
export function getGenreKeywords(station: Station): string[] {
  const parts: string[] = [];
  const profile = getStationGenreProfile(station);

  for (const segment of station.description.split(/[,;&]+/)) {
    const trimmed = segment.trim().toLowerCase();
    if (trimmed.length > 2) parts.push(trimmed);
  }

  for (const word of station.name.toLowerCase().split(/[\s&]+/)) {
    if (word.length > 2 && !STOP_WORDS.has(word)) parts.push(word);
  }

  for (const slug of station.id.split("-")) {
    if (slug.length > 2 && !STOP_WORDS.has(slug)) parts.push(slug);
  }

  for (const term of profile.catalogSearchTerms) {
    parts.push(term.toLowerCase());
  }

  return [...new Set(parts)];
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function sharesRoot(a: string, b: string): boolean {
  const minLen = 4;
  if (a.length < minLen || b.length < minLen) return false;
  return a.slice(0, minLen) === b.slice(0, minLen);
}

/** Returns true when a track plausibly belongs to the active station genre profile. */
export function trackMatchesGenre(
  track: StationTrack,
  station: Station,
  itunesGenre?: string,
): boolean {
  if (!isLikelyRadioTrack(track.title)) return false;

  const profile = getStationGenreProfile(station);

  if (itunesGenre && profile.acceptedItunesGenres.length) {
    if (itunesGenreMatchesStation(itunesGenre, profile)) return true;
  }

  const anchorMatch = profile.anchorArtists.some((artist) => {
    const a = normalize(artist);
    const hay = normalize(track.artist);
    return hay.includes(a) || a.includes(hay);
  });
  if (anchorMatch) return true;

  const keywords = getGenreKeywords(station);
  const haystack = normalize(`${track.title} ${track.artist}`);

  if (keywords.some((kw) => haystack.includes(kw) || kw.includes(haystack.slice(0, 12)))) {
    return true;
  }

  if (itunesGenre) {
    const genreNorm = normalize(itunesGenre);
    return keywords.some(
      (kw) => genreNorm.includes(kw) || kw.includes(genreNorm) || sharesRoot(kw, genreNorm),
    );
  }

  return profile.acceptedItunesGenres.length === 0;
}

/** Filter tracks to only those matching the station genre profile. */
export function filterTracksByGenre<T extends StationTrack>(
  tracks: T[],
  station: Station,
  genreByTrack?: Map<string, string>,
): T[] {
  return tracks.filter((track) => {
    const itunesGenre = genreByTrack?.get(track.youtubeId);
    return trackMatchesGenre(track, station, itunesGenre);
  });
}

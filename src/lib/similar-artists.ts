import { ALTERNATIVE_ROCK_SEED_ARTISTS } from "@/data/presetStations";
import {
  fetchLastFmSimilarArtists,
  fetchLastFmSimilarArtistsScored,
  isLastFmConfigured,
} from "@/lib/catalog/lastfm";
import type { StationGenreProfile } from "@/lib/station-genre-profiles";
import { normalizeArtistName } from "@/lib/track-quality";

/** Curated co-anchor lists — only used when the searched artist appears in a profile. */
const ANCHOR_PROFILES: StationGenreProfile[] = [
  {
    acceptedItunesGenres: [],
    catalogSearchTerms: [],
    anchorArtists: [
      "The National",
      "Arcade Fire",
      "Interpol",
      "The Strokes",
      "Vampire Weekend",
      "Bon Iver",
      "Modest Mouse",
      "Death Cab for Cutie",
      "The Killers",
      "Radiohead",
    ],
    catalogDepth: 150,
  },
  {
    acceptedItunesGenres: [],
    catalogSearchTerms: [],
    anchorArtists: [...ALTERNATIVE_ROCK_SEED_ARTISTS],
    catalogDepth: 200,
  },
  {
    acceptedItunesGenres: [],
    catalogSearchTerms: [],
    anchorArtists: ["Nirvana", "Pearl Jam", "Soundgarden", "Alice in Chains", "Mudhoney"],
    catalogDepth: 150,
  },
  {
    acceptedItunesGenres: [],
    catalogSearchTerms: [],
    anchorArtists: ["Queen", "Led Zeppelin", "Eagles", "Aerosmith", "Fleetwood Mac"],
    catalogDepth: 200,
  },
  {
    acceptedItunesGenres: [],
    catalogSearchTerms: [],
    anchorArtists: ["Tupac", "The Notorious B.I.G.", "Nas", "Wu-Tang Clan", "Outkast"],
    catalogDepth: 200,
  },
  {
    acceptedItunesGenres: [],
    catalogSearchTerms: [],
    anchorArtists: ["Madonna", "Prince", "Duran Duran", "Depeche Mode", "A-ha"],
    catalogDepth: 200,
  },
  {
    acceptedItunesGenres: [],
    catalogSearchTerms: [],
    anchorArtists: ["Joy Division", "New Order", "The Cure", "Depeche Mode", "Talking Heads"],
    catalogDepth: 150,
  },
  {
    acceptedItunesGenres: [],
    catalogSearchTerms: [],
    anchorArtists: ["Miles Davis", "Dave Brubeck", "Norah Jones", "Diana Krall"],
    catalogDepth: 120,
  },
  {
    acceptedItunesGenres: [],
    catalogSearchTerms: [],
    anchorArtists: ["Johnny Cash", "Dolly Parton", "Willie Nelson", "Garth Brooks"],
    catalogDepth: 200,
  },
];

function dedupeArtists(artists: string[], excludeArtist: string, limit: number): string[] {
  const exclude = normalizeArtistName(excludeArtist);
  const seen = new Set<string>();
  const out: string[] = [];

  for (const artist of artists) {
    const name = artist.trim();
    if (!name) continue;
    const norm = normalizeArtistName(name);
    if (norm === exclude || seen.has(norm)) continue;
    seen.add(norm);
    out.push(name);
    if (out.length >= limit) break;
  }

  return out;
}

function artistMatchesAnchor(artistName: string, anchor: string): boolean {
  const a = normalizeArtistName(artistName);
  const b = normalizeArtistName(anchor);
  return a === b;
}

/** Only suggest co-anchors when the searched artist is explicitly in a curated profile. */
function findProfileSimilarArtists(artistName: string, limit: number): string[] {
  for (const profile of ANCHOR_PROFILES) {
    const isMember = profile.anchorArtists.some((anchor) => artistMatchesAnchor(artistName, anchor));
    if (!isMember) continue;

    return dedupeArtists(profile.anchorArtists, artistName, limit);
  }

  return [];
}

export { isLastFmConfigured };

function profileSimilarArtistsScored(
  artistName: string,
  limit: number,
): { name: string; match: number }[] {
  return findProfileSimilarArtists(artistName, limit).map((name) => ({
    name,
    match: 1.0,
  }));
}

/**
 * Last.fm similar artists with match scores, filtered to a real connection
 * (`match >= matchThreshold`). Falls back to curated co-anchors (match 1.0)
 * when Last.fm is not configured or returns nothing.
 */
export async function fetchSimilarArtistsScored(
  artistName: string,
  limit = 12,
  matchThreshold = 0.4,
): Promise<{ name: string; match: number }[]> {
  if (!isLastFmConfigured()) {
    return profileSimilarArtistsScored(artistName, limit);
  }

  const pull = matchThreshold > 0 ? Math.max(limit * 2, limit) : limit;
  const scored = await fetchLastFmSimilarArtistsScored(artistName, pull);
  if (scored.length === 0) {
    return profileSimilarArtistsScored(artistName, limit);
  }

  const passing = scored.filter((item) => item.match >= matchThreshold);
  const names = dedupeArtists(
    passing.map((item) => item.name),
    artistName,
    limit,
  );
  const matchByName = new Map<string, number>();
  for (const item of passing) {
    const key = normalizeArtistName(item.name);
    if (!matchByName.has(key)) matchByName.set(key, item.match);
  }
  return names.map((name) => ({
    name,
    match: matchByName.get(normalizeArtistName(name)) ?? 1.0,
  }));
}

/** Last.fm when configured; otherwise co-anchors from a curated profile (if the artist is listed). */
export async function fetchSimilarArtists(artistName: string, limit = 6): Promise<string[]> {
  const lastFm = await fetchLastFmSimilarArtists(artistName, limit);
  if (lastFm.length > 0) return lastFm;

  return findProfileSimilarArtists(artistName, limit);
}

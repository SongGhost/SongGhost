import { ALTERNATIVE_ROCK_SEED_ARTISTS } from "@/data/presetStations";
import type { StationGenreProfile } from "@/lib/station-genre-profiles";
import { normalizeArtistName } from "@/lib/track-quality";

type LastFmSimilarArtist = {
  name?: string;
};

type LastFmSimilarResponse = {
  error?: number;
  message?: string;
  similarartists?: {
    artist?: LastFmSimilarArtist | LastFmSimilarArtist[];
  };
};

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

async function fetchLastFmSimilarArtists(artistName: string, limit: number): Promise<string[]> {
  const apiKey = process.env.LASTFM_API_KEY?.trim();
  if (!apiKey) return [];

  const params = new URLSearchParams({
    method: "artist.getsimilar",
    artist: artistName,
    api_key: apiKey,
    format: "json",
    limit: String(Math.min(limit * 2, 20)),
    autocorrect: "1",
  });

  try {
    const res = await fetch(`https://ws.audioscrobbler.com/2.0/?${params.toString()}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];

    const data = (await res.json()) as LastFmSimilarResponse;
    if (data.error) {
      console.warn("[similar-artists] Last.fm error:", data.message ?? data.error);
      return [];
    }

    const raw = data.similarartists?.artist;
    const artists = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return dedupeArtists(
      artists.map((item) => item.name ?? "").filter(Boolean),
      artistName,
      limit,
    );
  } catch (error) {
    console.warn("[similar-artists] Last.fm request failed:", error);
    return [];
  }
}

export function isLastFmConfigured(): boolean {
  return Boolean(process.env.LASTFM_API_KEY?.trim());
}

/** Last.fm when configured; otherwise co-anchors from a curated profile (if the artist is listed). */
export async function fetchSimilarArtists(artistName: string, limit = 6): Promise<string[]> {
  const lastFm = await fetchLastFmSimilarArtists(artistName, limit);
  if (lastFm.length > 0) return lastFm;

  return findProfileSimilarArtists(artistName, limit);
}

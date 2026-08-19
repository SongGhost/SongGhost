import { ALTERNATIVE_ROCK_SEED_ARTISTS } from "@/data/presetStations";
import type { Station } from "@/data/stations";
import { normalizeSeedList } from "@/lib/station/blueprint";

export type StationGenreProfile = {
  acceptedItunesGenres: string[];
  catalogSearchTerms: string[];
  anchorArtists: string[];
  catalogDepth: number;
};

const DEFAULT_PROFILE: Omit<StationGenreProfile, "catalogSearchTerms" | "anchorArtists"> = {
  acceptedItunesGenres: [],
  catalogDepth: 120,
};

const PROFILES: Record<string, StationGenreProfile> = {
  "alternative-rock": {
    acceptedItunesGenres: ["Alternative", "Rock", "Grunge", "Indie Rock", "Alternative Rock"],
    catalogSearchTerms: ["90s alternative rock", "modern alternative rock", "grunge rock"],
    anchorArtists: [...ALTERNATIVE_ROCK_SEED_ARTISTS],
    catalogDepth: 200,
  },
  "seattle-grunge": {
    acceptedItunesGenres: ["Grunge", "Alternative", "Rock"],
    catalogSearchTerms: ["seattle grunge", "90s grunge"],
    anchorArtists: ["Nirvana", "Pearl Jam", "Soundgarden", "Alice in Chains", "Mudhoney"],
    catalogDepth: 150,
  },
  "60s-psychedelic": {
    acceptedItunesGenres: ["Rock", "Psychedelic", "Classic Rock", "Pop"],
    catalogSearchTerms: ["60s psychedelic rock", "flower power"],
    anchorArtists: ["The Jimi Hendrix Experience", "The Doors", "Jefferson Airplane", "The Mamas & The Papas"],
    catalogDepth: 150,
  },
  "70s-classic-rock": {
    acceptedItunesGenres: ["Rock", "Classic Rock", "Hard Rock", "Arena Rock"],
    catalogSearchTerms: ["70s classic rock", "arena rock"],
    anchorArtists: ["Queen", "Led Zeppelin", "Eagles", "Aerosmith", "Fleetwood Mac"],
    catalogDepth: 200,
  },
  "90s-hip-hop": {
    acceptedItunesGenres: ["Hip-Hop", "Rap", "East Coast Rap", "West Coast Rap"],
    catalogSearchTerms: ["90s hip hop", "golden age hip hop"],
    anchorArtists: ["Tupac", "The Notorious B.I.G.", "Nas", "Wu-Tang Clan", "Outkast"],
    catalogDepth: 200,
  },
  "80s-pop-synth": {
    acceptedItunesGenres: ["Pop", "New Wave", "Synth Pop", "Dance"],
    catalogSearchTerms: ["80s pop", "new wave synth"],
    anchorArtists: ["Madonna", "Prince", "Duran Duran", "Depeche Mode", "A-ha"],
    catalogDepth: 200,
  },
  "new-wave-post-punk": {
    acceptedItunesGenres: ["New Wave", "Post-Punk", "Alternative", "Rock"],
    catalogSearchTerms: ["new wave post punk", "80s new wave"],
    anchorArtists: ["Joy Division", "New Order", "The Cure", "Depeche Mode", "Talking Heads"],
    catalogDepth: 150,
  },
  "smooth-jazz": {
    acceptedItunesGenres: ["Jazz", "Smooth Jazz", "Vocal Jazz"],
    catalogSearchTerms: ["smooth jazz", "jazz standards"],
    anchorArtists: ["Miles Davis", "Dave Brubeck", "Norah Jones", "Diana Krall"],
    catalogDepth: 120,
  },
  "country-gold": {
    acceptedItunesGenres: ["Country", "Americana", "Bluegrass"],
    catalogSearchTerms: ["classic country", "country hits"],
    anchorArtists: ["Johnny Cash", "Dolly Parton", "Willie Nelson", "Garth Brooks"],
    catalogDepth: 200,
  },
  "lofi-chillhop": {
    acceptedItunesGenres: ["Hip-Hop", "Electronic", "Jazz", "Instrumental"],
    catalogSearchTerms: ["lofi hip hop", "chillhop beats"],
    anchorArtists: ["Nujabes", "J Dilla", "Idealism", "Kupla"],
    catalogDepth: 100,
  },
  "cyberpunk-synthwave": {
    acceptedItunesGenres: ["Electronic", "Dance", "Synth Pop"],
    catalogSearchTerms: ["synthwave", "retrowave"],
    anchorArtists: ["Kavinsky", "M83", "Carpenter Brut", "Perturbator"],
    catalogDepth: 120,
  },
};

export function getStationGenreProfile(station: Station): StationGenreProfile {
  const specific = PROFILES[station.id];
  const seedArtists = normalizeSeedList(station.seedArtists);
  const seedGenres = normalizeSeedList(station.seedGenres);
  const catalogDepth =
    typeof station.catalogDepth === "number" && Number.isFinite(station.catalogDepth)
      ? Math.max(60, Math.round((station.catalogDepth / 100) * 200))
      : undefined;

  if (specific) {
    return {
      ...specific,
      catalogDepth: catalogDepth ?? specific.catalogDepth,
      catalogSearchTerms: seedGenres.length
        ? [...seedGenres, ...specific.catalogSearchTerms]
        : specific.catalogSearchTerms,
      anchorArtists: seedArtists.length ? seedArtists : specific.anchorArtists,
    };
  }

  const fromTracks = [...new Set(station.tracks.map((t) => t.artist).filter(Boolean))];
  return {
    ...DEFAULT_PROFILE,
    catalogDepth: catalogDepth ?? DEFAULT_PROFILE.catalogDepth,
    catalogSearchTerms: [
      ...seedGenres,
      station.name,
      ...station.description.split(/[,;&]+/).map((s) => s.trim()),
    ].filter((s) => s.length > 2),
    // Deep seed pools carry several tracks per artist; each anchor costs a
    // catalog search, so the same name must not buy two of them.
    anchorArtists: seedArtists.length ? seedArtists : fromTracks,
  };
}

export function itunesGenreMatchesStation(genre: string, profile: StationGenreProfile): boolean {
  if (!profile.acceptedItunesGenres.length) return true;
  const norm = genre.toLowerCase();
  return profile.acceptedItunesGenres.some((accepted) => {
    const a = accepted.toLowerCase();
    return norm.includes(a) || a.includes(norm);
  });
}

const JUNK_TITLE_PATTERN =
  /\b(full album|compilation|greatest hits|megamix|1 hour|2 hour|3 hour|10 hours|discography|best of mix|mix|playlist|hour|hours|meditation|sleep|study|lofi radio|live stream)\b/i;

export function isLikelyRadioTrack(title: string): boolean {
  return !JUNK_TITLE_PATTERN.test(title);
}

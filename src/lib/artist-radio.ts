import type { PersonaId } from "@/data/personas";
import { STATIONS, type Station, type StationTrack } from "@/data/stations";

export type ArtistRadioMode = "artist-only" | "mixed";

export type ArtistRadioResult = {
  artistName: string;
  mode: ArtistRadioMode;
  tracks: StationTrack[];
  personaId: PersonaId;
  station: Station;
};

const ALT_GRUNGE_KEYWORDS = [
  "soundgarden",
  "nirvana",
  "pearl jam",
  "alice in chains",
  "cranberries",
  "stone temple",
  "mudhoney",
  "pixies",
  "sonic youth",
  "smashing pumpkins",
  "radiohead",
  "foo fighters",
  "bush",
  "live",
  "hole",
  "verve",
];

const HIP_HOP_KEYWORDS = [
  "notorious",
  "nas",
  "wu-tang",
  "tupac",
  "biggie",
  "jay-z",
  "eminem",
  "outkast",
  "dr dre",
  "snoop",
];

const DISCO_POP_KEYWORDS = [
  "madonna",
  "bee gees",
  "abba",
  "prince",
  "whitney",
  "a-ha",
  "cyndi",
  "depeche",
  "duran",
];

const PSYCHEDELIC_KEYWORDS = ["hendrix", "doors", "zeppelin", "beatles", "jefferson"];

const SYNTHWAVE_KEYWORDS = ["kavinsky", "carpenter brut", "m83", "perturbator", "gunship"];

const LOFI_KEYWORDS = ["lofi", "lo-fi", "chillhop", "j dilla", "nujabes"];

const JAZZ_KEYWORDS = ["miles davis", "brubeck", "coltrane", "ellington", "monk"];

const COUNTRY_KEYWORDS = ["cash", "parton", "brooks", "willie", "country"];

const CLASSIC_ROCK_KEYWORDS = [
  "queen",
  "eagles",
  "aerosmith",
  "ac/dc",
  "led zeppelin",
  "rolling stones",
  "fleetwood",
];

function slugifyArtist(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function findTracksInLibrary(artistQuery: string): StationTrack[] {
  const query = artistQuery.toLowerCase().trim();
  const matches: StationTrack[] = [];
  const seen = new Set<string>();

  for (const station of STATIONS) {
    for (const track of station.tracks) {
      if (
        track.artist.toLowerCase().includes(query) ||
        query.includes(track.artist.toLowerCase())
      ) {
        if (!seen.has(track.youtubeId)) {
          seen.add(track.youtubeId);
          matches.push(track);
        }
      }
    }
  }

  return matches;
}

export function matchPersonaForArtist(artistName: string, tracks: StationTrack[]): PersonaId {
  const haystack = `${artistName} ${tracks.map((t) => `${t.title} ${t.artist}`).join(" ")}`.toLowerCase();

  if (ALT_GRUNGE_KEYWORDS.some((k) => haystack.includes(k))) return "madison";
  if (HIP_HOP_KEYWORDS.some((k) => haystack.includes(k))) return "hype_jay";
  if (DISCO_POP_KEYWORDS.some((k) => haystack.includes(k))) return "studio_val";
  if (PSYCHEDELIC_KEYWORDS.some((k) => haystack.includes(k))) return "groovy_greg";
  if (SYNTHWAVE_KEYWORDS.some((k) => haystack.includes(k))) return "cyber_anya";
  if (LOFI_KEYWORDS.some((k) => haystack.includes(k))) return "chill_maya";
  if (JAZZ_KEYWORDS.some((k) => haystack.includes(k))) return "smooth_duke";
  if (COUNTRY_KEYWORDS.some((k) => haystack.includes(k))) return "wolfman";
  if (CLASSIC_ROCK_KEYWORDS.some((k) => haystack.includes(k))) return "wolfman";

  const stationHits = STATIONS.filter((s) =>
    s.tracks.some((t) => t.artist.toLowerCase().includes(artistName.toLowerCase())),
  );
  if (stationHits.length > 0) return stationHits[0].defaultPersonaId;

  return "madison";
}

export function createArtistRadioStation(
  artistName: string,
  tracks: StationTrack[],
  personaId: PersonaId,
  mode: ArtistRadioMode,
): Station {
  const slug = slugifyArtist(artistName);
  const first = tracks[0];
  const isMix = mode === "mixed";

  return {
    id: `artist-radio-${slug}`,
    name: isMix ? `Artist Radio: ${artistName}` : `${artistName} Playlist`,
    frequency: 99.9,
    category: "genres",
    defaultPersonaId: personaId,
    accentColor: "#FF0055",
    youtubeVideoId: first.youtubeId,
    tracks,
    description: isMix
      ? `Radio mix for ${artistName} with similar artists`
      : `Deep cuts and hits from ${artistName}`,
  };
}

export function buildArtistRadioResult(
  artistName: string,
  tracks: StationTrack[],
  mode: ArtistRadioMode,
): ArtistRadioResult {
  const personaId = matchPersonaForArtist(artistName, tracks);
  const station = createArtistRadioStation(artistName, tracks, personaId, mode);

  return { artistName, mode, tracks, personaId, station };
}

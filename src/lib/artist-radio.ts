import type { PersonaId } from "@/data/personas";
import { STATIONS, type Station, type StationTrack } from "@/data/stations";
import { resolveDjIdForQuery } from "@/lib/dj-resolver";
import {
  buildOrderedQueue,
  repairArtistAdjacency,
  type Artisted,
  type Ranked,
  type Rng,
} from "@/lib/track-shuffle";

export type ArtistRadioMode = "artist-only" | "mixed";

/** Tight, curated payload — deep enough for a long session, small enough to stay fast. */
export const ARTIST_RADIO_PAYLOAD_SIZE = 30;

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

  if (ALT_GRUNGE_KEYWORDS.some((k) => haystack.includes(k))) return "sloane-vance";
  if (HIP_HOP_KEYWORDS.some((k) => haystack.includes(k))) return "devon-pulse";
  if (DISCO_POP_KEYWORDS.some((k) => haystack.includes(k))) return "devon-pulse";
  if (PSYCHEDELIC_KEYWORDS.some((k) => haystack.includes(k))) return "miles";
  if (SYNTHWAVE_KEYWORDS.some((k) => haystack.includes(k))) return "kira-nova";
  if (LOFI_KEYWORDS.some((k) => haystack.includes(k))) return "devon-pulse";
  if (JAZZ_KEYWORDS.some((k) => haystack.includes(k))) return "devon-pulse";
  if (COUNTRY_KEYWORDS.some((k) => haystack.includes(k))) return "jasper-reed";
  if (CLASSIC_ROCK_KEYWORDS.some((k) => haystack.includes(k))) return "miles";

  const stationHits = STATIONS.filter((s) =>
    s.tracks.some((t) => t.artist.toLowerCase().includes(artistName.toLowerCase())),
  );
  if (stationHits.length > 0) return stationHits[0].defaultPersonaId;

  // Nothing recognized the artist by name, so fall back to genre/decade wording
  // in the query itself before settling for the default host.
  return resolveDjIdForQuery(haystack);
}

/**
 * Last-resort guard: a lead track with a YouTube ID but no preview has no fallback
 * if the embed fails. Playability is already part of starter selection, so this
 * rarely fires — and it only swaps within Tier 1 so it can never promote a deep cut
 * into the opening slot.
 */
export function promotePlayableLeadTrack(
  tracks: StationTrack[],
  tier1Size = 10,
): StationTrack[] {
  if (tracks.length <= 1) return tracks;

  const lead = tracks[0];
  const leadHasYoutube = Boolean(lead.youtubeId?.trim());
  const leadHasPreview = Boolean(lead.previewUrl?.trim());
  if (!leadHasYoutube || leadHasPreview) return tracks;

  const searchLimit = Math.min(tracks.length, Math.max(1, tier1Size));
  const fallbackIndex = tracks.findIndex(
    (track, index) => index > 0 && index < searchLimit && Boolean(track.previewUrl?.trim()),
  );
  if (fallbackIndex <= 0) return tracks;

  const next = [...tracks];
  [next[0], next[fallbackIndex]] = [next[fallbackIndex], next[0]];
  return next;
}

/**
 * Orders an Artist Radio pool: a weighted Tier 1 starter so the session opens on a
 * recognizable hit rather than the same #1 API result every launch, then a
 * weighted-shuffled tail with no back-to-back tracks by the same artist.
 *
 * Generic because this runs on raw iTunes songs — ordering before the YouTube
 * resolve means the expensive step only touches tracks we intend to deliver.
 * This is the single randomization point in the pipeline.
 */
export function orderArtistRadioTracks<T extends Artisted>(
  ranked: readonly Ranked<T>[],
  options?: {
    rng?: Rng;
    payloadSize?: number;
    avoidStarterIds?: ReadonlySet<string>;
    identify?: (item: T) => string;
    isPlayable?: (item: T) => boolean;
  },
): T[] {
  return buildOrderedQueue(ranked, {
    ...options,
    payloadSize: options?.payloadSize ?? ARTIST_RADIO_PAYLOAD_SIZE,
  });
}

/**
 * Post-resolution cleanup. Resolution drops tracks that fail to find a playable
 * source, which can strand an unplayable lead or leave two tracks by the same
 * artist adjacent. Deliberately does not re-draw the starter.
 */
export function finalizeArtistRadioTracks(tracks: StationTrack[]): StationTrack[] {
  return repairArtistAdjacency(promotePlayableLeadTrack(tracks));
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
    name: isMix ? `Artist Radio: ${artistName}` : `Artist Mix: ${artistName}`,
    frequency: 99.9,
    category: "genres",
    defaultPersonaId: personaId,
    accentColor: "#FF0055",
    youtubeVideoId: first.youtubeId,
    tracks,
    seedArtists: [artistName],
    description: isMix
      ? `Broad radio station blending ${artistName} with similar artists`
      : `Deep cuts and hits featuring ${artistName}`,
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

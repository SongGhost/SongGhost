import type { Station } from "@/data/stations";

/**
 * Listener families. Genre chips are these names, in this order.
 * Do not invent a family for one odd station.
 */
export const STATION_FAMILIES = [
  "Country",
  "Hip-Hop",
  "Rock",
  "Pop",
  "Soul & R&B",
  "Jazz",
  "Electronic",
  "Folk & Americana",
  "Metal",
  "Latin",
  "Classical",
  "Reggae",
  "Blues",
  "Gospel",
  "Soundtrack",
  "Ambient",
] as const;

export type StationFamily = (typeof STATION_FAMILIES)[number];

export type StationLane = {
  family: StationFamily;
  /** Omitted when the lane spans years. */
  era?: string;
  /** Evidence for the scene mix. The model may drop one that fails the lane. */
  anchors?: readonly string[];
};

const LANES: Record<string, StationLane> = {
  "50s-sock-hop": { family: "Rock", era: "50s" },
  "60s-psychedelic": { family: "Rock", era: "60s" },
  "60s-motown-uptown": { family: "Soul & R&B", era: "60s" },
  "60s-british-invasion": { family: "Rock", era: "60s" },
  "70s-classic-rock": { family: "Rock", era: "70s" },
  "70s-arena-rock": { family: "Rock", era: "70s" },
  "70s-disco-funk": { family: "Soul & R&B", era: "70s" },
  "80s-pop-synth": { family: "Pop", era: "80s" },
  "80s-new-wave-nights": { family: "Rock", era: "80s" },
  "80s-hair-metal": { family: "Metal", era: "80s" },
  "80s-old-school": { family: "Hip-Hop", era: "80s" },
  "90s-hip-hop": { family: "Hip-Hop", era: "90s" },
  "90s-grunge-static": { family: "Rock", era: "90s" },
  "90s-rave-edm": { family: "Electronic", era: "90s" },
  "90s-country-radio": { family: "Country", era: "90s" },
  "y2k-pop-rock": { family: "Pop", era: "Y2K" },
  "y2k-pop-punk": { family: "Rock", era: "Y2K" },
  "2000s-emo-nation": { family: "Rock", era: "2000s" },
  "southern-crunk": { family: "Hip-Hop", era: "2000s" },
  "2010s-indie-revival": { family: "Rock", era: "2010s" },
  "new-wave-post-punk": { family: "Rock" },
  "alternative-rock": { family: "Rock" },
  "seattle-grunge": { family: "Rock", era: "90s" },
  "cyberpunk-synthwave": { family: "Electronic" },
  "lofi-chillhop": { family: "Electronic" },
  "smooth-jazz": { family: "Jazz" },
  "country-gold": {
    family: "Country",
    anchors: [
      "Patsy Cline",
      "George Jones",
      "Loretta Lynn",
      "Tammy Wynette",
      "Conway Twitty",
      "Charley Pride",
      "Dolly Parton",
      "Hank Williams",
    ],
  },
  "outlaw-country": { family: "Country" },
  "modern-country": { family: "Country" },
  "americana-songwriters": { family: "Country" },
  "modern-trap": { family: "Hip-Hop" },
  "east-coast-hip-hop": { family: "Hip-Hop" },
  "classical-masters": { family: "Classical" },
  "movie-soundtracks": { family: "Soundtrack" },
  "synthwave-retro": { family: "Electronic" },
  "hard-bop-jazz": { family: "Jazz" },
  "shoegaze-dream": { family: "Rock" },
  "bluegrass-roots": { family: "Folk & Americana" },
  "reggae-dub": { family: "Reggae" },
  "k-pop-wave": { family: "Pop" },
  "afrobeat-groove": { family: "Soul & R&B" },
  "dark-ambient": { family: "Ambient" },
  "post-rock-cinematic": { family: "Rock" },
  "heavy-metal": { family: "Metal" },
  "blues-highway": { family: "Blues" },
  "folk-acoustic": { family: "Folk & Americana" },
  "soul-rnb": { family: "Soul & R&B" },
  "punk-rock-rebellion": { family: "Rock" },
  "emo-screamo": { family: "Rock" },
  "trip-hop-lounge": { family: "Electronic" },
  "drum-and-bass": { family: "Electronic" },
  "house-music": { family: "Electronic" },
  "techno-underground": { family: "Electronic" },
  "ambient-meditation": { family: "Ambient" },
  "world-music": { family: "Folk & Americana" },
  "latin-pop": { family: "Latin" },
  "bossa-nova": { family: "Jazz" },
  "gospel-spirit": { family: "Gospel" },
  "funk-groove": { family: "Soul & R&B" },
  "psychedelic-rock": { family: "Rock" },
  "progressive-rock": { family: "Rock" },
  "indie-pop": { family: "Pop" },
  "britpop-invasion": { family: "Rock", era: "90s" },
  "ska-punk": { family: "Rock" },
  "industrial-dark": { family: "Metal" },
  "new-age-zen": { family: "Ambient" },
  "chiptune-8bit": { family: "Electronic" },
  "motown-soul": { family: "Soul & R&B" },
  "disco-fever": { family: "Soul & R&B" },
  "garage-rock": { family: "Rock" },
  "noise-rock": { family: "Rock" },
  "dream-pop-ethereal": { family: "Pop" },
  "vaporwave-aesthetic": { family: "Electronic" },
  "celtic-folk": { family: "Folk & Americana" },
};

export function laneForStation(id: string): StationLane | undefined {
  return LANES[id];
}

/** Stamp family, era, and lane anchors onto a catalog station. */
export function applyStationLane(station: Station): Station {
  const lane = LANES[station.id];
  if (!lane) return station;
  const anchors = lane.anchors?.filter((name) => name.trim()) ?? [];
  return {
    ...station,
    family: station.family ?? lane.family,
    ...(lane.era ? { era: station.era ?? lane.era } : station.era ? { era: station.era } : {}),
    seedArtists:
      station.seedArtists && station.seedArtists.length > 0
        ? station.seedArtists
        : anchors.length > 0
          ? [...anchors]
          : station.seedArtists,
  };
}

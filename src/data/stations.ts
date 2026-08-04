import type { PersonaId } from "@/data/personas";
import { EXTRA_DECADE_STATIONS } from "@/data/extra-decades";
import { EXTRA_GENRE_STATIONS } from "@/data/extra-genres";
import { seedTracksFor } from "@/data/station-seeds";

export type StationCategory = "decades" | "genres";

export type StationTrack = {
  youtubeId: string;
  title: string;
  artist: string;
  /** iTunes 30-second preview when no YouTube embed is available */
  previewUrl?: string;
  itunesTrackId?: number;
  album?: string;
  /** Release year, when the source supplied one — the era lock validates against it */
  releaseYear?: number;
};

export type Station = {
  id: string;
  name: string;
  frequency: number;
  category: StationCategory;
  defaultPersonaId: PersonaId;
  /** Theme accent for progress glow, VU bars, and frequency readout */
  accentColor: string;
  /** Primary embeddable video — used for immediate playback */
  youtubeVideoId: string;
  /** Optional embeddable playlist for continuous playback */
  youtubePlaylistId?: string;
  /** Curated embeddable tracks for skip/next within station */
  tracks: StationTrack[];
  description: string;
};

/**
 * Swaps in the deep starter pool from `station-seeds.ts` where one exists.
 *
 * The inline `tracks` below stay as the fallback for stations that have not
 * been curated to depth yet, and as the shape reference for what a pool holds.
 * `youtubeVideoId` follows the pool so it keeps matching the station's lead
 * track, the same convention artist radio and saved stations use.
 */
function withDeepSeeds(station: Station): Station {
  const tracks = seedTracksFor(station.id, station.tracks);
  if (tracks === station.tracks) return station;
  return { ...station, tracks, youtubeVideoId: tracks[0]?.youtubeId ?? station.youtubeVideoId };
}

const BASE_STATIONS: Station[] = [
  {
    id: "50s-sock-hop",
    name: "50s Sock Hop & Doo-Wop",
    frequency: 94.1,
    category: "decades",
    defaultPersonaId: "johnny-static",
    accentColor: "#FFB000",
    youtubeVideoId: "Y-9Y4CCIWnM",
    tracks: [
      { youtubeId: "Y-9Y4CCIWnM", title: "Johnny B. Goode", artist: "Chuck Berry" },
      { youtubeId: "V_FAqr6rP4w", title: "Great Balls of Fire", artist: "Jerry Lee Lewis" },
      { youtubeId: "hzYBEJgKjv0", title: "Rock Around the Clock", artist: "Bill Haley" },
    ],
    description: "Classic 50s rock & roll, doo-wop, and sock hop hits",
  },
  {
    id: "60s-psychedelic",
    name: "60s Summer of Love Psychedelic",
    frequency: 98.5,
    category: "decades",
    defaultPersonaId: "johnny-static",
    accentColor: "#FF6B00",
    youtubeVideoId: "A_MjCqQoLLA",
    tracks: [
      { youtubeId: "A_MjCqQoLLA", title: "Purple Haze", artist: "Jimi Hendrix" },
      { youtubeId: "jKU74Uns9_0", title: "Light My Fire", artist: "The Doors" },
      { youtubeId: "KOok1WzZbOY", title: "California Dreamin'", artist: "The Mamas & The Papas" },
    ],
    description: "Psychedelic rock, folk rock, and flower power anthems",
  },
  {
    id: "70s-classic-rock",
    name: "70s Classic Rock",
    frequency: 104.5,
    category: "decades",
    defaultPersonaId: "johnny-static",
    accentColor: "#FF8C00",
    youtubeVideoId: "fJ9rUzIMcZQ",
    tracks: [
      { youtubeId: "fJ9rUzIMcZQ", title: "Bohemian Rhapsody", artist: "Queen" },
      { youtubeId: "BciS5krYL80", title: "Hotel California", artist: "Eagles" },
      { youtubeId: "xbhCPt6PZIU", title: "Stairway to Heaven", artist: "Led Zeppelin" },
      { youtubeId: "89dGC8de0CA", title: "Dream On", artist: "Aerosmith" },
    ],
    description: "Arena rock, prog, and classic 70s guitar anthems",
  },
  {
    id: "70s-disco-funk",
    name: "70s Studio Disco & Funk",
    frequency: 107.7,
    category: "decades",
    defaultPersonaId: "devon-pulse",
    accentColor: "#FF00AA",
    youtubeVideoId: "z2qoihbzc3E",
    tracks: [
      { youtubeId: "z2qoihbzc3E", title: "Stayin' Alive", artist: "Bee Gees" },
      { youtubeId: "CS9OO0S5w2k", title: "Le Freak", artist: "Chic" },
      { youtubeId: "ftdZ363R9kQ", title: "Superstition", artist: "Stevie Wonder" },
    ],
    description: "Disco, funk, and dance floor classics from the 70s",
  },
  {
    id: "80s-pop-synth",
    name: "80s Rewind Pop & Synth",
    frequency: 89.5,
    category: "decades",
    defaultPersonaId: "johnny-static",
    accentColor: "#00CCFF",
    youtubeVideoId: "djV11Xbc914",
    tracks: [
      { youtubeId: "djV11Xbc914", title: "Take On Me", artist: "a-ha" },
      { youtubeId: "1w7OgIMMRc4", title: "Sweet Child O' Mine", artist: "Guns N' Roses" },
      { youtubeId: "1k8craCGpgs", title: "Don't Stop Believin'", artist: "Journey" },
    ],
    description: "Synth-pop, new wave hits, and 80s chart toppers",
  },
  {
    id: "90s-hip-hop",
    name: "90s Boom Bap & Hip Hop",
    frequency: 96.7,
    category: "decades",
    defaultPersonaId: "devon-pulse",
    accentColor: "#FFD700",
    youtubeVideoId: "7Y8VPQcPHhY",
    tracks: [
      { youtubeId: "7Y8VPQcPHhY", title: "Juicy", artist: "The Notorious B.I.G." },
      { youtubeId: "hI8A14Qcv68", title: "N.Y. State of Mind", artist: "Nas" },
      { youtubeId: "ecRs1sWZIL4", title: "C.R.E.A.M.", artist: "Wu-Tang Clan" },
    ],
    description: "Boom bap, golden age hip hop, and 90s rap classics",
  },
  {
    id: "y2k-pop-rock",
    name: "Y2K Pop & Rock",
    frequency: 106.1,
    category: "decades",
    defaultPersonaId: "sloane-vance",
    accentColor: "#00FFCC",
    youtubeVideoId: "eVTXPUF4Oz4",
    tracks: [
      { youtubeId: "eVTXPUF4Oz4", title: "In the End", artist: "Linkin Park" },
      { youtubeId: "y6120QOlsfU", title: "Sandstorm", artist: "Darude" },
      { youtubeId: "pSY3i5XHHXo", title: "Clocks", artist: "Coldplay" },
    ],
    description: "Pop punk, nu-metal, and early 2000s radio hits",
  },
  ...EXTRA_DECADE_STATIONS,
  {
    id: "new-wave-post-punk",
    name: "New Wave & Post-Punk Underground",
    frequency: 97.3,
    category: "genres",
    defaultPersonaId: "sloane-vance",
    accentColor: "#FF0055",
    youtubeVideoId: "i5_asj1BGFs",
    tracks: [
      { youtubeId: "i5_asj1BGFs", title: "Sweet Dreams", artist: "Eurythmics" },
      { youtubeId: "xxDv_RTdLQo", title: "Temptation", artist: "New Order" },
      { youtubeId: "zuuObGsB0No", title: "Love Will Tear Us Apart", artist: "Joy Division" },
    ],
    description: "New wave, post-punk, and underground 80s club sounds",
  },
  {
    id: "alternative-rock",
    name: "Modern & 90s Alternative Rock",
    frequency: 102.1,
    category: "genres",
    defaultPersonaId: "sloane-vance",
    accentColor: "#FF0055",
    youtubeVideoId: "hTWKbfoikeg",
    tracks: [
      { youtubeId: "hTWKbfoikeg", title: "Smells Like Teen Spirit", artist: "Nirvana" },
      { youtubeId: "9kIv6vVRKpw", title: "Black Hole Sun", artist: "Soundgarden" },
      { youtubeId: "6Ejga4kJUts", title: "Zombie", artist: "The Cranberries" },
    ],
    description: "Grunge-era alt rock and modern alternative anthems",
  },
  {
    id: "seattle-grunge",
    name: "90s Seattle Grunge Garage",
    frequency: 103.3,
    category: "genres",
    defaultPersonaId: "sloane-vance",
    accentColor: "#9B59B6",
    youtubeVideoId: "9kIv6vVRKpw",
    tracks: [
      { youtubeId: "9kIv6vVRKpw", title: "Black Hole Sun", artist: "Soundgarden" },
      { youtubeId: "hTWKbfoikeg", title: "Smells Like Teen Spirit", artist: "Nirvana" },
      { youtubeId: "TAqZb52sgpU", title: "Man in the Box", artist: "Alice in Chains" },
    ],
    description: "Seattle grunge, flannel rock, and 90s garage sound",
  },
  {
    id: "cyberpunk-synthwave",
    name: "Cyberpunk Synthwave",
    frequency: 88.3,
    category: "genres",
    defaultPersonaId: "kira-nova",
    accentColor: "#00FFCC",
    youtubeVideoId: "MV_3Dpw-BRY",
    tracks: [
      { youtubeId: "MV_3Dpw-BRY", title: "Nightcall", artist: "Kavinsky" },
      { youtubeId: "er416Ad3R1g", title: "Turbo Killer", artist: "Carpenter Brut" },
      { youtubeId: "dX3k_QDnzHE", title: "Midnight City", artist: "M83" },
    ],
    description: "Synthwave, retrowave, and cyberpunk electronic",
  },
  {
    id: "lofi-chillhop",
    name: "Lo-Fi Chill Hop Cafe",
    frequency: 91.2,
    category: "genres",
    defaultPersonaId: "devon-pulse",
    accentColor: "#C9A0FF",
    youtubeVideoId: "jfKfPfyJRdk",
    tracks: [
      { youtubeId: "jfKfPfyJRdk", title: "lofi hip hop radio", artist: "Lofi Girl" },
      { youtubeId: "5qap5aO4i9A", title: "lofi hip hop radio", artist: "ChilledCow" },
    ],
    description: "Lo-fi beats, chill hop, and cafe study vibes",
  },
  {
    id: "smooth-jazz",
    name: "Smooth Jazz Lounge",
    frequency: 101.9,
    category: "genres",
    defaultPersonaId: "devon-pulse",
    accentColor: "#FFB347",
    youtubeVideoId: "ryA6eHZNnXY",
    tracks: [
      { youtubeId: "ryA6eHZNnXY", title: "Take Five", artist: "Dave Brubeck" },
      { youtubeId: "KJEzFvXx3Xw", title: "So What", artist: "Miles Davis" },
      { youtubeId: "CpB7-8SGlJ0", title: "Autumn Leaves", artist: "Cannonball Adderley" },
    ],
    description: "Smooth jazz, late-night lounge, and mellow grooves",
  },
  {
    id: "country-gold",
    name: "Country Gold & Honky Tonk",
    frequency: 105.3,
    category: "genres",
    defaultPersonaId: "jasper-reed",
    accentColor: "#D4A574",
    youtubeVideoId: "EyWTL3QfXMQ",
    tracks: [
      { youtubeId: "EyWTL3QfXMQ", title: "Friends in Low Places", artist: "Garth Brooks" },
      { youtubeId: "5WyLhwYFgmk", title: "Ring of Fire", artist: "Johnny Cash" },
      { youtubeId: "GFPlF6rXnik", title: "Jolene", artist: "Dolly Parton" },
    ],
    description: "Classic country, honky tonk, and outlaw country gold",
  },
  ...EXTRA_GENRE_STATIONS,
];

export const STATIONS: Station[] = BASE_STATIONS.map(withDeepSeeds);

export const DECADE_STATIONS = STATIONS.filter((s) => s.category === "decades");
export const GENRE_STATIONS = STATIONS.filter((s) => s.category === "genres");

export function getStationById(id: string): Station | undefined {
  return STATIONS.find((s) => s.id === id);
}

export const DEFAULT_STATION = STATIONS.find((s) => s.id === "70s-classic-rock")!;

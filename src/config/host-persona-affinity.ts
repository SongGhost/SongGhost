/**
 * Host specialty affinities — genre keywords + decade coverage for auto-assignment.
 * Consumed by the persona roster and `getPersonaForStation` / DJ resolver.
 */

export type HostPersonaAffinity = {
  /** Short specialty label for UI / defaultGenre */
  primary: string;
  /** Lowercase genre keywords matched (exact or substring) against station text */
  genres: readonly string[];
  /** Decade labels this host covers (e.g. "1990s") */
  decades: readonly string[];
};

/**
 * Canonical affinity table keyed by live persona id (and Henry).
 * Genre lists are the source of truth for station auto-assignment.
 */
export const HOST_PERSONA_AFFINITY = {
  henry: {
    primary: "Country",
    genres: [
      "country",
      "classic country",
      "90s country",
      "modern country",
      "americana",
      "outlaw country",
      "bluegrass",
      "southern rock",
      "western",
    ],
    decades: [
      "1960s",
      "1970s",
      "1980s",
      "1990s",
      "2000s",
      "2010s",
      "2020s",
    ],
  },
  miles: {
    primary: "Hip Hop, R&B, Beats, Rap",
    genres: [
      "hip hop",
      "hip-hop",
      "rap",
      "r&b",
      "rnb",
      "beats",
      "trap",
      "boom bap",
      "neo-soul",
      "lo-fi beats",
    ],
    decades: ["1980s", "1990s", "2000s", "2010s", "2020s"],
  },
  "sloane-vance": {
    primary: "Modern, Alternative, New Wave",
    genres: [
      "alternative",
      "alt rock",
      "modern rock",
      "new wave",
      "indie",
      "indie rock",
      "synthwave",
      "post-punk",
      "indie pop",
    ],
    decades: ["1980s", "2000s", "2010s", "2020s"],
  },
  "devon-pulse": {
    primary: "Jazz, Soul, LoFi",
    genres: [
      "jazz",
      "smooth jazz",
      "soul",
      "motown",
      "lofi",
      "lo-fi",
      "quiet storm",
      "downtempo",
      "chillout",
    ],
    decades: [
      "1950s",
      "1960s",
      "1970s",
      "1980s",
      "1990s",
      "2000s",
      "2010s",
      "2020s",
    ],
  },
  "kira-nova": {
    primary: "Pop, Mainstream, Dance",
    genres: [
      "pop",
      "top 40",
      "mainstream",
      "dance",
      "edm",
      "house",
      "disco",
      "club",
      "90s pop",
      "2000s pop",
    ],
    decades: ["1970s", "1990s", "2000s", "2010s", "2020s"],
  },
  "jasper-reed": {
    primary: "Folk, Grunge, Punk",
    genres: [
      "folk",
      "indie folk",
      "grunge",
      "punk",
      "pop-punk",
      "hard rock",
      "classic rock",
      "blues rock",
      "metal",
    ],
    decades: ["1960s", "1970s", "1980s", "1990s", "2000s", "2010s"],
  },
} as const satisfies Record<string, HostPersonaAffinity>;

export type AffinityPersonaId = keyof typeof HOST_PERSONA_AFFINITY;

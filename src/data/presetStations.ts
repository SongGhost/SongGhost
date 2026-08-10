/**
 * Curated seed-artist anchors for preset dial stations.
 *
 * Genre profiles (`station-genre-profiles.ts`) and catalog builders pull from
 * these lists so a station's opener pool stays diverse and recognizable without
 * hard-coding the same names in multiple places.
 */

/** Modern & 90s Alternative Rock (`alternative-rock`) — 20 core anchors. */
export const ALTERNATIVE_ROCK_SEED_ARTISTS = [
  "Red Hot Chili Peppers",
  "Nirvana",
  "Pearl Jam",
  "Foo Fighters",
  "Soundgarden",
  "Stone Temple Pilots",
  "Smashing Pumpkins",
  "Radiohead",
  "Weezer",
  "Green Day",
  "Alice in Chains",
  "Bush",
  "Incubus",
  "Sublime",
  "The Offspring",
  "Third Eye Blind",
  "Everclear",
  "Beck",
  "Cake",
  "Rage Against the Machine",
] as const;

/**
 * Last.fm tags that are not a genre or an era.
 * "seen live", favorites, and mood words show up on almost every artist.
 * If those count as a match, every neighbor gets through.
 */
const JUNK_TAGS = new Set([
  "seen live",
  "seen in concert",
  "want to see live",
  "favorites",
  "favorite",
  "favourite",
  "favourites",
  "my favorites",
  "my favourite",
  "my favourites",
  "love",
  "loved",
  "awesome",
  "cool",
  "amazing",
  "beautiful",
  "sexy",
  "good",
  "great",
  "best",
  "albums i own",
  "check out",
  "spotify",
  "youtube",
  "pandora",
  "lastfm",
  "last fm",
  "under 2000 listeners",
  "female vocalists",
  "male vocalists",
  "female vocalist",
  "male vocalist",
  "vocalists",
  "vocals",
  "singer",
  "singers",
  "band",
  "bands",
  "music",
  "songs",
  "all",
  "misc",
  "other",
  "various",
  "artists",
  "artist",
  "pop culture",
  "legendary",
  "classic",
  "overrated",
  "underrated",
  "guilty pleasure",
  "guilty pleasures",
  "catchy",
  "fun",
  "sad",
  "happy",
  "chill",
  "chillout",
  "relaxed",
  "mellow",
  "melancholic",
  "melancholy",
  "emotional",
  "upbeat",
  "energetic",
  "dark",
  "atmospheric",
  "romantic",
  "party",
  "summer",
  "winter",
  "christmas",
  "driving",
  "workout",
  "sleep",
  "study",
  "nostalgic",
  "dreamy",
  "haunting",
  "american",
  "usa",
  "united states",
  "british",
  "uk",
  "england",
  "english",
  "london",
  "canadian",
  "canada",
  "australian",
  "australia",
  "swedish",
  "sweden",
  "irish",
  "ireland",
  "scottish",
  "scotland",
  "german",
  "germany",
  "french",
  "france",
  "japanese",
  "japan",
  "korean",
  "korea",
  "brazilian",
  "brazil",
  "european",
  "europe",
  "international",
  "world",
  "female",
  "male",
  "women",
  "men",
  "guitar",
  "piano",
  "drums",
  "violin",
  "saxophone",
  "synth",
  "synthesizer",
  "acoustic",
  "instrumental",
  "live",
  "cover",
  "covers",
  "remix",
  "remixes",
]);

export function normalizeFolksonomyTag(tag: string): string {
  return tag
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[-_/]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Decade-style labels Last.fm listeners actually apply: "90s", "1990s", "2000s". */
export function isEraTag(tag: string): boolean {
  return (
    /^(19|20)\d0s$/.test(tag) ||
    /^\d0s$/.test(tag) ||
    /^(early|mid|late) (19|20)\d0s$/.test(tag)
  );
}

export function isRealGenreOrEraTag(tag: string): boolean {
  const norm = normalizeFolksonomyTag(tag);
  if (!norm) return false;
  if (isEraTag(norm)) return true;
  if (JUNK_TAGS.has(norm)) return false;
  if (norm.length < 3) return false;
  return true;
}

/** Genre and era tags only, in first-seen order, junk removed. */
export function realGenreOrEraTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const norm = normalizeFolksonomyTag(tag);
    if (!norm || seen.has(norm) || !isRealGenreOrEraTag(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

/** True when the two tag lists share at least one real genre or era tag. */
export function sharesRealGenreOrEra(
  seedTags: readonly string[],
  neighborTags: readonly string[],
): boolean {
  const seed = new Set(realGenreOrEraTags(seedTags));
  if (seed.size === 0) return false;
  return realGenreOrEraTags(neighborTags).some((tag) => seed.has(tag));
}

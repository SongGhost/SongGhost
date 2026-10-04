/**
 * Prompt for one New break.
 * The model always writes the spoken line. Persona is the voice, not a tag.
 * It does not use the Classic teaching contract.
 */

import type { FactPack } from "./types";

const DEPTH_LINE: Record<FactPack["depth"], string> = {
  standard:
    "Standard: say who it is. Title and artist. It may be short. No extra facts. Do not make the whole line a canned title-by-artist template.",
  roots_branches: "Roots & Branches: that identity plus at most one fact from the pack. Do not use a second fact.",
  time_capsule:
    "Sonic Time Capsule: identity plus 2 or 3 facts from the pack when that many are listed. If fewer are listed, use only those. Do not invent a fact to fill the count.",
  directors_cut:
    "Director's Cut: a real DJ thought. Longer only when the facts support it. If the pack lists a fact besides the year and the album, include at least one of those. If the pack has no facts, one short human line about this song using only the title and artist. Not a lore paragraph. Not a bare title-by-artist template.",
};

const PERSONA_LINE: Record<string, string> = {
  "warm-companion":
    "Voice: The Guide. Warm, plain, and welcoming, like a friend who knows the record. Change how it is said. Do not add a catchphrase.",
  "sarcastic-critic":
    "Voice: The Critic. Dry, precise, a little unimpressed, and still fair. Change how it is said. Do not add a catchphrase.",
  "the-musicologist":
    "Voice: The Archivist. Careful, specific, and unhurried. Change how it is said. Do not add a catchphrase.",
  "standard-broadcast":
    "Voice: Standard Broadcast. Clean, direct, and professional. Name the song and move on. Do not add a catchphrase.",
};

const SHAPE_LINE = [
  "Shape: a straight identification of the upcoming song.",
  "Shape: one observation, then the upcoming song.",
  "Shape: a that-was / up-next handoff when a previous song is known. Otherwise a straight identification.",
] as const;

export function buildNewWordsPrompt(pack: FactPack, draft: string): { system: string; user: string } {
  const nuggetLines = pack.nuggets.length
    ? pack.nuggets.map((nugget) => `- ${nugget.sentence}`).join("\n")
    : "- (none — title and artist only)";
  const previous = pack.previous?.title
    ? `The song that just ended was "${pack.previous.title}" by ${pack.previous.artist}. "That was" may name that song only.`
    : "No previous song was supplied. Do not invent one.";

  const system = [
    "You write one spoken radio line for the song that is about to play.",
    `The upcoming song is "${pack.now.title}" by ${pack.now.artist}. That is the song the listener will hear next. Name that title. Do not name a different song as what is next.`,
    previous,
    "Use only the facts listed below. They may be about the artist, the song, the album, the studio, the players and instruments, the era, or any other true line in that list. Rephrase a listed fact in your own words. Do not invent a person, studio, year, city, chart position, story, or any proper noun that is not already in the facts or the upcoming title and artist.",
    "Do not mention a city or a station vibe.",
    "Shorter and true beats longer and invented. Do not pad to a word count.",
    "You may rephrase the seed. You do not have to keep its words.",
    DEPTH_LINE[pack.depth],
    PERSONA_LINE[pack.personaId] ?? PERSONA_LINE["standard-broadcast"],
    SHAPE_LINE[pack.shapeVariant] ?? SHAPE_LINE[0],
    pack.allowExplicit ? "" : "Keep the language FCC clean.",
    'Return JSON only: {"script":"..."}',
  ]
    .filter(Boolean)
    .join(" ");

  const user = [
    `Upcoming title: ${pack.now.title}`,
    `Upcoming artist: ${pack.now.artist}`,
    `Depth: ${pack.depth}`,
    `Fact cap: ${pack.maxNuggets}`,
    `Facts:\n${nuggetLines}`,
    `Seed you may rephrase:\n${draft}`,
  ].join("\n");

  return { system, user };
}

/**
 * Prompt for one New break.
 * The model always writes the spoken line. Persona is the voice, not a tag.
 * It does not use the Classic teaching contract.
 */

import type { FactPack } from "./types";

const DEPTH_LINE: Record<FactPack["depth"], string> = {
  standard:
    "Standard: say who it is. Title and artist. It may be short. No extra facts. Do not make the whole line a canned title-by-artist template.",
  roots_branches: "Roots & Branches: that identity plus one fact from the pack when one is listed. Do not use a second fact. If the pack lists a fact, do not skip it for mood words.",
  time_capsule:
    "Sonic Time Capsule: identity plus 2 or 3 facts from the pack when that many are listed. If fewer are listed, use only those. If any are listed, use at least one. Do not invent a fact to fill the count. Do not skip the facts for mood words.",
  directors_cut:
    "Director's Cut: speak like a human DJ. Name the upcoming title and artist clearly near the start, or in a clear up next. The pack holds up to 6 facts. Prefer 2 to 4 when that is enough. Use more only when the listed facts are strong and short. Do not pad to a monologue. Use pack facts only for concrete claims. Vibe and warmth are glue between listed facts, not a substitute for them. Do not add guest vocalists, moods as facts, brand mis-says, or any other soft claim that is not in the pack. Roots stays at one fact. Time Capsule stays at 2 or 3. If the pack has no facts, one short human identity line using only the title and artist. Not a lore paragraph. Not a bare title-by-artist template.",
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
    "Use pack facts only for concrete claims. They may be about the artist, the song, the album, the studio, the players and instruments, or any other true line in that list. Rephrase a listed fact in your own words. Do not invent a person, studio, year, city, chart position, story, guest vocalist, or any proper noun that is not already in the facts or the upcoming title and artist.",
    "Do not say filed under. Do not recite a genre tag or an era tag. If a genre word appears, it must sit inside a sentence that also states a listed fact. If the fact list is empty, do not add a scene, a decade, or a genre. Do not name a brand, a label, or a studio that is not in the pack.",
    "Name the upcoming title and artist clearly near the start, or in a clear up next. If at least one fact is listed, the line must use at least one. Vibe and warmth are OK as glue between listed facts. Do not add guest vocalists, moods as facts, brand mis-says, or other soft claims that are not in the pack. Do not replace the facts with a that-was / up-next line plus mood words such as soaring, dive into, or essence of. With 2 or more facts, do not pad to a monologue. If no fact is listed, one short human identity line that names the upcoming title and artist. Not a deep dive. Not a bare title-by-artist template.",
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

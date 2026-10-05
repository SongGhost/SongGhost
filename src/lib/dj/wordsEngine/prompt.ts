/**
 * Prompt for one New break.
 * The model always writes the spoken line. Persona is the voice, not a tag.
 * It does not use the Classic teaching contract.
 */

import type { FactPack } from "./types";
import type { SheetClaim } from "./claims";

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
    "Voice: The Guide. Posture: invitation. Required move: people and the story, then one thing to hear in the song (notice how it opens, hear how it comes in, when it starts). Name an instrument only when that instrument is on the sheet. Do not judge the song. No catchphrase.",
  "sarcastic-critic":
    "Voice: The Critic. Posture: taste. Required move: one fair judgment (what works, what is thin, what earns it) tied to a sourced craft detail such as a player, an instrument, a producer, or a studio. No insults. No catchphrase.",
  "the-musicologist":
    "Voice: The Archivist. Posture: catalog. Required move: lineage. Where this sits, who is credited, or what came before it. A year or a credit from the sheet, said so a listener hears the history. No catchphrase.",
  "standard-broadcast":
    "Voice: Standard Broadcast. Posture: handoff. Required move: one strong fact, then a clean handoff into the song. Tight and forward. No invitation. No taste note. No catchphrase.",
};

function finishedSongRule(pack: FactPack): string {
  if (!pack.songOneExit) {
    return 'Do not open with "That was" or "You just heard". Do not recap the song that just ended. Facts are about the upcoming song only.';
  }
  const heard = pack.previous?.title
    ? `The song that just ended was "${pack.previous.title}" by ${pack.previous.artist}.`
    : "A song just ended, but its name was not supplied. Do not invent one.";
  if (pack.depth === "directors_cut") {
    const past = pack.pastNugget
      ? `Past fact (the only fact you may say about the finished song): ${pack.pastNugget.sentence}`
      : "No past fact is listed. Do not invent one about the finished song.";
    return `${heard} Open with "That was" naming that finished song only. ${past} Then move to up next and name the upcoming song. Do not add a second fact about the finished song.`;
  }
  return `${heard} You may open with "That was" naming that finished song only. Do not add a fact about the finished song. Keep that part short, then up next for the upcoming song.`;
}

function shapeLine(pack: FactPack): string {
  if (pack.songOneExit) {
    return 'Shape: open with "That was" for the finished song, then up next.';
  }
  if (pack.shapeVariant === 1) return "Shape: one observation, then the upcoming song.";
  if (pack.shapeVariant === 2) {
    return 'Shape: up next for the upcoming song. Do not open with "That was".';
  }
  return "Shape: a straight identification of the upcoming song.";
}

function claimLine(claim: SheetClaim): string {
  const bits = [
    claim.names.length ? `names: ${claim.names.join(", ")}` : "",
    claim.places.length ? `places: ${claim.places.join(", ")}` : "",
    claim.years.length ? `years: ${claim.years.join(", ")}` : "",
    claim.instruments.length ? `instruments: ${claim.instruments.join(", ")}` : "",
    `source: ${claim.sourceName}`,
  ].filter(Boolean);
  return `- (${claim.topic}) ${claim.claim} [${bits.join("; ")}]`;
}

export function buildNewWordsPrompt(pack: FactPack, draft: string): { system: string; user: string } {
  const nuggetLines = pack.nuggets.length
    ? pack.nuggets.map((nugget) => `- ${nugget.sentence}`).join("\n")
    : "- (none — title and artist only)";
  const previous = finishedSongRule(pack);

  const featured = pack.nuggets.filter((nugget) => nugget.topic !== "release");
  const supporting = pack.nuggets.filter((nugget) => nugget.topic === "release");
  const teach = featured.length ? featured : pack.nuggets;
  const skeleton = pack.personaId === "warm-companion"
    ? 'Sentence 2 must include the words "listen for" or "notice how".'
    : pack.personaId === "sarcastic-critic"
      ? "Sentence 2 must include one of these words, tied to a sheet credit: works, earns, thin, holds, lands."
      : pack.personaId === "the-musicologist"
        ? "Sentence 2 must include a year or a credit from the sheet, with one of these words: recorded, produced, formed, credited."
        : "Keep the middle sentence to the one fact.";
  const closer = pack.tease
    ? `Name "${pack.now.title}" once. Do not write "up next" unless that same sentence names "${pack.now.title}". The last sentence must say "after that" and promise only this: ${pack.tease.claim}`
    : `The last sentence must name "${pack.now.title}".`;
  const oneFact = pack.depth === "roots_branches" && teach[0]
    ? `The only fact you may teach about this song is: ${teach[0].sentence} Do not mention any other person, place, or year from the sheet. ${closer}`
    : closer;
  const longForm = pack.length.minWords >= 75
    ? `Write at least ${pack.length.minWords} words. Give each featured fact its own sentence, then a last sentence that names the upcoming song. Do not invent a name, a place, or a year to fill the time.`
    : "";
  const length = pack.length.minWords > 0
    ? `Length: ${pack.length.minWords} to ${pack.length.maxWords} words. That is the spoken time for this mode. Do not pad. If the sheet is thin, stop when the fact is told.`
    : `Length: at most ${pack.length.maxWords} words. Do not pad.`;
  const beats = pack.nuggets.length > 0
    ? "Three beats, in this order. Hook: open on the fact, never the words fun fact, never did you know, never surprise. Payoff: the fact and why it matters. Handoff: the last sentence names the upcoming song, or promises the one backed next-song fact."
    : "One short human line that names the upcoming title and artist. No invented color.";
  const banned = 'Banned unless the sheet already uses that exact word: haunting, soundscape, iconic, groundbreaking, timeless, journey, vibes, "dive into", "dive in", "stay tuned", "stick around". Do not praise the song with incredible, special, captivating, or talent.';
  const tease = pack.tease
    ? `Backed tease: the last sentence must promise this and only this about the following song: ${pack.tease.claim} That promise is not a second fact about the song that is about to play.`
    : "";
  const payoff = pack.payoff
    ? `You must pay off this promise from the previous break before you teach a new fact: ${pack.payoff.claim}`
    : "";

  const system = [
    "You write one spoken radio line for the song that is about to play.",
    beats,
    `The upcoming song is "${pack.now.title}" by ${pack.now.artist}. That is the song the listener will hear next. Name that title. Do not name a different song as what is next.`,
    previous,
    "Use pack facts only for concrete claims. They may be about the artist, the song, the album, the studio, the players and instruments, or any other true line in that list. Rephrase a listed fact in your own words. Do not invent a person, studio, year, city, chart position, gear, story, guest vocalist, or any proper noun that is not already in the facts or the upcoming title and artist.",
    "A concert hall, arena, or other live place is not a recording studio. Do not say the song was recorded at a place unless that exact place is written in the facts. Do not add a city, a chart rank, an instrument brand, or a person that is not written in the facts.",
    "Do not say filed under. Do not recite a genre tag or an era tag. If a genre word appears, it must sit inside a sentence that also states a listed fact. If the fact list is empty, do not add a scene, a decade, or a genre. Do not name a brand, a label, or a studio that is not in the pack.",
    "Name the upcoming title and artist clearly near the start, or in a clear up next. If at least one fact is listed, the line must use at least one. Vibe and warmth are OK as glue between listed facts. Do not add guest vocalists, moods as facts, brand mis-says, or other soft claims that are not in the pack. Do not replace the facts with a that-was / up-next line plus mood words such as soaring, dive into, or essence of. With 2 or more facts, do not pad to a monologue. If no fact is listed, one short human identity line that names the upcoming title and artist. Not a deep dive. Not a bare title-by-artist template.",
    "Do not mention a city or a station vibe.",
    "Shorter and true beats longer and invented. Do not pad to a word count.",
    "You may rephrase the seed. You do not have to keep its words.",
    "Speak only from the sheet. Do not use anything you remember about the artist.",
    "Release year, album title, and track number are supporting. Do not make them the point when a better fact is listed.",
    length,
    oneFact,
    skeleton,
    longForm,
    banned,
    tease,
    payoff,
    DEPTH_LINE[pack.depth],
    PERSONA_LINE[pack.personaId] ?? PERSONA_LINE["standard-broadcast"],
    shapeLine(pack),
    pack.allowExplicit ? "" : "Keep the language FCC clean.",
    'Return JSON only: {"script":"..."}',
  ]
    .filter(Boolean)
    .join(" ");

  const teachLines = teach.length
    ? teach.map((nugget) => `- ${nugget.sentence}`).join("\n")
    : "- (none — title and artist only)";
  const supportLines = supporting.length
    ? supporting.map((nugget) => `- ${nugget.sentence}`).join("\n")
    : "- (none)";
  const sheetLines = pack.sheet.length
    ? pack.sheet.map(claimLine).join("\n")
    : teachLines;

  const user = [
    `Upcoming title: ${pack.now.title}`,
    `Upcoming artist: ${pack.now.artist}`,
    `Depth: ${pack.depth}`,
    `Fact cap: ${pack.maxNuggets}`,
    `Words: ${pack.length.minWords}-${pack.length.maxWords}`,
    `Teach from these facts:\n${teachLines}`,
    `Supporting only, do not lead with these:\n${supportLines}`,
    `Full sheet (every name, place, year, number, and instrument you say must appear here or on the next song):\n${sheetLines}`,
    pack.tease ? `Next-song fact you may promise:\n${claimLine(pack.tease)}` : "",
    pack.payoff ? `Promise to pay off:\n${claimLine(pack.payoff)}` : "",
    `Facts:\n${nuggetLines}`,
    `Seed you may rephrase:\n${draft}`,
  ].filter(Boolean).join("\n");

  return { system, user };
}

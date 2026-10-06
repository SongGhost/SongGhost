/**
 * Prompt for one New break.
 * The model always writes the spoken line. Persona is the voice, not a tag.
 * It does not use the Classic teaching contract.
 */

import type { FactPack, FactNugget } from "./types";
import type { SheetClaim } from "./claims";

const DEPTH_LINE: Record<FactPack["depth"], string> = {
  standard:
    "Standard: say who it is. Title and artist. It may be short. No extra facts. Do not make the whole line a canned title-by-artist template.",
  roots_branches: "Roots & Branches: that identity plus one fact from the pack when one is listed. Do not use a second fact. If the pack lists a fact, do not skip it for mood words.",
  time_capsule:
    "Sonic Time Capsule: that identity plus the one featured fact. Do not use a second fact. If the pack lists a fact, use it. Do not invent a fact. Do not skip the fact for mood words.",
  directors_cut:
    "Director's Cut: one arc, at most two featured facts. Name the upcoming title and artist clearly near the start, or in a clear up next. Say why they matter, then hand off. Do not stack credits. Do not pad to a monologue. If the pack has no facts, one short human identity line using only the title and artist. Not a lore paragraph. Not a bare title-by-artist template.",
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

function anchor(nugget: FactNugget, artist: string): string {
  const place = nugget.places?.[0];
  if (place) return place;
  const instrument = (nugget.instruments ?? []).find((item) => item !== "vocals");
  if (instrument) return `the ${instrument}`;
  if (/lyric/i.test(nugget.sentence)) return "the lyrics";
  if (/produc/i.test(nugget.sentence)) return "that production";
  if (/\brecorded\b/i.test(nugget.sentence)) return "that recording";
  const year = nugget.years?.[0];
  if (year) return String(year);
  const artistTokens = new Set(artist.toLowerCase().split(/[^a-z0-9']+/));
  const person = (nugget.names ?? []).find((name) => {
    const last = name.toLowerCase().split(/\s+/).pop() ?? "";
    return last.length > 2 && !artistTokens.has(last);
  });
  return person ?? "that";
}

function whyClause(pack: FactPack, nugget: FactNugget): string {
  const point = anchor(nugget, pack.now.artist);
  if (pack.personaId === "warm-companion") {
    return `so listen for ${point} when the song opens, because that is the part to hear on this song`;
  }
  if (pack.personaId === "sarcastic-critic") {
    return "and that choice earns the song";
  }
  if (pack.personaId === "the-musicologist") {
    return "and that is where this sits";
  }
  return "and that is the detail on this one";
}

/** A legal line the writer can copy. Same facts the gate will accept. */
export function exampleBreak(pack: FactPack): string {
  const featured = pack.nuggets.filter((nugget) => nugget.topic !== "release");
  const teach = featured.length ? featured : pack.nuggets;
  const fact = teach[0];
  if (!fact || pack.sessionOpening) return "";
  const title = pack.now.title;
  const artist = pack.now.artist;
  const core = fact.sentence.replace(/[.!?]+$/g, "");
  const parts = [`Up next, ${title} by ${artist}.`];
  const payoff = pack.payoff?.claim.replace(/[.!?]+$/g, "");
  if (payoff && payoff.toLowerCase() !== core.toLowerCase()) parts.push(`${payoff}.`);
  parts.push(`${core}, ${whyClause(pack, fact)}.`);
  const second = pack.depth === "directors_cut" ? teach[1] : undefined;
  if (second) {
    const extra = second.sentence.replace(/[.!?]+$/g, "");
    if (extra.toLowerCase() !== core.toLowerCase()) parts.push(`${extra}, and that belongs in the same story.`);
  }
  parts.push(pack.tease ? `After that, ${pack.tease.claim}` : `${title}.`);
  return parts.join(" ");
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
  const payoffNote = pack.payoff
    ? ` You may also say this promised fact, and no other extra fact: ${pack.payoff.claim}`
    : "";
  const featuredFact = teach[0]
    ? `The fact you teach is: ${teach[0].sentence}`
    : "";
  const secondFact = pack.depth === "directors_cut" && teach[1]
    ? `Director's Cut may add this second fact in the same arc, and no other fact: ${teach[1].sentence}`
    : pack.depth !== "directors_cut" && teach[0]
      ? `The only new fact you may teach about this song is: ${teach[0].sentence} Do not mention any other person, place, or year from the sheet.`
      : "";
  const oneFact = [featuredFact, secondFact, payoffNote, closer].filter(Boolean).join(" ");
  const seconds = pack.depth === "directors_cut"
    ? "Aim for 20 to 30 seconds. Go longer only when the featured facts are rich. Prefer shorter."
    : pack.depth === "standard"
      ? "Keep it short."
      : "Aim for 12 to 20 seconds. Prefer shorter.";
  const length = pack.length.minWords > 0
    ? `Length: ${pack.length.minWords} to ${pack.length.maxWords} words. ${seconds} Do not pad. If you are short, say why the fact matters. Do not add a credit to fill the time. If the sheet is thin, stop when the fact is told.`
    : `Length: at most ${pack.length.maxWords} words. ${seconds} Do not pad.`;
  const beats = pack.nuggets.length > 0
    ? "Three beats, in this order. Hook: say the one featured fact. Never open with fun fact, never did you know. Payoff: one short beat on why that fact matters. Handoff: the last sentence names the upcoming song, or promises the one backed next-song fact. About three sentences. Not six."
    : "One short human line that names the upcoming title and artist. No invented color.";
  const banned = 'Banned, even as glue: unique, resonates, showcasing, talents, talent, depth, discography, dynamic, heritage, intricate, multi-instrumental, collaborative effort, haunting, soundscape, iconic, groundbreaking, timeless, journey, vibe, vibes, distinct character, draws you in, sets the tone, personal experience, really feel, "dive into", "dive in", "stay tuned", "stick around". Do not praise the song with incredible, special, or captivating.';
  const creditRule = "Never read a credit roll. Do not list three or more instruments, producers, or guests in a row. If the sheet has many credits, say the one featured fact and leave the rest unspoken.";
  const tease = pack.tease
    ? `Backed tease: the last sentence must promise this and only this about the following song: ${pack.tease.claim} One short promise. Not a credit list. That promise is not a second fact about the song that is about to play.`
    : "";
  const payoff = pack.payoff
    ? `You must pay off this promise from the previous break before you teach a new fact: ${pack.payoff.claim}`
    : "";

  const system = [
    "You write one spoken radio line for the song that is about to play. Sound like a human DJ who loves this music.",
    "One surprise. Say the featured fact. Say why it matters in one short beat. Hand off. Director's Cut may use at most two featured facts, still one arc, never a stack of credits.",
    "When a fact is listed, write about 3 sentences. Sentence 1 is the hook: the featured fact in your own words. Never open with fun fact or did you know. Sentence 2 is why it matters, plus the persona's required move. Do not add a new name, place, year, number, or instrument in sentence 2. Sentence 3 is the handoff: it names the upcoming song. If a next-song promise is listed, sentence 3 starts with After that and states only that promise. Do not write a sentence per credit.",
    "Do not invent a name, a place, or a year to fill the time. Do not mention the track number.",
    creditRule,
    beats,
    `The upcoming song is "${pack.now.title}" by ${pack.now.artist}. That is the song the listener will hear next. Name that title. Do not name a different song as what is next.`,
    previous,
    "Use pack facts only for concrete claims. They may be about the artist, the song, the album, the studio, the players and instruments, or any other true line in that list. Rephrase a listed fact in your own words. Do not invent a person, studio, year, city, chart position, gear, story, guest vocalist, or any proper noun that is not already in the facts or the upcoming title and artist.",
    "A concert hall, arena, or other live place is not a recording studio. Do not say the song was recorded at a place unless that exact place is written in the facts. Do not add a city, a chart rank, an instrument brand, or a person that is not written in the facts.",
    "Do not say filed under. Do not recite a genre tag or an era tag. If a genre word appears, it must sit inside a sentence that also states a listed fact. If the fact list is empty, do not add a scene, a decade, or a genre. Do not name a brand, a label, or a studio that is not in the pack.",
    "Name the upcoming title and artist clearly near the start, or in a clear up next. If at least one fact is listed, the line must use at least one. Soft glue words are allowed only around that real fact. They are not a substitute for it. Do not add guest vocalists, moods as facts, brand mis-says, or other soft claims that are not in the pack. Do not replace the facts with a that-was / up-next line plus mood words such as soaring, dive into, or essence of. Do not pad to a monologue. If no fact is listed, one short human identity line that names the upcoming title and artist. Not a deep dive. Not a bare title-by-artist template.",
    "Do not mention a city or a station vibe.",
    "Shorter and true beats longer and invented. Do not pad to a word count.",
    "You may rephrase the seed. You do not have to keep its words.",
    "Speak only from the sheet. Do not use anything you remember about the artist.",
    "Release year, album title, and track number are supporting. Do not make them the point when a better fact is listed.",
    length,
    oneFact,
    skeleton,
    banned,
    tease,
    payoff,
    DEPTH_LINE[pack.depth],
    PERSONA_LINE[pack.personaId] ?? PERSONA_LINE["standard-broadcast"],
    shapeLine(pack),
    pack.allowExplicit ? "" : "Keep the language FCC clean.",
    exampleBreak(pack)
      ? `Write this line, or a close paraphrase that keeps these same facts and does not add an adjective. Do not say signature, mood, texture, or sound as praise. Do not add a compliment, a second credit, or a fact you remember: ${exampleBreak(pack)}`
      : "",
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
  const lockNames = [
    ...teach.flatMap((nugget) => [
      ...(nugget.names ?? []),
      ...(nugget.places ?? []),
      ...(nugget.years ?? []).map(String),
      ...(nugget.instruments ?? []),
    ]),
    ...(pack.tease ? [...pack.tease.names, ...pack.tease.places, ...pack.tease.years.map(String), ...pack.tease.instruments] : []),
    ...(pack.payoff ? [...pack.payoff.names, ...pack.payoff.places, ...pack.payoff.years.map(String)] : []),
  ];
  const allowedNames = [...new Set(lockNames.map((item) => item.trim()).filter(Boolean))];

  const user = [
    `Upcoming title: ${pack.now.title}`,
    `Upcoming artist: ${pack.now.artist}`,
    `Depth: ${pack.depth}`,
    `Fact cap: ${pack.maxNuggets}`,
    `Words: ${pack.length.minWords}-${pack.length.maxWords}`,
    `Teach from these facts:\n${teachLines}`,
    `Supporting only, do not lead with these:\n${supportLines}`,
    `Identity lock: you may also say only these, plus the title and artist: ${allowedNames.join(", ") || "(none)"}. Do not say any other person, place, year, or instrument. Do not read a credit roll.`,
    pack.tease ? `Next-song promise, one short line, not a credit list:\n${claimLine(pack.tease)}` : "",
    pack.payoff ? `Promise to pay off:\n${claimLine(pack.payoff)}` : "",
    `Facts:\n${nuggetLines}`,
    `Seed you may rephrase:\n${draft}`,
  ].filter(Boolean).join("\n");

  return { system, user };
}

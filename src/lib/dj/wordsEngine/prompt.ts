/**
 * Prompt for one New break.
 * The model always writes the spoken line. Persona is the voice, not a tag.
 * It does not use the Classic teaching contract.
 */

import { titleForSpeech } from "@/lib/dj/trackSpeech";
import type { FactPack, FactNugget } from "./types";
import type { SheetClaim } from "./claims";
import {
  cannedSongHandoff,
  cueSpoken,
  earCue,
  repeatsSentenceShape,
  weaveCueIntoFact,
} from "./variety";

export { earCue };

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
  const shapes = [
    "Shape: open on the fact, then why it matters, then name the song.",
    "Shape: name the song first, then the fact, then why it matters.",
    "Shape: up next and the song name, then why it matters, then the fact. Do not open with That was.",
    "Shape: open on the artist, then the fact, then why it matters, and name the song at the end.",
    "Shape: open on why the fact matters, then the fact, then name the song.",
  ];
  return shapes[((pack.shapeVariant % 5) + 5) % 5]!;
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

/** Banned on every break. The old Guide closer. */
export const BANNED_BREAK_SKELETON = /when the song opens|because that is the part to hear|the part to hear on this (?:song|one)|so listen for\b/i;

/**
 * A second sentence that still names something from this fact.
 * Five shapes, so the glue is not one sentence every time.
 * A listen-for is only a sound. A studio, a label, a year, and an album are not sounds.
 */
function personaClause(pack: FactPack, core: string): string {
  if (pack.personaId === "sarcastic-critic" && !/\b(?:works|earns|thin|holds|lands)\b/i.test(core)) {
    return `${core.replace(/[.!?]+$/g, "")}, and that earns it`;
  }
  if (
    pack.personaId === "the-musicologist"
    && !/\b(?:recorded|produced|formed|before|after|lineage|member|credited|album|left|\d{4})\b/i.test(core)
  ) {
    return `${core.replace(/[.!?]+$/g, "")}, which is where this sits in the line that came before`;
  }
  return core.replace(/[.!?]+$/g, "");
}

/** A reason to stay for the next song. Never "After that, <fact>". */
export function teaseHook(claim: SheetClaim): string {
  const guest = claim.names.map((name) => name.trim()).find(Boolean) ?? "";
  const singing = claim.instruments.includes("vocals") || /\bvocal/i.test(claim.claim);
  if (guest && /\b(?:guest|featuring|featured)\b/i.test(claim.claim)) {
    return singing
      ? `Stick around, the next one has ${guest} singing.`
      : `Stick around, the next one has ${guest} on it.`;
  }
  const place = claim.places[0]?.trim();
  if (place && /\brecorded\b/i.test(claim.claim)) {
    return `Stick around, the next one was recorded at ${place}.`;
  }
  const core = claim.claim.replace(/[.!?]+$/g, "").trim();
  return `Stick around, ${core}.`;
}

function guideVoice(pack: FactPack): string {
  const featured = pack.nuggets.filter((nugget) => nugget.topic !== "release");
  const fact = featured[0] ?? pack.nuggets[0];
  const cue = fact ? earCue(fact) : null;
  if (cue) {
    return `Voice: The Guide. Posture: invitation. Required move: people and the story. The hearable cue on the sheet is ${cueSpoken(cue)}. Weave it into the fact sentence, for example "that's the ${cueSpoken(cue)} you'll hear". Do not write a separate "Hear the" or "Listen for" sentence. Do not add a feeling about the song. Do not judge the song. No catchphrase. Do not say "when the song opens". Do not say "because that is the part to hear". Do not say "so listen for".`;
  }
  return "Voice: The Guide. Posture: invitation. Required move: people and the story. This fact is not a sound you can point at. Do not invent a listen-for. Do not say listen for, notice how, or hear the. Name the person or the story in a normal sentence. Do not write a feeling. No catchphrase.";
}

function linkedExtra(first: FactNugget, second: FactNugget): string {
  const shared = (first.names ?? []).find((name) =>
    (second.names ?? []).some((other) => other.toLowerCase() === name.toLowerCase()),
  );
  if (!shared) return "";
  const extra = second.sentence.replace(/[.!?]+$/g, "").trim();
  if (!extra || extra.toLowerCase() === first.sentence.replace(/[.!?]+$/g, "").trim().toLowerCase()) return "";
  return `${extra}, the same one.`;
}

/**
 * Six shapes of a real break. They do not share a connector.
 * They are not this song. Do not copy their names.
 */
export const VOICE_EXAMPLES = [
  "Matt Berninger sings this one. The voice sits up front. Here's Bloodbuzz Ohio.",
  "Coming up is I Need My Girl. He wrote it about getting home. Here's I Need My Girl.",
  "Up next, Fake Empire by The National. Bryan Devendorf is on the drums you'll hear.",
  "Aaron Dessner and Bryce Dessner are brothers in this band. Here's Graceless.",
  "Holocene was the second single. It charted on its own. Here's Holocene.",
  "Stick around, the next one has Phoebe Bridgers singing.",
].join(" ");

function renderBreak(pack: FactPack, variant: number, fact: FactNugget, teach: FactNugget[]): string {
  const title = titleForSpeech(pack.now.title);
  const artist = pack.now.artist.trim();
  const cue = earCue(fact);
  const woven = personaClause(pack, weaveCueIntoFact(fact.sentence, cue));
  let body = "";
  switch (variant) {
    case 1:
      body = `Coming up, ${title} by ${artist}. ${woven}.`;
      break;
    case 2:
      body = `Up next, ${title} by ${artist}. ${woven}.`;
      break;
    case 3:
      body = `${artist} — ${woven}. This is ${title}.`;
      break;
    case 4:
      body = `Here's ${title}. ${woven}. From ${artist}.`;
      break;
    default:
      body = `${woven}. That's ${title} by ${artist}.`;
  }
  const second = pack.depth === "directors_cut" ? teach[1] : undefined;
  const linked = second ? linkedExtra(fact, second) : "";
  if (linked) body = `${body} ${linked}`;
  if (pack.tease) body = `${body} ${teaseHook(pack.tease)}`;
  return body.replace(/\s+/g, " ").replace(/\s+\./g, ".").trim();
}

/** A legal line for this break's shape. Five shapes, so the closer is not one skeleton. */
export function exampleBreak(pack: FactPack): string {
  const featured = pack.nuggets.filter((nugget) => nugget.topic !== "release");
  const teach = featured.length ? featured : pack.nuggets;
  const fact = teach[0];
  if (!fact || pack.sessionOpening) return "";
  const start = ((pack.shapeVariant % 5) + 5) % 5;
  let chosen = "";
  for (let offset = 0; offset < 5; offset += 1) {
    const variant = (start + offset) % 5;
    const body = renderBreak(pack, variant, fact, teach);
    if (cannedSongHandoff(body)) continue;
    if (repeatsSentenceShape(body, pack)) continue;
    chosen = body;
    break;
  }
  return chosen || renderBreak(pack, start, fact, teach);
}

export function spokenSkeleton(script: string): string {
  return script
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, "#")
    .replace(/\b[a-z]{5,}\b/g, "w")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildNewWordsPrompt(pack: FactPack, draft: string): { system: string; user: string } {
  const nuggetLines = pack.nuggets.length
    ? pack.nuggets.map((nugget) => `- ${nugget.sentence}`).join("\n")
    : "- (none — title and artist only)";
  const previous = finishedSongRule(pack);

  const featured = pack.nuggets.filter((nugget) => nugget.topic !== "release");
  const supporting = pack.nuggets.filter((nugget) => nugget.topic === "release");
  const teach = featured.length ? featured : pack.nuggets;
  const guideFact = teach[0];
  const guideCue = guideFact ? earCue(guideFact) : null;
  const skeleton = pack.personaId === "warm-companion"
    ? guideCue
      ? `Weave ${cueSpoken(guideCue)} into the fact sentence. Do not add a sentence that is only "Hear the" or "Listen for". Do not add a feeling. Do not say "when the song opens". Do not say "because that is the part to hear". Do not say "so listen for".`
      : 'Say the person or the story in the fact sentence. Do not invent a listen-for. Do not say "listen for", "notice how", or "hear the". Do not write a feeling. Do not say album number.'
    : pack.personaId === "sarcastic-critic"
      ? "Sentence 2 must include one of these words, tied to a player, an instrument, a producer, or a studio already in the fact: works, earns, thin, holds, lands. Do not write a feeling."
      : pack.personaId === "the-musicologist"
        ? "Place the fact in the catalog in a normal sentence: where this sits, who is credited, or what came before. Do not add a second credit. Do not read a list. Do not write a feeling. Do not say album number."
        : "The middle sentence says the fact in plain speech. Do not write a feeling. Do not say album number. Do not shorten an album title.";
  const spokenTitle = titleForSpeech(pack.now.title);
  const closer = pack.tease
    ? `Name "${spokenTitle}" somewhere in the line. Do not write "up next" unless that same sentence names "${spokenTitle}". The last sentence is this hook and nothing else: ${teaseHook(pack.tease)} Do not write "After that". Do not write "The song is ${spokenTitle}, from ${pack.now.artist}".`
    : `Name "${spokenTitle}" and ${pack.now.artist} somewhere in the line. You may end on the fact. Do not write "The song is ${spokenTitle}, from ${pack.now.artist}". Use "Here's ${spokenTitle}." only if this station has not already used that handoff.`;
  const payoffNote = pack.payoff
    ? ` Do not say this again. A previous break already told it: ${pack.payoff.claim} Teach a different fact.`
    : "";
  const featuredFact = teach[0]
    ? `The fact you teach is: ${teach[0].sentence}`
    : "";
  const secondFact = pack.depth === "directors_cut" && teach[1]
    ? `These two facts are the same person or the same place. Say them as one thought, with "the same" or "who". If you cannot connect them, say only the first: ${teach[0]?.sentence ?? ""} ${teach[1].sentence}`
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
    ? `Length: ${pack.length.minWords} to ${pack.length.maxWords} words. ${seconds} Do not pad. If you are short, say the fact once more in plain speech. Do not add a credit, a label, or a compliment to fill the time. If the sheet is thin, stop when the fact is told.`
    : `Length: at most ${pack.length.maxWords} words. ${seconds} Do not pad.`;
  const beats = pack.nuggets.length > 0
    ? "Say the featured fact as a normal sentence. If there is something to hear, weave it into that same sentence. Then a tease when one is listed, or stop on the fact. A title line is optional and must not repeat a handoff this station already used. Never open with fun fact, did you know, or \"The song is\". Do not write \"Hear the\" or \"Listen for\" as its own sentence. About two or three sentences. Not six. Do not open every break the same way."
    : "One short human line that names the upcoming title and artist. No invented color.";
  const banned = 'Banned, even as glue: unique, resonates, showcasing, talents, talent, depth, discography, dynamic, heritage, intricate, multi-instrumental, collaborative effort, haunting, soundscape, iconic, groundbreaking, timeless, journey, vibe, vibes, distinct character, draws you in, sets the tone, personal experience, really feel, "dive into", "dive in", "stay tuned", recognized for, "known for its", "influential roster", acclaimed. Do not praise the song with incredible, special, or captivating. Also banned unless those exact words are already on the sheet: evolution, growth, milestone, distinctive, unique sound, deep emotions, relate to, capturing, set the stage, shapes the song, shaping the song, shapes their sound, collaboration shapes, personal touch, expertise, his style, remarkable, prowess, versatility, powerful. Do not say lends his voice, lyricist, or featured unless the sheet uses that word. Do not say album number. Do not say "the number of the album". Do not shorten an album title to its last word.';
  const creditRule = "Never read a credit roll. Do not list three or more instruments, producers, or guests in a row. If the sheet has many credits, say the one featured fact and leave the rest unspoken.";
  const tease = pack.tease
    ? `Next-song hook, last sentence, only this, from the next song: ${teaseHook(pack.tease)} Do not write "After that". Do not use a fact from the song that is about to play.`
    : "";
  const payoff = pack.payoff
    ? `The previous break already said: ${pack.payoff.claim} Do not say that fact again. Teach the new fact. A deeper detail about the same person is fine when it is a different fact on the sheet.`
    : "";
  const avoidConnectors = (pack.usedConnectors ?? []).slice(-8);
  const avoidLine = avoidConnectors.length
    ? `Do not use these lines again: ${avoidConnectors.join(" | ")}`
    : "";

  const system = [
    "You write one spoken radio line for the song that is about to play. Sound like a DJ telling a friend one thing they did not know, in normal spoken English. One new fact. No stock closer.",
    `Examples of the voice, about other songs. Do not copy their names onto this song: ${VOICE_EXAMPLES}`,
    "Say the featured fact in the words you were given. Those words are already a sentence. Do not turn them into a template. Do not say album number. Do not shorten an album title. If two facts are listed, connect them with the same person or place, or say only the first. Never stack a guest, a label, and a player.",
    "When a fact is listed, write two or three sentences. Say the featured fact in your own words, and weave any hearable cue into that same sentence. You may end on the fact. A title line is optional. Never use the same handoff twice. Never write \"The song is\" followed by the title and \"from\" the artist. Never write \"Hear the\" or \"Listen for\" as its own sentence. Do not add a new name, place, year, number, or instrument. Do not write evolution, growth, a distinctive sound, or deep emotions. If a next-song hook is listed, the last sentence is that hook. Never open with fun fact or did you know. Do not write After that.",
    "Do not invent a name, a place, or a year to fill the time. Do not mention the track number.",
    creditRule,
    beats,
    `The upcoming song is "${spokenTitle}" by ${pack.now.artist}. That is the song the listener will hear next. Say that title without a featuring parenthesis. Do not name a different song as what is next.`,
    previous,
    "Use pack facts only for concrete claims. They may be about the artist, the song, the album, the studio, the players and instruments, or any other true line in that list. Rephrase a listed fact in your own words. Do not invent a person, studio, year, city, chart position, gear, story, guest vocalist, or any proper noun that is not already in the facts or the upcoming title and artist.",
    "A concert hall, arena, or other live place is not a recording studio. Do not say the song was recorded at a place unless that exact place is written in the facts. Do not add a city, a chart rank, an instrument brand, or a person that is not written in the facts.",
    "Do not say filed under. Do not recite a genre tag or an era tag. If a genre word appears, it must sit inside a sentence that also states a listed fact. If the fact list is empty, do not add a scene, a decade, or a genre. Do not name a brand, a label, or a studio that is not in the pack.",
    "Name the upcoming title and artist clearly near the start, or in a clear up next. If at least one fact is listed, the line must use at least one. Soft glue words are allowed only around that real fact. They are not a substitute for it. Do not add guest vocalists, moods as facts, brand mis-says, or other soft claims that are not in the pack. Do not replace the facts with a that-was / up-next line plus mood words such as soaring, dive into, or essence of. Do not pad to a monologue. If no fact is listed, one short human identity line that names the upcoming title and artist. Not a deep dive. Not a bare title-by-artist template.",
    "Do not mention a city or a station vibe.",
    "Shorter and true beats longer and invented. Do not pad to a word count.",
    "Speak only from the sheet. Do not use anything you remember about the artist.",
    "Release year, album title, and track number are supporting. Do not make them the point when a better fact is listed.",
    length,
    oneFact,
    skeleton,
    banned,
    'Also banned, even once: "That\'s the part worth knowing", "That\'s the record this song is on", "That\'s where they got started", "which is where you\'ll find this track", "That\'s where they cut this one", "That\'s who wrote this one". Do not reuse a connector you already used on this station.',
    tease,
    payoff,
    avoidLine,
    DEPTH_LINE[pack.depth],
    pack.personaId === "warm-companion"
      ? guideVoice(pack)
      : (PERSONA_LINE[pack.personaId] ?? PERSONA_LINE["standard-broadcast"]),
    shapeLine(pack),
    pack.allowExplicit ? "" : "Keep the language FCC clean.",
    "Never write \"when the song opens\". Never write \"because that is the part to hear\". Never write \"so listen for\". Never open a sentence with only the artist name or only the title.",
    exampleBreak(pack)
      ? `A legal draft for this break. You may say it, or rephrase it in the same shape without adding a fact, a name, or a stock closer: ${exampleBreak(pack)}`
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
    `Upcoming title: ${titleForSpeech(pack.now.title)}`,
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
    `Draft you may say or rephrase. Do not add a sentence, a name, or a stock closer:\n${draft}`,
  ].filter(Boolean).join("\n");

  return { system, user };
}

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
  earCue,
  factSentences,
  freshFactSentence,
  repeatsSentenceShape,
  weaveCueIntoFact,
} from "./variety";

export { earCue };

const DEPTH_LINE: Record<FactPack["depth"], string> = {
  standard: "Standard: name the song and the artist. No extra facts. One short reaction is allowed.",
  roots_branches: "Roots & Branches: that identity plus one fact from the pack when one is listed.",
  time_capsule: "Sonic Time Capsule: that identity plus the one featured fact. Do not invent a second fact.",
  directors_cut: "Director's Cut: one arc, at most two featured facts, and only when they are the same person or the same place. If the pack has no facts, one short line using only the title and artist.",
};

const PERSONA_LINE: Record<string, string> = {
  "warm-companion": "Voice: The Guide. Posture: invitation. Talk about the people and the story. Do not invent a listen-for.",
  "sarcastic-critic": "Voice: The Critic. Posture: taste. Make one fair judgment tied to a player, an instrument, a producer, or a studio already in the fact. No insults.",
  "the-musicologist": "Voice: The Archivist. Posture: catalog. Place the fact in the lineage: where this sits, who plays it, or what came before, using only the sheet.",
  "standard-broadcast": "Voice: Standard Broadcast. Posture: handoff. Give one strong fact, then name the song.",
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
  return "Name the song and the artist once, in the same break as the fact.";
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

/** A few ways to spend the next-song fact. Each one is a different sentence shape. */
export function teaseVariants(claim: SheetClaim): string[] {
  const core = claim.claim.replace(/[.!?]+$/g, "").trim();
  const lines = [
    teaseHook(claim),
    `Next, ${core}.`,
    `The next song: ${core}.`,
    `${core}, on the next one.`,
  ];
  return [...new Set(lines)];
}

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

function linkedExtra(first: FactNugget, second: FactNugget): string {
  const shared = (first.names ?? []).find((name) =>
    (second.names ?? []).some((other) => other.toLowerCase() === name.toLowerCase()),
  );
  if (!shared) return "";
  const extra = second.sentence.replace(/[.!?]+$/g, "").trim();
  if (!extra || extra.toLowerCase() === first.sentence.replace(/[.!?]+$/g, "").trim().toLowerCase()) return "";
  return `${extra}, the same one.`;
}

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

function alreadySaid(pack: FactPack): string {
  const shapes = (pack.usedShapes ?? []).filter((shape) => !shape.startsWith("handoff:")).slice(-8);
  const connectors = (pack.usedConnectors ?? []).filter((line) => !line.startsWith("reaction:")).slice(-6);
  const reactions = (pack.usedConnectors ?? [])
    .filter((line) => line.startsWith("reaction:"))
    .map((line) => line.slice("reaction:".length))
    .slice(-6);
  const lines = [
    shapes.length ? `Already said, don't reuse these sentence shapes: ${shapes.join(" | ")}` : "",
    connectors.length ? `Already said, don't reuse these connectors: ${connectors.join(" | ")}` : "",
    reactions.length ? `Already used these reactions, pick a different one: ${reactions.join(" | ")}` : "",
    pack.payoff ? `Already said, don't reuse this fact: ${pack.payoff.claim}` : "",
  ].filter(Boolean);
  return lines.join(" ");
}

const REACTION_BANK = ["Turn this up", "Yeah, this one", "Play this loud", "This one gets me", "I love this one"];

export function buildNewWordsPrompt(pack: FactPack, draft: string): { system: string; user: string } {
  const featured = pack.nuggets.filter((nugget) => nugget.topic !== "release");
  const supporting = pack.nuggets.filter((nugget) => nugget.topic === "release");
  const teach = featured.length ? featured : pack.nuggets;
  const teachLines = teach.length
    ? teach.map((nugget) => `- ${freshFactSentence(nugget.sentence, pack)}`).join("\n")
    : "- (none — title and artist only)";
  const supportLines = supporting.length
    ? supporting.map((nugget) => `- ${nugget.sentence}`).join("\n")
    : "- (none)";
  const spokenTitle = titleForSpeech(pack.now.title);
  const reaction = REACTION_BANK[Math.abs(pack.shapeVariant) % REACTION_BANK.length] ?? "Turn this up";
  const persona = pack.personaId === "warm-companion" || PERSONA_LINE[pack.personaId]
    ? (PERSONA_LINE[pack.personaId] ?? PERSONA_LINE["warm-companion"])
    : PERSONA_LINE["standard-broadcast"];
  const said = alreadySaid(pack);
  const system = [
    "You are the radio DJ in the quiet between songs. Sound like a person who loves this music, telling a friend one true thing they did not know.",
    "Say the featured fact in your own words. Keep every person, the role, and any qualifier the sheet gives: assistant, co-, additional, executive, based on, the chart name, film or TV series. If several people share a credit, name them together. Do not turn a composer into a lyricist, an assistant into the engineer, or \"wrote the intro\" into \"wrote the song\". If you are unsure, leave it out.",
    "Do not invent a proper noun, a guest vocalist, a concert hall, a place, a year, or a number. Do not state moods as facts. Do not use brand mis-says. Never read a credit roll.",
    `You may add one short reaction of your own, such as "${reaction}". Vary it. A reaction is a feeling, not a fact. Do not say iconic, legendary, critically acclaimed, one of the greatest, a classic, or a masterpiece. Also banned: unique, resonates, showcasing. Do not add glue or a compliment around that fact. Do not pad to a monologue.`,
    'Never write "when the song opens". Do not invent a listen-for.',
    DEPTH_LINE[pack.depth],
    persona,
    finishedSongRule(pack),
    shapeLine(pack),
    said,
    `The upcoming song is "${spokenTitle}" by ${pack.now.artist}. Name that song once. Two or three sentences. A thin sheet stays short.`,
    pack.allowExplicit ? "" : "Keep the language clean.",
    'Return JSON only: {"script":"..."}',
  ].filter(Boolean).join(" ");

  const factLine = factSentences(draft).map((sentence) => freshFactSentence(sentence, pack)).join(" ")
    || freshFactSentence(draft, pack);
  const user = [
    `Upcoming title: ${spokenTitle}`,
    `Upcoming artist: ${pack.now.artist}`,
    `Depth: ${pack.depth}`,
    `Words: ${pack.length.minWords}-${pack.length.maxWords}`,
    `Say this fact. Keep the qualifiers:\n${teachLines}`,
    supporting.length ? `Supporting only, do not lead with these:\n${supportLines}` : "",
    pack.tease ? `Next song, one short line at the end, only if you have room:\n${claimLine(pack.tease)}` : "",
    pack.payoff ? `Do not say this again:\n${claimLine(pack.payoff)}` : "",
    factLine ? `A plain wording, so the names stay right. Say it in your own voice. Do not add a new name:\n${factLine}` : "",
  ].filter(Boolean).join("\n");

  return { system, user };
}


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
 * A real ear cue: an instrument, a guest, or the place the record was made.
 * A hometown or a formed-in city is not something to listen for.
 */
export function earCue(nugget: FactNugget): string | null {
  const listed = (nugget.instruments ?? []).find((item) => item && item !== "vocals");
  const heard = nugget.sentence.match(/\b(guitar|bass|drums|piano|keyboards|keyboard|organ|violin|saxophone|trumpet|percussion|cello|banjo|harmonica)\b/i);
  const instrument = listed || heard?.[1]?.toLowerCase();
  if (instrument) return instrument === "keyboard" ? "keyboards" : instrument;
  if (/\b(?:guest|featuring|features)\b/i.test(nugget.sentence)) {
    const guest = nugget.names?.[0]?.trim();
    if (guest) return guest;
  }
  const place = nugget.places?.[0]?.trim();
  if (place && /\b(?:recorded|produced|studio|engineered|mixed)\b/i.test(nugget.sentence)) return place;
  return null;
}

function cueSpoken(cue: string): string {
  if (/\s/.test(cue) || /studio|pond|room/i.test(cue)) return cue;
  return `the ${cue}`;
}

function whyBeat(pack: FactPack, nugget: FactNugget, variant: number): string {
  const slot = ((variant % 5) + 5) % 5;
  if (pack.personaId === "warm-companion") {
    const cue = earCue(nugget);
    if (cue) {
      const heard = cueSpoken(cue);
      const lines = [
        `Listen for ${heard}.`,
        `Notice how ${heard} comes in.`,
        `Hear ${heard} on this take.`,
        `Catch ${heard} as it enters.`,
        `${heard} is what you hear first.`,
      ];
      return lines[slot]!;
    }
    const aboutPerson = /\b(?:wrote|written|guest|sings|plays|credited|mixed by|engineered)\b/i.test(nugget.sentence)
      || /^(?!The\b)[A-Z][a-z]+ [A-Z][a-z]+ produced\b/.test(nugget.sentence);
    const lines = aboutPerson
      ? [
          "That is the person in the song.",
          "That is who stands with the song.",
          "The name in that fact is the point.",
          "Keep that name with the song.",
          "That is the people side of this one.",
        ]
      : [
          "That is the story on this record.",
          "That is where this one sits.",
          "That is the record's detail.",
          "That is the mark on this album.",
          "Keep that with the song.",
        ];
    return lines[slot]!;
  }
  if (pack.personaId === "sarcastic-critic") {
    const lines = [
      "That choice earns the song.",
      "That is what holds the take.",
      "That is what works.",
      "That is what lands.",
      "That is what earns the take.",
    ];
    return lines[slot]!;
  }
  if (pack.personaId === "the-musicologist") {
    const lines = [
      "That is the lineage.",
      "That came before the later work.",
      "That is where this sits.",
      "That is the catalog spot.",
      "That history is the point.",
    ];
    return lines[slot]!;
  }
  const lines = [
    "That is the detail on this one.",
    "That is the fact for this song.",
    "That is the one to carry in.",
    "That is the note, then the song.",
    "Then the song.",
  ];
  return lines[slot]!;
}

function guideVoice(pack: FactPack): string {
  const featured = pack.nuggets.filter((nugget) => nugget.topic !== "release");
  const fact = featured[0] ?? pack.nuggets[0];
  const cue = fact ? earCue(fact) : null;
  if (cue) {
    return `Voice: The Guide. Posture: invitation. Required move: people and the story, then one thing to hear. The hearable cue on the sheet is ${cueSpoken(cue)}. Use fresh wording: listen for, notice how, or hear. Do not judge the song. No catchphrase. Do not say "when the song opens". Do not say "because that is the part to hear". Do not say "so listen for".`;
  }
  return "Voice: The Guide. Posture: invitation. Required move: people and the story. This fact is not a sound you can point at. Do not invent a listen-for. Do not say listen for, notice how, or hear the. Name the person or the story. No catchphrase.";
}

/** A legal line for this break's shape. Five shapes, so the closer is not one skeleton. */
export function exampleBreak(pack: FactPack): string {
  const featured = pack.nuggets.filter((nugget) => nugget.topic !== "release");
  const teach = featured.length ? featured : pack.nuggets;
  const fact = teach[0];
  if (!fact || pack.sessionOpening) return "";
  const variant = ((pack.shapeVariant % 5) + 5) % 5;
  const title = pack.now.title.trim();
  const artist = pack.now.artist.trim();
  const core = fact.sentence.replace(/\s+/g, " ").trim();
  const why = whyBeat(pack, fact, variant);
  const name = `${title} by ${artist}.`;
  const upNext = `Up next, ${title} by ${artist}.`;
  let body = "";
  switch (variant) {
    case 1:
      body = `${name} ${core} ${why}`;
      break;
    case 2:
      body = `${upNext} ${why} ${core}`;
      break;
    case 3:
      body = `${artist}. ${core} ${why}`;
      break;
    case 4:
      body = `${why} ${core} ${name}`;
      break;
    default:
      body = `${core} ${why} ${name}`;
  }
  const payoff = pack.payoff?.claim.replace(/\s+/g, " ").trim();
  if (payoff && payoff.toLowerCase() !== core.toLowerCase()) body = `${payoff} ${body}`;
  const second = pack.depth === "directors_cut" ? teach[1] : undefined;
  if (second) {
    const extra = second.sentence.replace(/\s+/g, " ").trim();
    if (extra.toLowerCase() !== core.toLowerCase()) body = `${body} ${extra}`;
  }
  if (pack.tease) {
    const tease = pack.tease.claim.replace(/[.!?]+$/g, "").trim();
    body = `${body} After that, ${tease}.`;
  }
  const sentences = body.split(/(?<=[.!?])\s+/).filter(Boolean);
  const last = sentences[sentences.length - 1]?.toLowerCase() ?? "";
  const titleLower = title.toLowerCase();
  if (!pack.tease && titleLower && !last.includes(titleLower)) body = `${body} ${title}.`;
  return body.replace(/\s+/g, " ").trim();
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
      ? `Sentence 2 names ${cueSpoken(guideCue)} with fresh wording: listen for, notice how, or hear. Do not say "when the song opens". Do not say "because that is the part to hear". Do not say "so listen for".`
      : 'Sentence 2 is the people or the story. Do not invent a listen-for. Do not say "listen for", "notice how", or "hear the".'
    : pack.personaId === "sarcastic-critic"
      ? "Sentence 2 must include one of these words, tied to a sheet credit: works, earns, thin, holds, lands."
      : pack.personaId === "the-musicologist"
        ? "Place the fact in the catalog: lineage, what came before, or the credit already in the fact. Do not add a second credit. Do not read a list."
        : "Keep the middle sentence to the one fact.";
  const closer = pack.tease
    ? `Name "${pack.now.title}" in the line. Do not write "up next" unless that same sentence names "${pack.now.title}". The last sentence must say "after that" and promise only this: ${pack.tease.claim}`
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
    ? "Three beats, in the shape given for this break. The featured fact. One short beat on why it matters. A handoff that names the upcoming song, or the one backed next-song promise. Never open with fun fact or did you know. About three sentences. Not six. Do not open every break the same way."
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
    "When a fact is listed, write about 3 sentences that follow this break's shape. Say the featured fact in your own words. Say why it matters in the host's voice. Do not add a new name, place, year, number, or instrument in that why beat. The handoff names the upcoming song. If a next-song promise is listed, the last sentence starts with After that and states only that promise. Never open with fun fact or did you know. Do not write a sentence per credit.",
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
    pack.personaId === "warm-companion"
      ? guideVoice(pack)
      : (PERSONA_LINE[pack.personaId] ?? PERSONA_LINE["standard-broadcast"]),
    shapeLine(pack),
    pack.allowExplicit ? "" : "Keep the language FCC clean.",
    "Do not reuse one sentence skeleton from break to break. Never write \"when the song opens\". Never write \"because that is the part to hear\". Never write \"so listen for\".",
    exampleBreak(pack)
      ? `One legal telling for this break's shape. Rephrase it. Do not add a fact, a credit, or a compliment: ${exampleBreak(pack)}`
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

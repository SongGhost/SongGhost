/**
 * Turn a fact pack into one spoken break.
 * The model writes the line whenever New is on, including an empty pack.
 * If that line fails the gate, the listener hears a short true draft.
 */

import { getStationLaunchClips } from "@/lib/dj/scriptGenerator";
import { exampleBreak } from "./prompt";
import { formatTrackByline, titleForSpeech } from "@/lib/dj/trackSpeech";
import {
  isCannedTitleByArtist,
  nuggetIdsUsedInScript,
  scriptPassesGate,
  usesMainFact,
  wordCeiling,
  wordCount,
} from "./gate";
import type { FactPack } from "./types";

export type ComposedBreak = {
  script: string;
  fellBack: boolean;
  usedNuggetIds: string[];
};

/** Song 1. The existing short station welcome. Not a fact-pack break. */
export function stationWelcomeLine(pack: Pick<FactPack, "stationName" | "now">): string {
  return getStationLaunchClips(
    pack.stationName?.trim() || "SongHost",
    pack.now.artist,
    pack.now.title,
  ).line;
}

function spokenByline(pack: FactPack): string {
  const title = titleForSpeech(pack.now.title);
  const artist = pack.now.artist.trim();
  if (title && artist) return `${title} by ${artist}`;
  return title || artist || "this one";
}

function nowLine(pack: FactPack): string {
  return `${spokenByline(pack)}.`;
}

function upNextLine(pack: FactPack): string {
  return `Up next, ${spokenByline(pack)}.`;
}

/** Song-1 exit only. Later breaks must not use this. */
function firstExitLine(pack: FactPack): string {
  const now = spokenByline(pack);
  const was = pack.previous?.title || pack.previous?.artist
    ? `That was ${formatTrackByline(pack.previous)}.`
    : "";
  const past = pack.pastNugget?.sentence ?? "";
  return joinParts([was, past, `Up next, ${now}.`]);
}

function idsSpoken(script: string, pack: FactPack, nuggetIds: string[]): string[] {
  const album = pack.previous?.album?.trim().toLowerCase();
  if (!pack.pastNugget || !album || !script.toLowerCase().includes(album)) return nuggetIds;
  if (nuggetIds.includes(pack.pastNugget.id)) return nuggetIds;
  return [...nuggetIds, pack.pastNugget.id];
}

/**
 * An empty fact pack is still a spoken line.
 * It names this song. It is not the bare "Title by Artist." template.
 */
function humanIdentityLine(pack: FactPack): string {
  const byline = spokenByline(pack);
  const title = titleForSpeech(pack.now.title);
  const artist = pack.now.artist.trim();
  if (pack.songOneExit) return firstExitLine(pack);
  if (pack.shape === "catchup") return upNextLine(pack);
  if (!title || !artist) return `${byline}.`;
  switch (pack.shapeVariant) {
    case 1:
      return `${artist}. The song is ${title}.`;
    case 2:
      return `Up next, ${title}. That's ${artist}.`;
    default:
      return `This one is ${title}, from ${artist}.`;
  }
}

/** The best fact that is not "released in" or "track number". */
function bestNugget(pack: FactPack): FactPack["nuggets"][number] | undefined {
  return pack.nuggets.find((nugget) => nugget.topic !== "release") ?? pack.nuggets[0];
}

/**
 * One true line when the writer misses twice.
 * The shape rotates. It does not upgrade "credited on" into "plays".
 */
export function oneFactLine(pack: FactPack): { script: string; usedNuggetIds: string[] } {
  if (pack.songOneExit) {
    const script = firstExitLine(pack);
    return { script, usedNuggetIds: idsSpoken(script, pack, []) };
  }
  const sample = exampleBreak(pack);
  const nugget = bestNugget(pack);
  if (sample) {
    const ids = [nugget?.id, pack.payoff?.id].filter((id): id is string => Boolean(id));
    return { script: sample, usedNuggetIds: ids };
  }
  if (pack.payoff) {
    const script = `Up next, ${spokenByline(pack)}. ${pack.payoff.claim}`;
    return { script, usedNuggetIds: [pack.payoff.id] };
  }
  return { script: humanIdentityLine(pack), usedNuggetIds: [] };
}

function joinParts(parts: Array<string | undefined>): string {
  return parts
    .map((part) => part?.replace(/\s+/g, " ").trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

function leadLine(pack: FactPack, nuggets: FactPack["nuggets"]): string {
  if (pack.songOneExit) return firstExitLine(pack);
  const bareIdentity =
    nuggets.length === 0
    && (pack.shape === "lore" || pack.shape === "teaser");
  if (bareIdentity) return humanIdentityLine(pack);
  if (pack.shape === "catchup" || pack.shapeVariant === 2) return upNextLine(pack);
  return nowLine(pack);
}

function assemble(pack: FactPack, nuggets: FactPack["nuggets"]): string {
  const names = leadLine(pack, nuggets);
  const sentences = nuggets.map((nugget) => nugget.sentence);
  if (
    pack.shapeVariant === 1
    && sentences.length > 0
    && pack.shape !== "catchup"
    && !pack.songOneExit
  ) {
    return joinParts([...sentences, names]);
  }
  return joinParts([names, ...sentences]);
}

export function composeDraft(pack: FactPack): ComposedBreak {
  if (pack.sessionOpening) {
    return { script: stationWelcomeLine(pack), fellBack: false, usedNuggetIds: [] };
  }
  if (pack.shape === "stinger") {
    const name = pack.stationName?.trim() ?? "";
    const script = name && !name.includes(":") ? `${name}.` : "Back in a moment.";
    return { script, fellBack: false, usedNuggetIds: [] };
  }
  if (pack.shape === "song_id") {
    return { script: nowLine(pack), fellBack: false, usedNuggetIds: [] };
  }
  if (pack.shape === "recap") {
    const script = pack.songOneExit ? firstExitLine(pack) : upNextLine(pack);
    return { script, fellBack: false, usedNuggetIds: idsSpoken(script, pack, []) };
  }

  const capped = pack.nuggets.slice(0, pack.maxNuggets);
  const ceiling = wordCeiling({ ...pack, nuggets: capped });
  const kept: FactPack["nuggets"] = [];
  for (const nugget of capped) {
    const next = assemble(pack, [...kept, nugget]);
    if (wordCount(next) > ceiling) break;
    kept.push(nugget);
  }
  const script = assemble(pack, kept);
  return {
    script,
    fellBack: false,
    usedNuggetIds: idsSpoken(script, pack, kept.map((nugget) => nugget.id)),
  };
}

function readModelScript(modelText: string): string {
  const trimmed = modelText.trim();
  if (!trimmed.startsWith("{")) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as { script?: unknown };
    return typeof parsed.script === "string" ? parsed.script.trim() : "";
  } catch {
    return "";
  }
}

export function composeNewBreak(pack: FactPack, modelText: string | null | undefined): ComposedBreak {
  if (pack.sessionOpening) {
    return { script: stationWelcomeLine(pack), fellBack: false, usedNuggetIds: [] };
  }
  if (
    pack.shape === "stinger"
    || pack.shape === "song_id"
    || pack.shape === "recap"
    || pack.shape === "catchup"
    || pack.songOneExit
  ) {
    const special = composeDraft(pack);
    const candidate = modelText?.trim() ? readModelScript(modelText) : "";
    if (candidate && scriptPassesGate(candidate, pack)) {
      return {
        script: candidate,
        fellBack: false,
        usedNuggetIds: idsSpoken(candidate, pack, nuggetIdsUsedInScript(candidate, pack)),
      };
    }
    return { ...special, fellBack: Boolean(candidate) };
  }

  const candidate = modelText?.trim() ? readModelScript(modelText) : "";
  if (candidate && scriptPassesGate(candidate, pack) && usesMainFact(candidate, pack)) {
    return {
      script: candidate,
      fellBack: false,
      usedNuggetIds: idsSpoken(candidate, pack, nuggetIdsUsedInScript(candidate, pack)),
    };
  }
  const fallback = oneFactLine(pack);
  if (!isCannedTitleByArtist(fallback.script, pack)) {
    return { script: fallback.script, fellBack: true, usedNuggetIds: fallback.usedNuggetIds };
  }
  const shortest = humanIdentityLine(pack);
  return {
    script: shortest,
    fellBack: true,
    usedNuggetIds: [],
  };
}

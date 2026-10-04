/**
 * Turn a fact pack into one spoken break.
 * The model writes the line whenever New is on, including an empty pack.
 * If that line fails the gate, the listener hears a short true draft.
 */

import { getStationLaunchClips } from "@/lib/dj/scriptGenerator";
import { formatTrackByline } from "@/lib/dj/trackSpeech";
import {
  isCannedTitleByArtist,
  nuggetIdsUsedInScript,
  scriptPassesGate,
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

function nowLine(pack: FactPack): string {
  return `${formatTrackByline(pack.now)}.`;
}

function catchupLine(pack: FactPack): string {
  const now = formatTrackByline(pack.now);
  if (pack.previous?.title || pack.previous?.artist) {
    return `That was ${formatTrackByline(pack.previous)}. Up next, ${now}.`;
  }
  return `Up next, ${now}.`;
}

function recapLine(pack: FactPack): string {
  const lines = pack.recapLines;
  if (lines.length === 0) return "You just heard that.";
  if (lines.length === 1) return `You just heard ${lines[0]}.`;
  const last = lines[lines.length - 1];
  const head = lines.slice(0, -1).join(", ");
  return `You just heard ${head}, and ${last}.`;
}

function stationLine(pack: FactPack): string {
  return pack.includeStationId && pack.stationName ? `${pack.stationName}.` : "";
}

/**
 * An empty fact pack is still a spoken line.
 * It names this song. It is not the bare "Title by Artist." template.
 */
function humanIdentityLine(pack: FactPack): string {
  const byline = formatTrackByline(pack.now);
  const title = pack.now.title.trim();
  const artist = pack.now.artist.trim();
  if (pack.shape === "catchup") return catchupLine(pack);
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

function richerFactIds(pack: FactPack): string[] {
  if (pack.depth !== "directors_cut") return [];
  return pack.nuggets
    .filter((nugget) => nugget.id !== "year" && nugget.id !== "album")
    .map((nugget) => nugget.id);
}

/** Director's Cut keeps at least one fact that is not the year or the album. */
function includesRicherFact(script: string, pack: FactPack): boolean {
  const richer = richerFactIds(pack);
  if (richer.length === 0) return true;
  const used = new Set(nuggetIdsUsedInScript(script, pack));
  return richer.some((id) => used.has(id));
}

function joinParts(parts: Array<string | undefined>): string {
  return parts
    .map((part) => part?.replace(/\s+/g, " ").trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

function leadLine(pack: FactPack, nuggets: FactPack["nuggets"]): string {
  const bareIdentity =
    nuggets.length === 0
    && (pack.shape === "lore" || pack.shape === "teaser");
  if (bareIdentity) return humanIdentityLine(pack);
  if (pack.shape === "catchup" || pack.shapeVariant === 2) return catchupLine(pack);
  return nowLine(pack);
}

function assemble(pack: FactPack, nuggets: FactPack["nuggets"]): string {
  const station = stationLine(pack);
  const names = leadLine(pack, nuggets);
  const sentences = nuggets.map((nugget) => nugget.sentence);
  if (pack.shapeVariant === 1 && sentences.length > 0 && pack.shape !== "catchup") {
    return joinParts([...sentences, names, station]);
  }
  return joinParts([names, ...sentences, station]);
}

export function composeDraft(pack: FactPack): ComposedBreak {
  if (pack.sessionOpening) {
    return { script: stationWelcomeLine(pack), fellBack: false, usedNuggetIds: [] };
  }
  if (pack.shape === "stinger") {
    const script = pack.stationName ? `${pack.stationName}.` : "Back in a moment.";
    return { script, fellBack: false, usedNuggetIds: [] };
  }
  if (pack.shape === "song_id") {
    return { script: nowLine(pack), fellBack: false, usedNuggetIds: [] };
  }
  if (pack.shape === "recap") {
    return { script: recapLine(pack), fellBack: false, usedNuggetIds: [] };
  }

  const capped = pack.nuggets.slice(0, pack.maxNuggets);
  const ceiling = wordCeiling({ ...pack, nuggets: capped });
  const kept: FactPack["nuggets"] = [];
  for (const nugget of capped) {
    const next = assemble(pack, [...kept, nugget]);
    if (wordCount(next) > ceiling) break;
    kept.push(nugget);
  }
  return {
    script: assemble(pack, kept),
    fellBack: false,
    usedNuggetIds: kept.map((nugget) => nugget.id),
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
  const draft = composeDraft(pack);
  const candidate = modelText?.trim() ? readModelScript(modelText) : "";
  if (
    candidate
    && scriptPassesGate(candidate, pack)
    && includesRicherFact(candidate, pack)
  ) {
    return {
      script: candidate,
      fellBack: false,
      usedNuggetIds: nuggetIdsUsedInScript(candidate, pack),
    };
  }
  if (scriptPassesGate(draft.script, pack) && !isCannedTitleByArtist(draft.script, pack)) {
    return { ...draft, fellBack: Boolean(candidate) };
  }
  const shortest = humanIdentityLine(pack);
  const fallback = scriptPassesGate(shortest, pack) && !isCannedTitleByArtist(shortest, pack)
    ? shortest
    : draft.script;
  return {
    script: fallback,
    fellBack: true,
    usedNuggetIds: [],
  };
}

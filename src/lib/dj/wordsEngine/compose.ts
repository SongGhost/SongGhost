/**
 * Turn a fact pack into one spoken break.
 * The model writes the line whenever New is on, including an empty pack.
 * If that line fails the gate, the listener hears a short true draft.
 */

import { formatTrackByline } from "@/lib/dj/trackSpeech";
import { scriptPassesGate, wordCeiling, wordCount } from "./gate";
import type { FactPack } from "./types";

export type ComposedBreak = {
  script: string;
  fellBack: boolean;
  usedNuggetIds: string[];
};

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
 * Director's Cut with nothing but the names is still a spoken line.
 * It is not the bare "Title by Artist." template.
 */
function emptyDirectorsLine(pack: FactPack): string {
  const byline = formatTrackByline(pack.now);
  const title = pack.now.title.trim();
  const artist = pack.now.artist.trim();
  if (pack.shape === "catchup") return catchupLine(pack);
  switch (pack.shapeVariant) {
    case 1:
      return title && artist ? `${artist}. The song is ${title}.` : `${byline}.`;
    case 2:
      return `Up next, ${byline}.`;
    default:
      return title && artist ? `This one is ${title}, ${artist}.` : `${byline}.`;
  }
}

function isEmptyDirectorsTemplate(script: string, pack: FactPack): boolean {
  if (pack.depth !== "directors_cut" || pack.nuggets.length > 0) return false;
  const text = script.replace(/\s+/g, " ").trim().replace(/[.!?]+$/g, "").toLowerCase();
  const byline = formatTrackByline(pack.now).toLowerCase();
  if (text === byline) return true;
  const title = pack.now.title.trim().toLowerCase();
  return Boolean(title) && text.startsWith(`${title} came out in`);
}

function joinParts(parts: Array<string | undefined>): string {
  return parts
    .map((part) => part?.replace(/\s+/g, " ").trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

function leadLine(pack: FactPack, nuggets: FactPack["nuggets"]): string {
  const bareDirectors =
    pack.depth === "directors_cut"
    && nuggets.length === 0
    && pack.shape !== "song_id"
    && pack.shape !== "recap"
    && pack.shape !== "stinger";
  if (bareDirectors) return emptyDirectorsLine(pack);
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
  const draft = composeDraft(pack);
  const candidate = modelText?.trim() ? readModelScript(modelText) : "";
  if (
    candidate
    && !isEmptyDirectorsTemplate(candidate, pack)
    && scriptPassesGate(candidate, pack)
  ) {
    return { script: candidate, fellBack: false, usedNuggetIds: draft.usedNuggetIds };
  }
  if (scriptPassesGate(draft.script, pack) && !isEmptyDirectorsTemplate(draft.script, pack)) {
    return { ...draft, fellBack: Boolean(candidate) };
  }
  const shortest = emptyDirectorsLine(pack);
  const fallback = scriptPassesGate(shortest, pack) && !isEmptyDirectorsTemplate(shortest, pack)
    ? shortest
    : draft.script;
  return {
    script: fallback,
    fellBack: true,
    usedNuggetIds: [],
  };
}

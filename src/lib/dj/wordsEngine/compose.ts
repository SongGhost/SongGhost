/**
 * Turn a fact pack into one spoken break.
 * A model line is used only when the gate accepts it.
 * Otherwise the listener hears the short true draft.
 */

import { formatTrackByline } from "@/lib/dj/trackSpeech";
import { scriptPassesGate, wordCeiling, wordCount } from "./gate";
import type { FactPack } from "./types";

export type ComposedBreak = {
  script: string;
  fellBack: boolean;
  usedNuggetIds: string[];
};

function personaWrap(pack: FactPack): { lead: string; tail: string } {
  if (pack.shape === "song_id" || pack.shape === "stinger" || pack.shape === "recap") {
    return { lead: "", tail: "" };
  }
  switch (pack.personaId) {
    case "warm-companion":
      return { lead: "Listen for this.", tail: "" };
    case "sarcastic-critic":
      return { lead: "", tail: "Worth your ear." };
    case "the-musicologist":
      return { lead: "Hold onto this.", tail: "" };
    default:
      return { lead: "", tail: "" };
  }
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

function joinParts(parts: Array<string | undefined>): string {
  return parts
    .map((part) => part?.replace(/\s+/g, " ").trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

function assemble(pack: FactPack, nuggets: FactPack["nuggets"]): string {
  const { lead, tail } = personaWrap(pack);
  const station = stationLine(pack);
  const names = pack.shape === "catchup" || pack.shapeVariant === 2
    ? catchupLine(pack)
    : nowLine(pack);
  const sentences = nuggets.map((nugget) => nugget.sentence);
  if (pack.shapeVariant === 1 && sentences.length > 0 && pack.shape !== "catchup") {
    return joinParts([lead, ...sentences, names, station, tail]);
  }
  return joinParts([lead, names, ...sentences, station, tail]);
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

  const ceiling = wordCeiling(pack);
  const kept: FactPack["nuggets"] = [];
  for (const nugget of pack.nuggets) {
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
  if (candidate && scriptPassesGate(candidate, pack)) {
    return { script: candidate, fellBack: false, usedNuggetIds: draft.usedNuggetIds };
  }
  if (scriptPassesGate(draft.script, pack)) {
    return { ...draft, fellBack: Boolean(candidate) };
  }
  const shortest = `${formatTrackByline(pack.now)}.`;
  return {
    script: scriptPassesGate(shortest, pack) ? shortest : draft.script,
    fellBack: true,
    usedNuggetIds: [],
  };
}

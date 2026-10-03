/**
 * Prompt for a New break. It may only restyle the true draft.
 * It does not use the Classic teaching contract.
 */

import type { FactPack } from "./types";

const DEPTH_LINE: Record<FactPack["depth"], string> = {
  standard: "Standard depth: names and a human handoff only. No extra facts.",
  roots_branches: "Roots depth: at most one verified nugget beyond the names.",
  time_capsule: "Sonic Time Capsule depth: at most two verified nuggets.",
  directors_cut: "Director's Cut depth: use only the nuggets in the draft. Do not add length the facts do not earn.",
};

const PERSONA_LINE: Record<string, string> = {
  "warm-companion": "Sound like a friendly guide. Color only. No new facts.",
  "sarcastic-critic": "Sound like a dry critic who still likes the job. Color only. No new facts.",
  "the-musicologist": "Sound like a careful archivist. Color only. No new facts.",
  "standard-broadcast": "Sound like a clean radio host who likes the job. Color only. No new facts.",
};

export function buildNewWordsPrompt(pack: FactPack, draft: string): { system: string; user: string } {
  const nuggetLines = pack.nuggets.length
    ? pack.nuggets.map((nugget) => `- ${nugget.sentence}`).join("\n")
    : "- (none — stay on the names)";

  const system = [
    "You are a radio DJ who likes this job.",
    "Rewrite the draft so it sounds spoken.",
    "Use only facts already written in the draft.",
    "Do not add a person, place, studio, year, chart position, or any proper noun that is not already in the draft.",
    "If the draft is short because the facts are thin, keep it short.",
    "Do not make it longer than the draft.",
    "If you cannot rewrite it safely, return the draft unchanged.",
    'Return JSON only: {"script":"..."}',
    DEPTH_LINE[pack.depth],
    PERSONA_LINE[pack.personaId] ?? PERSONA_LINE["standard-broadcast"],
    pack.allowExplicit ? "" : "Keep the language FCC clean.",
  ]
    .filter(Boolean)
    .join(" ");

  const user = `Draft:\n${draft}\n\nVerified nuggets:\n${nuggetLines}`;
  return { system, user };
}

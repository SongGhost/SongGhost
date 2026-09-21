/**
 * Live legacy teaching-lore contract.
 *
 * Live YouTube POSTs `/api/generate-script` without `trackId`, so it uses
 * `handleLegacyScriptGeneration` — not the lore-cache assembler. Mid-session
 * teaching clips get exactly one contract: persona required move + lore-tier
 * budget/depth + pace copy-cadence. Nothing that fights those three.
 */

import type {
  CommentaryFormat,
  DjKnowledge,
  DjPace,
  DjScriptPhase,
} from "@/types/dj";
import {
  allowExplicitGuidance,
  buildHostTuningPromptDirective,
  paceGuidance,
} from "@/lib/dj/scriptGenerator";

/** Verified craft, or a general technique — never fake proper nouns or vibe fluff. */
export const TEACHING_TRUTH_RULE =
  " TEACHING TRUTH: Never invent studios, producers, chart peaks, collaborators,"
  + " or brand-like nicknames. Prefer a verified craft/history point, OR a general"
  + " production technique without fake proper nouns. Never require a named studio"
  + " or producer when you are unsure — teach the technique in general terms."
  + " Do not fall back to fluff vibe brands as a substitute for teaching.";

/** Rotating style / pillar may colour topic; they must not erase the host job. */
export const PERSONA_JOB_WINS_RULE =
  " PERSONA JOB OWNS THE MOVE: Rotating commentary style and musicology pillar may"
  + " colour the topic only. They must not replace the required host job."
  + " The Guide still lands an ear-cue (listen for / notice)."
  + " The Critic still lands judgment plus craft."
  + " The Archivist still lands lineage, scene, or place."
  + " A chart pillar must not turn The Critic into trivia-only; a production pillar"
  + " must not erase The Guide's listen-for cue.";

/** Talkative breaks already ID via stinger/brief — lore must not also ID. */
export const TEACHING_LORE_NO_STATION_ID_RULE =
  " STATION ID BUDGET: This lore clip must not speak a SonGhost/SongHost identity"
  + " line (no \"You're listening to SonGhost\"). At most one identity beat per"
  + " break package — the stinger or a single brief owns it. You may still know"
  + " the station name; do not say it here.";

/** Replaces Tuning Console "verified chart positions" on teaching lore. */
export const TEACHING_KNOWLEDGE_RULE =
  " Knowledge: teach a verified craft/history point, or a general technique"
  + " without fake proper nouns. Never require named studios or producers when"
  + " unsure. Never invent brand-like nicknames.";

export function isTeachingLoreClip(input: {
  scriptPhase?: string;
  kind?: string;
  isSessionOpening?: boolean;
}): boolean {
  if (input.isSessionOpening) return false;
  if (
    input.kind === "stinger"
    || input.kind === "song_id"
    || input.kind === "recap"
    || input.kind === "roots_teaser"
  ) {
    return false;
  }
  return input.scriptPhase === "lore";
}

export type AssembleLegacySystemPromptInput = {
  baseSystem: string;
  pace: DjPace;
  lore: CommentaryFormat;
  knowledge: DjKnowledge;
  allowExplicit: boolean;
  pillarDirective: string;
  ttsFormattingRules: string;
  entityNamingRule: string;
  scriptPhase: DjScriptPhase;
  kind?: string;
  isSessionOpening?: boolean;
  isTeaser: boolean;
  namesOnlyAnnouncement: boolean;
};

/**
 * Extra system-prompt tail for the live legacy assembler.
 * Teaching lore omits Standard title/artist/station-ID, one-nugget, 12-word-everything,
 * ENTITY_NAMING-as-must-name-the-studio, and STRICT_TRUTH "describe the vibe".
 */
export function assembleLegacySystemPrompt(
  input: AssembleLegacySystemPromptInput,
): string {
  const teaching = isTeachingLoreClip({
    scriptPhase: input.scriptPhase,
    kind: input.kind,
    isSessionOpening: input.isSessionOpening,
  });

  if (input.isTeaser) {
    return (
      input.baseSystem
      + paceGuidance(input.pace)
      + TEACHING_KNOWLEDGE_RULE
      + allowExplicitGuidance(input.allowExplicit)
      + TEACHING_TRUTH_RULE
      + input.ttsFormattingRules
      + input.pillarDirective
    );
  }

  if (input.namesOnlyAnnouncement) {
    return (
      input.baseSystem
      + paceGuidance(input.pace)
      + allowExplicitGuidance(input.allowExplicit)
      + input.ttsFormattingRules
    );
  }

  if (teaching) {
    const alreadyHasTruth = input.baseSystem.includes("TEACHING TRUTH:");
    const alreadyHasJobWins = input.baseSystem.includes("PERSONA JOB OWNS THE MOVE");
    const alreadyHasNoId = input.baseSystem.includes("STATION ID BUDGET");
    return (
      input.baseSystem
      + paceGuidance(input.pace)
      + TEACHING_KNOWLEDGE_RULE
      + allowExplicitGuidance(input.allowExplicit)
      + (alreadyHasTruth ? "" : TEACHING_TRUTH_RULE)
      + input.ttsFormattingRules
      + input.pillarDirective
      + (alreadyHasJobWins ? "" : PERSONA_JOB_WINS_RULE)
      + (alreadyHasNoId ? "" : TEACHING_LORE_NO_STATION_ID_RULE)
    );
  }

  return (
    input.baseSystem
    + buildHostTuningPromptDirective({
      pace: input.pace,
      lore: input.lore,
      knowledge: input.knowledge,
      allowExplicit: input.allowExplicit,
    })
    + TEACHING_TRUTH_RULE
    + input.entityNamingRule
    + input.ttsFormattingRules
    + input.pillarDirective
  );
}

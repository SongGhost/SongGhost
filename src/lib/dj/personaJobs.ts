/**
 * Host-job contracts + lightweight post-generation quality gate.
 * Persona = which teacher is in the booth. Lore = depth. Pace = how often.
 */

import { getPersonaById, resolvePersonaId, type PersonaId } from "@/data/personas";

export const TEACHING_PERSONA_IDS = [
  "warm-companion",
  "sarcastic-critic",
  "the-musicologist",
] as const;

export type TeachingPersonaId = (typeof TEACHING_PERSONA_IDS)[number];

export type PersonaJobKind = "guide" | "critic" | "archivist" | "standard";

export type PersonaScriptCheck = {
  ok: boolean;
  score: number;
  reasons: string[];
  repairDirective: string;
  hasRequiredMove: boolean;
};

export type PersonaValidateContext = {
  personaId?: string | null;
  scriptPhase?: string;
  kind?: string;
  isSessionOpening?: boolean;
  isFirstPlaylistPack?: boolean;
};

export type PersonaGateResult = {
  script: string;
  retried: boolean;
  passed: boolean;
  attempts: number;
};

/** Shared rules for every host job — hard contract, not vibe. */
export const SHARED_PERSONA_CONTRACT =
  " SHARED HOST CONTRACT: Hook, then payoff, then setup/handoff into the next song"
  + " (or a clean up-now name line after the lesson when a separate announcement clip owns the name)."
  + " Use only the cleaned track title and artist you were given."
  + " Brand: SongHost is the DJ; SonGhost is the station. Never write Song Ghost or SongGhost."
  + " Prefer verifiable craft over invented named collaborators."
  + " Pace owns how often you talk and whether you recap or lead forward; lore tier owns depth."
  + " Every Song stays tight and leads forward mid-session. Natural and Long Breaks may recap."
  + " The first-playlist pack cadence is unchanged. Director's Cut teaches at full length — do not soft-cap it."
  + " Banned empty hype: vibes, journey, timeless, iconic (unless tied to a concrete craft point),"
  + " weekend adventurers.";

export const PERSONA_BLIND_TEST_RULE =
  " BLIND TEST: a listener reading only this transcript should usually guess this host job"
  + " (The Guide, The Critic, or The Archivist) without seeing the picker.";

const CRAFT_NEARBY =
  /\b(mix|hook|arrangement|guitar|drum|bass|vocal|harmony|lyric|production|riff|bridge|chorus|verse|tempo|groove|reverb|melody|pocket|synth|piano|horn|snare|amp|desk|label|scene|lineage)\b/i;

const BANNED_ALWAYS = /\bweekend adventurers\b/i;

const EMPTY_HYPE_WORDS: readonly RegExp[] = [
  /\bvibes\b/i,
  /\bjourney\b/i,
  /\btimeless\b/i,
  /\biconic\b/i,
];

const GUIDE_EAR_CUE =
  /\b(listen for|when (the )?(next )?(track|one|song) hits|notice (the|how|that)|hear (the|how|that)|watch for|when it hits)\b/i;

const CRITIC_JUDGMENT =
  /\b(works|doesn't work|does not work|gimmick|bold|earns|cheap|overplays|overcooked|restraint|fails|thin|hollow|lands|misses|showy|earned|unearned|too (slick|safe|busy)|actually (fine|good|great|thin)|saves it|holds the)\b/i;

const ARCHIVIST_LINEAGE =
  /\b(lineage|scene|label|spread|wave|came (out of|from)|before (this|that|them)|after (this|that|them)|passed (down|along)|borrowed|carried|through (the )?(years|decades|time)|memphis|kingston|chicago|detroit|motown|chess|london|nashville|manchester)\b/i;

const CLONE_OPENERS: readonly RegExp[] = [
  /^you're locked into/i,
  /^welcome back listeners/i,
  /^here'?s another great/i,
  /^oh this one takes me back/i,
];

export function personaJobKind(personaId?: string | null): PersonaJobKind {
  const id = resolvePersonaId(personaId);
  if (id === "warm-companion") return "guide";
  if (id === "sarcastic-critic") return "critic";
  if (id === "the-musicologist") return "archivist";
  return "standard";
}

export function isTeachingPersonaId(id: string): id is TeachingPersonaId {
  return (TEACHING_PERSONA_IDS as readonly string[]).includes(id);
}

/**
 * Teaching lore / full breaks only. Skip templates, names-only clips, and openers.
 */
export function shouldValidatePersonaScript(ctx: PersonaValidateContext): boolean {
  if (ctx.isSessionOpening) return false;
  if (ctx.kind === "stinger" || ctx.kind === "song_id" || ctx.kind === "recap") {
    return false;
  }
  if (ctx.scriptPhase === "announcement" && !ctx.isFirstPlaylistPack) {
    return false;
  }
  return true;
}

function hasEmptyHype(script: string): boolean {
  if (BANNED_ALWAYS.test(script)) return true;
  for (const pattern of EMPTY_HYPE_WORDS) {
    const match = pattern.exec(script);
    if (!match) continue;
    const start = Math.max(0, match.index - 48);
    const end = Math.min(script.length, match.index + match[0].length + 48);
    const window = script.slice(start, end);
    if (!CRAFT_NEARBY.test(window)) return true;
  }
  return false;
}

function hasCloneOpener(script: string): boolean {
  const trimmed = script.trim();
  return CLONE_OPENERS.some((pattern) => pattern.test(trimmed));
}

function requiredMovePresent(kind: PersonaJobKind, script: string): boolean {
  if (kind === "guide") return GUIDE_EAR_CUE.test(script);
  if (kind === "critic") return CRITIC_JUDGMENT.test(script) && CRAFT_NEARBY.test(script);
  if (kind === "archivist") return ARCHIVIST_LINEAGE.test(script);
  return true;
}

function repairFor(kind: PersonaJobKind, reasons: string[]): string {
  const missing = reasons.join("; ");
  if (kind === "guide") {
    return (
      ` PERSONA RETRY: The last draft failed The Guide job (${missing}).`
      + ` Write one concrete ear cue: "listen for this…" or "when the next track hits, notice…"`
      + ` naming a real sound. No empty hype. Stay The Guide — a listener should guess this job from the transcript alone.`
    );
  }
  if (kind === "critic") {
    return (
      ` PERSONA RETRY: The last draft failed The Critic job (${missing}).`
      + ` Give one clear judgment (what works, what doesn't, or what's bold) AND one craft reason.`
      + ` Sharp and fair, never cruel. No empty hype. A listener should guess The Critic from the transcript alone.`
    );
  }
  if (kind === "archivist") {
    return (
      ` PERSONA RETRY: The last draft failed The Archivist job (${missing}).`
      + ` Include one lineage, scene, city, label, or technique-through-time link — not a date catalog.`
      + ` No empty hype. A listener should guess The Archivist from the transcript alone.`
    );
  }
  return (
    ` PERSONA RETRY: The last draft failed the shared host contract (${missing}).`
    + ` Hook, payoff, handoff. No empty hype. Never write Song Ghost or SongGhost.`
  );
}

export function validatePersonaScript(
  script: string,
  personaId?: string | null,
): PersonaScriptCheck {
  const text = script.trim();
  const kind = personaJobKind(personaId);
  const reasons: string[] = [];
  let score = 0;

  if (!text) {
    return {
      ok: false,
      score: 0,
      reasons: ["empty script"],
      repairDirective: repairFor(kind, ["empty script"]),
      hasRequiredMove: false,
    };
  }

  const moveOk = requiredMovePresent(kind, text);
  if (moveOk) score += 4;
  else if (kind === "guide") reasons.push("Guide missing ear-cue move");
  else if (kind === "critic") reasons.push("Critic missing judgment");
  else if (kind === "archivist") reasons.push("Archivist missing lineage link");

  const hype = hasEmptyHype(text);
  if (!hype) score += 1;
  else reasons.push("banned filler used as empty hype");

  const clone = hasCloneOpener(text) && !moveOk;
  if (!clone) score += 1;
  else reasons.push("persona-agnostic clone opener");

  return {
    ok: reasons.length === 0,
    score,
    reasons,
    repairDirective: repairFor(kind, reasons.length ? reasons : ["needs a tighter job move"]),
    hasRequiredMove: moveOk,
  };
}

export function pickBestPersonaAttempt(
  first: string,
  firstCheck: PersonaScriptCheck,
  retry: string,
  retryCheck: PersonaScriptCheck,
): string {
  if (retryCheck.hasRequiredMove && !firstCheck.hasRequiredMove && retry.trim()) {
    return retry;
  }
  if (firstCheck.hasRequiredMove && !retryCheck.hasRequiredMove) {
    return first;
  }
  if (retryCheck.score > firstCheck.score && retry.trim()) return retry;
  if (retryCheck.score === firstCheck.score && retryCheck.ok && !firstCheck.ok && retry.trim()) {
    return retry;
  }
  return first;
}

/**
 * One retry if the job contract fails. Air the best attempt — never hang the gap.
 */
export async function runPersonaScriptQualityGate(input: {
  generate: (repairDirective?: string) => Promise<string>;
  personaId?: string | null;
  scriptPhase?: string;
  kind?: string;
  isSessionOpening?: boolean;
  isFirstPlaylistPack?: boolean;
}): Promise<PersonaGateResult> {
  const first = await input.generate();
  if (!shouldValidatePersonaScript(input)) {
    return { script: first, retried: false, passed: true, attempts: 1 };
  }

  const firstCheck = validatePersonaScript(first, input.personaId);
  if (firstCheck.ok) {
    return { script: first, retried: false, passed: true, attempts: 1 };
  }

  try {
    const retry = await input.generate(firstCheck.repairDirective);
    const retryCheck = validatePersonaScript(retry, input.personaId);
    return {
      script: pickBestPersonaAttempt(first, firstCheck, retry, retryCheck),
      retried: true,
      passed: retryCheck.ok || firstCheck.ok,
      attempts: 2,
    };
  } catch {
    return { script: first, retried: true, passed: false, attempts: 1 };
  }
}

export function personaDisplayName(personaId: PersonaId | string): string {
  return getPersonaById(personaId)?.name ?? "Host";
}

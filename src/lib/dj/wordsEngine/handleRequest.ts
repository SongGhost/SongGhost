/**
 * Server entry for New words.
 * Classic `/api/generate-script` posts never call this.
 * The sheet is built while the song is still playing. If it is not ready,
 * the host says what is already true. The writer is gpt-4o-mini.
 */

import { parseAllowExplicit } from "@/lib/content-filter";
import { getEffectivePersona } from "@/lib/dj/personaConfig";
import { sanitizeDjSegmentPlan } from "@/lib/dj/trackSpeech";
import {
  formatWeatherForPrompt,
  getBriefWeatherWithin,
} from "@/lib/location/weather";
import {
  PRO_COMMENTARY_FORMATS,
  resolveCommentaryFormat,
  type CommentaryFormat,
  type DjSegmentPlan,
} from "@/types/dj";
import { normalizeAlbumContext } from "@/types/station";
import type { FactTopic, SheetClaim } from "./claims";
import { buildFactPack } from "./factPack";
import { composeNewBreak, stationWelcomeLine, titleOnlyLine } from "./compose";
import { claimCovered } from "./gate";
import { buildNewWordsPrompt, buildOpenerPrompt } from "./prompt";
import { citedPassages, passageQuotes, sourceLineFailures, sourceLineOk, storyRange } from "./sourceGate";
import { loadBreakSheet } from "./sheet";
import {
  packStationIds,
  parseStationIds,
  readStationMemory,
  stationMemoryKey,
  writeStationMemory,
  type OpenTease,
} from "./stationMemory";
import type { FactPack, FactPackInput } from "./types";
import { connectorKeys, factKey, restatesFact, rotationType, sentenceShapes } from "./variety";

export type NewWordsResult = {
  status: number;
  script?: string;
  error?: string;
  fellBack?: boolean;
  /** Nugget ids heard in the line that aired. The session remembers these. */
  usedFactIds?: string[];
  gate?: "pass" | "retry" | "fallback";
  sheetMs?: number;
  writeMs?: number;
  costUsd?: number;
  sources?: Array<{ name: string; url: string; claim: string }>;
  openTease?: OpenTease | null;
  spokenTopics?: FactTopic[];
  stationSpokenIds?: string[];
  /** Rotation type of the fact this break taught. */
  factType?: string;
};

/** A break that starts in the gap waits this long, then speaks what is ready. */
export const SHEET_GAP_WAIT_MS = 1000;

/** Prefetch runs while the song is still playing, so the sheet can finish. */
export const SHEET_WARM_WAIT_MS = 20000;

/** One writer cap for every mode. A Director's Cut line fits, and so does the JSON. */
export const NEW_WORDS_MAX_TOKENS = 640;

/**
 * Flip this to "gpt-4.1-mini" to try that writer on Director's Cut only.
 * Leave it null. gpt-4o-mini writes every mode until then.
 */
export const DIRECTORS_CUT_WRITER_MODEL: "gpt-4.1-mini" | null = null;

const WRITER_RATES: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  "gpt-4.1-mini": { input: 0.4 / 1_000_000, output: 1.6 / 1_000_000 },
};

export function newWordsWriterModel(depth: CommentaryFormat): string {
  if (depth === "directors_cut" && DIRECTORS_CUT_WRITER_MODEL === "gpt-4.1-mini") {
    return "gpt-4.1-mini";
  }
  return "gpt-4o-mini";
}

export function sheetWaitMs(research: unknown): number {
  return research === "warm" ? SHEET_WARM_WAIT_MS : SHEET_GAP_WAIT_MS;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readYear(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  if (value < 1900 || value > 2035) return undefined;
  return value;
}

function readPlan(value: unknown): DjSegmentPlan | undefined {
  if (!value || typeof value !== "object") return undefined;
  const plan = value as DjSegmentPlan;
  if (!Array.isArray(plan.announceTracks) || typeof plan.kind !== "string") return undefined;
  return sanitizeDjSegmentPlan(plan);
}

function readSpokenIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const clean = entry.trim();
    if (!clean) continue;
    ids.push(clean);
    if (ids.length >= 120) break;
  }
  return ids;
}

function readPrevious(value: unknown): { title: string; artist: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as { title?: unknown; artist?: unknown };
  const title = readString(row.title);
  const artist = readString(row.artist);
  if (!title && !artist) return undefined;
  return { title, artist };
}

const TOPICS = new Set<FactTopic>([
  "members",
  "origin",
  "album_story",
  "song_story",
  "band_said",
  "connections",
  "reception",
  "release",
]);

function readTopics(value: unknown): FactTopic[] {
  if (!Array.isArray(value)) return [];
  const topics: FactTopic[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !TOPICS.has(entry as FactTopic)) continue;
    topics.push(entry as FactTopic);
  }
  return topics;
}

function readNextTrack(value: unknown): { artist: string; title: string; album?: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as { artist?: unknown; title?: unknown; album?: unknown; artistName?: unknown; songTitle?: unknown };
  const artist = readString(row.artist) || readString(row.artistName);
  const title = readString(row.title) || readString(row.songTitle);
  if (!artist || !title) return undefined;
  const album = readString(row.album);
  return album ? { artist, title, album } : { artist, title };
}

function readTease(value: unknown): OpenTease | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { songTitle?: unknown; artist?: unknown; claimId?: unknown; claim?: unknown };
  const songTitle = readString(row.songTitle);
  const artist = readString(row.artist);
  const claimId = readString(row.claimId);
  const claim = readString(row.claim);
  if (!songTitle || !artist || !claimId || !claim) return null;
  return { songTitle, artist, claimId, claim };
}

function namesFromClaim(claim: string): string[] {
  return [...new Set((claim.match(/[A-Z][A-Za-z'’\-]+(?:\s+[A-Z][A-Za-z'’\-]+){0,3}/g) ?? []).map((name) => name.trim()))];
}

function sameSong(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

type WriterDraft = { text: string | null; costUsd: number };

async function writeOnce(
  system: string,
  user: string,
  depth: CommentaryFormat,
): Promise<WriterDraft> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return { text: null, costUsd: 0 };
  const model = newWordsWriterModel(depth);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: NEW_WORDS_MAX_TOKENS,
      temperature: 0.55,
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) return { text: null, costUsd: 0 };
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const rate = WRITER_RATES[model] ?? WRITER_RATES["gpt-4o-mini"];
  const costUsd = (data.usage?.prompt_tokens ?? 0) * (rate?.input ?? 0)
    + (data.usage?.completion_tokens ?? 0) * (rate?.output ?? 0);
  const text = data.choices?.[0]?.message?.content?.trim() || null;
  return { text, costUsd };
}

function logGateReject(
  stage: string,
  song: string,
  artist: string,
  draft: string,
  reasons: string,
): void {
  if (process.env.NEW_HOST_PROOF !== "1") return;
  console.log([
    `\n${stage} ${song} / ${artist}`,
    `DRAFT ${draft}`,
    `WHY ${reasons}`,
  ].join("\n"));
}

function readWriterScript(modelText: string | null): string {
  const trimmed = modelText?.trim() ?? "";
  if (!trimmed.startsWith("{")) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as { script?: unknown };
    return typeof parsed.script === "string" ? parsed.script.trim() : "";
  } catch {
    return "";
  }
}

/**
 * A line that already passes is spoken as written.
 * Otherwise keep the fact and any short reaction, and let the show finish the line.
 */
function spokenWordCount(script: string): number {
  return script.trim().split(/\s+/).filter(Boolean).length;
}

/** A true line that is far under the depth still gets the one retry. It is not a gate failure. */
function shortOfStory(script: string, pack: FactPack): boolean {
  if (pack.sessionOpening) return false;
  if ((pack.passages?.length ?? 0) === 0) return false;
  const range = storyRange(pack);
  if (range.minWords < 40) return false;
  return spokenWordCount(script) < range.minWords;
}

function airedDraft(pack: FactPack, modelText: string | null): string {
  const text = readWriterScript(modelText);
  if (!text || !sourceLineOk(text, pack)) return "";
  return text;
}

function sourceLines(pack: FactPack, ids: readonly string[]): Array<{ name: string; url: string; claim: string }> {
  const pool = [...pack.sheet, ...pack.nextSheet];
  const lines: Array<{ name: string; url: string; claim: string }> = [];
  for (const id of ids) {
    const claim = pool.find((row) => row.id === id);
    const nugget = pack.nuggets.find((row) => row.id === id);
    const sentence = claim?.claim ?? nugget?.sentence;
    if (!sentence) continue;
    lines.push({
      name: claim?.sourceName ?? nugget?.sourceName ?? "catalog",
      url: claim?.sourceUrl ?? nugget?.sourceUrl ?? "",
      claim: sentence,
    });
  }
  return lines;
}

export async function resolveNewWordsFromBody(
  body: Record<string, unknown>,
  tier: "free" | "pro",
): Promise<NewWordsResult> {
  const plan = readPlan(body.segmentPlan);
  const title = readString(body.songTitle);
  const artist = readString(body.artistName);
  if (plan?.isSessionOpening === true) {
    const welcome = stationWelcomeLine({
      stationName: readString(body.stationName) || "SongHost",
      now: { title, artist },
    });
    if (!welcome.trim()) return { status: 502, error: "No script generated" };
    if (!title || !artist) {
      return { status: 200, script: welcome, fellBack: false, usedFactIds: [] };
    }
    const waitMs = sheetWaitMs(body.research);
    const sheet = await Promise.race([
      loadBreakSheet({ artist, title, album: readString(body.album) || undefined, waitMs }),
      new Promise<Awaited<ReturnType<typeof loadBreakSheet>>>((resolve) => {
        setTimeout(() => resolve({ claims: [], nextClaims: [], passages: [], sources: [] }), waitMs);
      }),
    ]).catch(() => ({ claims: [], nextClaims: [], passages: [], sources: [] as Array<{ name: string; url: string }> }));
    if (!sheet.passages?.length) {
      return { status: 200, script: welcome, fellBack: false, usedFactIds: [] };
    }
    const openerPack = buildFactPack({
      title,
      artist,
      album: readString(body.album),
      stationName: readString(body.stationName),
      personaId: getEffectivePersona(readString(body.hostId) || readString(body.personaId) || "standard-broadcast", tier === "pro"),
      depth: "standard",
      plan,
      claims: sheet.claims,
      passages: sheet.passages,
      allowExplicit: parseAllowExplicit(body.allowExplicit),
    });
    try {
      const openerPrompt = buildOpenerPrompt(openerPack);
      const written = await writeOnce(openerPrompt.system, openerPrompt.user, "standard");
      const line = readWriterScript(written.text);
      if (line && sourceLineOk(line, openerPack)) {
        return {
          status: 200,
          script: `${welcome} ${line}`.replace(/\s+/g, " ").trim(),
          fellBack: false,
          usedFactIds: [],
          gate: "pass",
          costUsd: written.costUsd,
          sources: citedPassages(line, openerPack.passages),
        };
      }
    } catch {
      // The welcome still airs when the sourced line is not ready.
    }
    return { status: 200, script: welcome, fellBack: false, usedFactIds: [] };
  }
  if (!title && !artist && plan?.kind !== "stinger" && plan?.kind !== "recap") {
    return { status: 400, error: "songTitle and artistName are required" };
  }

  const requestedDepth = resolveCommentaryFormat(body.commentaryFormat ?? body.lore);
  const depth =
    tier === "pro" || !PRO_COMMENTARY_FORMATS.has(requestedDepth)
      ? requestedDepth
      : "standard";
  const personaId = getEffectivePersona(
    readString(body.hostId) || readString(body.personaId) || "standard-broadcast",
    tier === "pro",
  );

  let weatherSummary = readString(body.weatherSummary);
  const homeCity = readString(body.homeCity);
  if (
    plan?.kind === "local_events"
    && !plan.localEvent
    && homeCity
    && !weatherSummary
  ) {
    try {
      const weather = await getBriefWeatherWithin({ homeCity }, 800);
      if (weather) weatherSummary = formatWeatherForPrompt(weather);
    } catch {
      weatherSummary = "";
    }
  }

  const album = readString(body.album);
  const releaseYear = readYear(body.releaseYear);
  const albumContext = normalizeAlbumContext(body.albumContext);
  const stationName = readString(body.stationName);
  const memoryKey = stationMemoryKey(readString(body.stationId), stationName);
  const remembered = readStationMemory(memoryKey);
  const fromClient = parseStationIds([
    ...readSpokenIds(body.stationSpokenIds),
    ...readSpokenIds(body.spokenFactIds),
  ]);
  const spokenFactIds = [...new Set([
    ...fromClient.claimIds,
    ...remembered.claimIds,
  ])];
  const spokenTopics = [...new Set([
    ...readTopics(body.spokenTopics),
    ...remembered.topics,
  ])];
  const teaseIn = readTease(body.openTease) ?? remembered.tease;
  const payoff: SheetClaim | undefined = teaseIn && sameSong(teaseIn.songTitle, title) && sameSong(teaseIn.artist, artist)
    ? {
        id: teaseIn.claimId,
        claim: teaseIn.claim,
        topic: "song_story",
        names: namesFromClaim(teaseIn.claim),
        places: [],
        years: [],
        numbers: [],
        instruments: [],
        sourceName: "sheet",
        sourceUrl: "",
        confidence: "high",
      }
    : undefined;
  const usedFactKeys = [...new Set([
    ...fromClient.factKeys,
    ...remembered.factKeys,
    ...(payoff ? [factKey(payoff)] : []),
  ])];
  const usedConnectors = [...new Set([...fromClient.connectors, ...remembered.connectors])];
  const usedShapes = [...new Set([...fromClient.shapes, ...remembered.shapes])];
  const recentRotation = [...fromClient.rotation, ...remembered.rotation].slice(-3);

  const sheetStarted = Date.now();
  const nextTrack = readNextTrack(body.nextTrack);
  const skipSheet = plan?.kind === "stinger" || plan?.kind === "recap" || plan?.kind === "song_id";
  const waitMs = sheetWaitMs(body.research);
  const emptySheet = { claims: [], nextClaims: [], passages: [] as FactPack["passages"], sources: [] as Array<{ name: string; url: string }> };
  const sheet = !skipSheet && title && artist
    ? await Promise.race([
        loadBreakSheet({
          artist,
          title,
          album: album || undefined,
          ...(nextTrack ? { next: nextTrack } : {}),
          waitMs,
        }),
        new Promise<Awaited<ReturnType<typeof loadBreakSheet>>>((resolve) => {
          setTimeout(() => resolve(emptySheet), waitMs);
        }),
      ])
    : emptySheet;
  const sheetMs = Date.now() - sheetStarted;

  const input: FactPackInput = {
    title,
    artist,
    album,
    releaseYear,
    stationName,
    personaId,
    depth,
    plan,
    previous: readPrevious(body.previousTrack),
    albumContext,
    allowExplicit: parseAllowExplicit(body.allowExplicit),
    weatherSummary: weatherSummary || undefined,
    homeCity: homeCity || undefined,
    spokenFactIds,
    spokenTopics,
    usedFactKeys,
    usedConnectors,
    usedShapes,
    recentRotation,
    ...(payoff ? { boostNames: payoff.names, payoff } : {}),
    claims: sheet.claims,
    passages: sheet.passages ?? [],
    nextClaims: payoff ? [] : sheet.nextClaims,
  };

  const pack = buildFactPack(input);
  const quietShape = pack.shape === "stinger" || pack.shape === "song_id" || pack.shape === "recap";
  if (quietShape) {
    const composed = composeNewBreak(pack, null);
    return {
      status: composed.script.trim() ? 200 : 502,
      script: composed.script,
      ...(composed.script.trim() ? {} : { error: "No script generated" }),
      fellBack: false,
      usedFactIds: composed.usedNuggetIds,
      gate: "pass",
      sheetMs,
      writeMs: 0,
      costUsd: 0,
      sources: [],
    };
  }

  const prompt = buildNewWordsPrompt(pack, "");
  const writeStarted = Date.now();
  let costUsd = 0;
  let gate: "pass" | "retry" | "fallback" = "fallback";
  let modelText: string | null = null;
  try {
    const first = await writeOnce(prompt.system, prompt.user, depth);
    costUsd += first.costUsd;
    const firstText = readWriterScript(first.text);
    const firstAired = airedDraft(pack, first.text);
    const firstShort = Boolean(firstAired) && shortOfStory(firstAired, pack);
    if (firstAired && !firstShort) {
      modelText = firstText;
      gate = "pass";
    } else if (first.text || firstAired) {
      const range = storyRange(pack);
      const failedDraft = firstText || first.text || "";
      const reasons = firstShort
        ? `That is ${spokenWordCount(firstAired)} words. Tell one sourced story in about ${range.minWords} to ${range.maxWords} words. Do not add a name, year, place, or number.`
        : sourceLineFailures(failedDraft, pack).join(" ");
      logGateReject(firstShort ? "DRAFT SHORT" : "DRAFT REJECT", title, artist, failedDraft, reasons);
      const quote = passageQuotes(pack.passages);
      const second = await writeOnce(
        prompt.system,
        `${prompt.user}\n\nYour draft failed. ${reasons}\nRewrite from this source only. Do not add a name, year, place, or number that is not in it.\n${quote}\nLast draft:\n${firstText}`,
        depth,
      );
      costUsd += second.costUsd;
      const secondText = readWriterScript(second.text);
      const secondAired = airedDraft(pack, second.text);
      if (secondAired) {
        modelText = secondText;
        gate = "retry";
      } else if (firstAired) {
        modelText = firstAired;
        gate = "pass";
      } else {
        logGateReject("RETRY REJECT", title, artist, secondText || second.text || "", sourceLineFailures(secondText || "", pack).join(" "));
      }
    }
  } catch {
    modelText = null;
    gate = "fallback";
  }
  const writeMs = Date.now() - writeStarted;
  const fellBack = !modelText;
  const script = modelText ?? titleOnlyLine(pack);
  if (!script.trim()) {
    return { status: 502, error: "No script generated" };
  }
  if (fellBack && process.env.NEW_HOST_PROOF === "1") {
    console.log(`FALLBACK SPOKEN ${title} / ${artist}\n${script}`);
  }

  const usedNuggetIds = fellBack
    ? []
    : pack.nuggets
      .filter((nugget) => {
        const name = (nugget.names ?? []).find((item) => item.length > 2);
        const place = (nugget.places ?? []).find((item) => item.length > 2);
        const lower = script.toLowerCase();
        return (name && lower.includes(name.toLowerCase())) || (place && lower.includes(place.toLowerCase()));
      })
      .map((nugget) => nugget.id);

  const usedTopics = [...new Set([
    ...spokenTopics,
    ...usedNuggetIds
      .map((id) => pack.nuggets.find((nugget) => nugget.id === id)?.topic)
      .filter((topic): topic is FactTopic => Boolean(topic)),
  ])];
  const taught = usedNuggetIds.flatMap((id) => {
    const nugget = pack.nuggets.find((row) => row.id === id);
    if (nugget) return [factKey(nugget)];
    const claim = pack.sheet.find((row) => row.id === id);
    return claim ? [factKey(claim)] : [];
  });
  let openTease: OpenTease | null = payoff ? null : teaseIn;
  const nextTitle = nextTrack?.title ?? "";
  const nextArtist = nextTrack?.artist ?? "";
  const teaseSpoken = Boolean(
    pack.tease
    && !fellBack
    && (claimCovered(script, pack.tease, pack) || restatesFact(script, pack.tease)),
  );
  if (teaseSpoken && pack.tease && nextTitle && nextArtist) {
    openTease = {
      songTitle: nextTitle,
      artist: nextArtist,
      claimId: pack.tease.id,
      claim: pack.tease.claim,
    };
    taught.push(factKey(pack.tease));
  }
  const factKeys = [...new Set([...usedFactKeys, ...taught])].slice(0, 80);
  const connectors = [...new Set([...usedConnectors, ...connectorKeys(script, pack)])].slice(0, 40);
  const shapes = [...new Set([...usedShapes, ...sentenceShapes(script, pack)])].slice(0, 80);
  const leadId = usedNuggetIds[0];
  const lead = pack.nuggets.find((nugget) => nugget.id === leadId);
  const factType = lead ? rotationType(lead) : undefined;
  const rotation = [...recentRotation, ...(factType ? [factType] : [])].slice(-12);
  const claimIds = [...new Set([
    ...spokenFactIds,
    ...usedNuggetIds,
    ...(openTease ? [openTease.claimId] : []),
  ])].slice(0, 80);
  const stationSpokenIds = packStationIds({ claimIds, factKeys, connectors, shapes, rotation });
  if (memoryKey) {
    writeStationMemory(memoryKey, {
      claimIds,
      factKeys,
      connectors,
      shapes,
      rotation,
      topics: usedTopics,
      tease: openTease,
    });
  }

  const passageSources = fellBack ? [] : citedPassages(script, pack.passages);
  return {
    status: 200,
    script,
    fellBack,
    usedFactIds: usedNuggetIds,
    gate: fellBack ? "fallback" : gate,
    sheetMs,
    writeMs,
    costUsd,
    sources: passageSources.length ? passageSources : sourceLines(pack, usedNuggetIds),
    openTease,
    spokenTopics: usedTopics,
    stationSpokenIds,
    ...(factType ? { factType } : {}),
  };
}

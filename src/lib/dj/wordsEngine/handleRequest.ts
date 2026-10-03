/**
 * Server entry for New words.
 * Classic `/api/generate-script` posts never call this.
 * A thin pack returns the true draft even when the model is down.
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
  type DjSegmentPlan,
} from "@/types/dj";
import { normalizeAlbumContext } from "@/types/station";
import { buildFactPack } from "./factPack";
import { composeNewBreak } from "./compose";
import { buildNewWordsPrompt } from "./prompt";
import type { FactPackInput } from "./types";

export type NewWordsResult = {
  status: number;
  script?: string;
  error?: string;
  fellBack?: boolean;
};

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

function readPrevious(value: unknown): { title: string; artist: string } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as { title?: unknown; artist?: unknown };
  const title = readString(row.title);
  const artist = readString(row.artist);
  if (!title && !artist) return undefined;
  return { title, artist };
}

async function polishWithModel(system: string, user: string): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 220,
      temperature: 0.3,
    }),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  return text || null;
}

export async function resolveNewWordsFromBody(
  body: Record<string, unknown>,
  tier: "free" | "pro",
): Promise<NewWordsResult> {
  const plan = readPlan(body.segmentPlan);
  const title = readString(body.songTitle);
  const artist = readString(body.artistName);
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

  const input: FactPackInput = {
    title,
    artist,
    album: readString(body.album),
    releaseYear: readYear(body.releaseYear),
    stationName: readString(body.stationName),
    personaId,
    depth,
    plan,
    previous: readPrevious(body.previousTrack),
    albumContext: normalizeAlbumContext(body.albumContext),
    allowExplicit: parseAllowExplicit(body.allowExplicit),
    weatherSummary: weatherSummary || undefined,
    homeCity: homeCity || undefined,
  };

  const pack = buildFactPack(input);
  let modelText: string | null = null;
  if (pack.nuggets.length > 0) {
    const draft = composeNewBreak(pack, null).script;
    const prompt = buildNewWordsPrompt(pack, draft);
    try {
      modelText = await polishWithModel(prompt.system, prompt.user);
    } catch {
      modelText = null;
    }
  }

  const composed = composeNewBreak(pack, modelText);
  if (!composed.script.trim()) {
    return { status: 502, error: "No script generated" };
  }
  return {
    status: 200,
    script: composed.script,
    fellBack: composed.fellBack || modelText == null,
  };
}

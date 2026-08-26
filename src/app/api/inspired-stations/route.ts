import { NextResponse } from "next/server";
import {
  buildInspiredSystemPrompt,
  buildInspiredUserPrompt,
  fallbackInspiredBlueprints,
  normalizeInspiredBlueprints,
  type InspiredSeed,
} from "@/lib/inspired-stations";

export const dynamic = "force-dynamic";

function parseSeed(body: unknown): InspiredSeed {
  if (!body || typeof body !== "object") return {};
  const raw = body as Record<string, unknown>;
  const seedGenres = Array.isArray(raw.seedGenres)
    ? raw.seedGenres.filter((g): g is string => typeof g === "string")
    : undefined;
  const seedArtists = Array.isArray(raw.seedArtists)
    ? raw.seedArtists.filter((a): a is string => typeof a === "string")
    : undefined;
  const seedStationName =
    typeof raw.seedStationName === "string" ? raw.seedStationName : undefined;
  return { seedGenres, seedArtists, seedStationName };
}

async function completeInspiredJson(
  apiKey: string,
  seed: InspiredSeed,
): Promise<unknown> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: buildInspiredSystemPrompt() },
        { role: "user", content: buildInspiredUserPrompt(seed) },
      ],
      max_tokens: 1200,
      temperature: 0.85,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI error: ${error}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error("No inspired stations generated");
  return JSON.parse(raw) as unknown;
}

/**
 * POST /api/inspired-stations
 *
 * One cheap LLM call → 5 station blueprints. No Spotify / iTunes / YouTube.
 * Tracks resolve later via `POST /api/station/generate` when the listener clicks.
 */
export async function POST(request: Request) {
  let seed: InspiredSeed = {};
  try {
    const body = await request.json().catch(() => null);
    seed = parseSeed(body);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ stations: fallbackInspiredBlueprints(seed) });
    }

    const parsed = await completeInspiredJson(apiKey, seed);
    return NextResponse.json({
      stations: normalizeInspiredBlueprints(parsed, seed),
    });
  } catch (err) {
    console.error("[api/inspired-stations] Failed:", err);
    return NextResponse.json({
      stations: fallbackInspiredBlueprints(seed),
    });
  }
}

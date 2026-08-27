import { NextResponse } from "next/server";
import { searchITunesSongs, type ITunesSong } from "@/lib/itunes";
import {
  blueprintsToStations,
  buildInspiredSystemPrompt,
  buildInspiredUserPrompt,
  fallbackInspiredBlueprints,
  normalizeInspiredBlueprints,
  type InspiredBlueprint,
  type InspiredSeed,
  type InspiredSeedTrack,
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

function seedSearchTerm(blueprint: InspiredBlueprint): string {
  const genres = blueprint.seedGenres.filter(Boolean).join(" ").trim();
  const era = blueprint.eras[0]?.trim() ?? "";
  const base = genres || blueprint.name.trim();
  return [base, era].filter(Boolean).join(" ").trim();
}

function seedTrackFromSong(song: ITunesSong): InspiredSeedTrack {
  return {
    title: song.title,
    artist: song.artist,
    ...(song.album ? { album: song.album } : {}),
    ...(song.artworkUrl ? { artworkUrl: song.artworkUrl } : {}),
    ...(song.previewUrl ? { previewUrl: song.previewUrl } : {}),
    ...(song.durationMs != null ? { durationMs: song.durationMs } : {}),
    ...(song.releaseYear != null ? { releaseYear: song.releaseYear } : {}),
  };
}

async function attachSeedTrack(blueprint: InspiredBlueprint): Promise<InspiredBlueprint> {
  try {
    const songs = await searchITunesSongs(seedSearchTerm(blueprint), 8);
    const song = songs.find((row) => Boolean(row.artworkUrl?.trim()));
    if (!song) return blueprint;
    return { ...blueprint, seedTrack: seedTrackFromSong(song) };
  } catch {
    return blueprint;
  }
}

async function attachSeedTracks(
  blueprints: InspiredBlueprint[],
): Promise<InspiredBlueprint[]> {
  return Promise.all(blueprints.map((blueprint) => attachSeedTrack(blueprint)));
}

/**
 * POST /api/inspired-stations
 *
 * One cheap LLM call → 5 station blueprints, then 5 parallel iTunes song
 * searches to pick a seed track (album art + first-play song) per card.
 * YouTube is not resolved here. Tracks resolve later via
 * `POST /api/station/generate` when the listener clicks.
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
    const blueprints = await attachSeedTracks(normalizeInspiredBlueprints(parsed, seed));
    return NextResponse.json({
      stations: blueprintsToStations(blueprints),
    });
  } catch (err) {
    console.error("[api/inspired-stations] Failed:", err);
    return NextResponse.json({
      stations: fallbackInspiredBlueprints(seed),
    });
  }
}

import { NextResponse } from "next/server";
import { getPersonaById, PERSONAS, type PersonaId } from "@/data/personas";
import type { StationTrack } from "@/data/stations";
import {
  CURATE_MAX_TOKENS,
  CURATE_REPEAT_TEMPERATURE,
  CURATE_TEMPERATURE,
  buildCurateSystemPrompt,
  buildCurateUserContent,
  parsePreviousTitles,
  selectHonestCuratedTracks,
  withHonestStationDescription,
} from "@/lib/curate-playlist";
import {
  mergeCuratedTitles,
  recallCuratedTitles,
  rememberCuratedTitles,
} from "@/lib/curated-prompt-memory";
import { resolveDjIdForQuery } from "@/lib/dj-resolver";
import { parseFailedYoutubeIds } from "@/lib/failed-youtube-ids";
import { resolveTrackVideoId } from "@/lib/youtube-search";

/** Roster is the source of truth, so a host change never leaves a stale prompt. */
const PERSONA_ROSTER_LINE = PERSONAS.map(
  (p) => `${p.id} (${p.name} — ${p.tier})`,
).join(", ");

/**
 * Each prompt is curated fresh. A repeat of the same prompt sends the songs
 * already used so the next list stays in that scene without repeating them.
 * Responses stay uncached.
 */
export const dynamic = "force-dynamic";

type CuratedPlaylist = {
  name: string;
  description: string;
  personaId: PersonaId;
  accentColor: string;
  tracks: StationTrack[];
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      prompt?: unknown;
      previousTitles?: unknown;
      excludeYoutubeIds?: unknown;
    };
    const prompt = body.prompt;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
    }

    const previousTitles = mergeCuratedTitles(
      recallCuratedTitles(prompt),
      parsePreviousTitles(body.previousTitles),
    );
    const sceneLock = previousTitles.length > 0 ? prompt.trim() : undefined;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: buildCurateSystemPrompt(PERSONA_ROSTER_LINE, sceneLock),
          },
          {
            role: "user",
            content: buildCurateUserContent(prompt, previousTitles),
          },
        ],
        max_tokens: CURATE_MAX_TOKENS,
        temperature: sceneLock ? CURATE_REPEAT_TEMPERATURE : CURATE_TEMPERATURE,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json({ error: `OpenAI error: ${error}` }, { status: 502 });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) {
      return NextResponse.json({ error: "No playlist generated" }, { status: 502 });
    }

    const parsed = JSON.parse(raw) as {
      name?: string;
      description?: string;
      personaId?: string;
      accentColor?: string;
      tracks?: { title: string; artist: string }[];
    };

    const honest = selectHonestCuratedTracks(
      Array.isArray(parsed.tracks) ? parsed.tracks : [],
      previousTitles,
    );
    if (honest.tracks.length === 0) {
      const error = honest.droppedRepeats
        ? "No different real songs were left that still fit this prompt."
        : "No real songs fit this prompt. Nothing was invented to fill the list.";
      return NextResponse.json({ error }, { status: 422 });
    }

    // The model can still answer with a host that does not exist, so an unusable
    // pick falls through to genre resolution on the listener's own prompt.
    const suggested = parsed.personaId ? getPersonaById(parsed.personaId) : undefined;
    const personaId: PersonaId =
      suggested?.id ??
      resolveDjIdForQuery(`${parsed.name ?? ""} ${parsed.description ?? ""} ${prompt}`);
    const resolvedTracks: StationTrack[] = [];
    const excludeYoutubeIds = parseFailedYoutubeIds(body.excludeYoutubeIds);
    const knownDead = excludeYoutubeIds.size > 0 ? excludeYoutubeIds : undefined;

    for (const track of honest.tracks) {
      const youtubeId = await resolveTrackVideoId(track.artist, track.title, knownDead);
      if (youtubeId) {
        resolvedTracks.push({ youtubeId, title: track.title, artist: track.artist });
      }
    }

    if (resolvedTracks.length === 0) {
      return NextResponse.json(
        { error: "Could not resolve playable tracks for this playlist. Try a different prompt." },
        { status: 422 },
      );
    }

    rememberCuratedTitles(
      prompt,
      resolvedTracks.map((track) => ({ title: track.title, artist: track.artist })),
    );

    const result: CuratedPlaylist = {
      name: parsed.name ?? "AI Curated Mix",
      description: withHonestStationDescription(
        parsed.description ?? prompt.trim(),
        resolvedTracks.length,
        { droppedRepeats: honest.droppedRepeats || previousTitles.length > 0 },
      ),
      personaId,
      accentColor: parsed.accentColor ?? "#F2AD4A",
      tracks: resolvedTracks,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("curate-playlist error:", error);
    return NextResponse.json({ error: "Failed to curate playlist" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getPersonaById, PERSONAS, type PersonaId } from "@/data/personas";
import type { StationTrack } from "@/data/stations";
import { resolveDjIdForQuery } from "@/lib/dj-resolver";
import { resolveTrackVideoId } from "@/lib/youtube-search";

/** Roster is the source of truth, so a host change never leaves a stale prompt. */
const PERSONA_ROSTER_LINE = PERSONAS.map(
  (p) => `${p.id} (${p.name} — ${p.tier})`,
).join(", ");

/**
 * Each prompt is curated fresh by the model and must never be served from cache,
 * or replaying a prompt would return a byte-identical playlist. Track order is
 * left alone here; the queue shuffles it on launch.
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
    const { prompt } = await request.json();

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
    }

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
            content: `You are an expert music curator for SongHost, a digital stream / curated station app. NEVER mention FM frequencies, dial numbers, or radio call letters. Given a user prompt, return a JSON object with:
- "name": short station name (max 40 chars)
- "description": one-line vibe description
- "personaId": one of: ${PERSONA_ROSTER_LINE}
- "accentColor": hex color matching the vibe (e.g. #F2AD4A)
- "tracks": array of exactly 10 objects with "title" and "artist" (real, well-known songs matching the prompt)

Return ONLY valid JSON, no markdown.`,
          },
          {
            role: "user",
            content: prompt.trim(),
          },
        ],
        max_tokens: 800,
        temperature: 0.85,
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

    // The model can still answer with a host that does not exist, so an unusable
    // pick falls through to genre resolution on the listener's own prompt.
    const suggested = parsed.personaId ? getPersonaById(parsed.personaId) : undefined;
    const personaId: PersonaId =
      suggested?.id ??
      resolveDjIdForQuery(`${parsed.name ?? ""} ${parsed.description ?? ""} ${prompt}`);
    const resolvedTracks: StationTrack[] = [];

    for (const track of parsed.tracks ?? []) {
      if (!track.title || !track.artist) continue;
      const youtubeId = await resolveTrackVideoId(track.artist, track.title);
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

    const result: CuratedPlaylist = {
      name: parsed.name ?? "AI Curated Mix",
      description: parsed.description ?? prompt.trim(),
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

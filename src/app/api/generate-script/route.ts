import { NextResponse } from "next/server";
import { buildSystemPrompt, buildUserPrompt } from "@/lib/dj/promptBuilder";
import { formatScriptForTts, sanitizeDjScript } from "@/lib/dj-script";
import type { PersonaId } from "@/data/personas";
import type { DJPromptContext } from "@/types/dj";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { songTitle, artistName, maxDurationInSeconds, personaId, djPersonaPrompt } = body;

    if (!songTitle || !artistName) {
      return NextResponse.json(
        { error: "songTitle and artistName are required" },
        { status: 400 },
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
    }

    const context: DJPromptContext = {
      track: { title: songTitle, artist: artistName },
      personaId: typeof personaId === "string" ? (personaId as PersonaId) : undefined,
      customPersonaPrompt:
        typeof djPersonaPrompt === "string" ? djPersonaPrompt : undefined,
      maxDurationSeconds: maxDurationInSeconds ?? 5,
    };

    const systemPrompt = buildSystemPrompt(context);
    const userPrompt = buildUserPrompt(context);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 80,
        temperature: 0.92,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json({ error: `OpenAI error: ${error}` }, { status: 502 });
    }

    const data = await response.json();
    const rawScript = data.choices?.[0]?.message?.content?.trim();
    const script = rawScript ? formatScriptForTts(sanitizeDjScript(rawScript)) : "";

    if (!script) {
      return NextResponse.json({ error: "No script generated" }, { status: 502 });
    }

    return NextResponse.json({ script });
  } catch (error) {
    console.error("generate-script error:", error);
    return NextResponse.json({ error: "Failed to generate script" }, { status: 500 });
  }
}

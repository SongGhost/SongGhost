import { NextResponse } from "next/server";
import { DEFAULT_PERSONA, getPersonaById } from "@/data/personas";
import { formatScriptForTts, sanitizeDjScript } from "@/lib/dj-script";

const TTS_DIALOGUE_RULES =
  " Write ONLY spoken dialogue that a real radio DJ would say out loud. Do NOT include sound effect labels, stage directions, or bracketed text like [growl] or *chuckles*.";

const BANNED_OPENERS =
  " STRICTLY FORBIDDEN openers: 'Fun fact:', 'Did you know:', 'Here's an interesting fact:', 'Welcome back listeners:', or any variation of those tired tropes.";

const HOOK_ANGLES = [
  {
    name: "Storyteller",
    instruction:
      "Open with a quick scene or memory tied to the song — like you're telling a short story on air.",
  },
  {
    name: "Opinion/Hype",
    instruction:
      "Lead with a bold hot take or hype line — why this track hits right now, no filler.",
  },
  {
    name: "Production/Musician",
    instruction:
      "Spotlight a sonic detail — a riff, beat, vocal, or production choice that makes this track stand out.",
  },
  {
    name: "Casual Tease",
    instruction:
      "Tease the track like you're talking to a friend — relaxed, playful, a little mysterious.",
  },
] as const;

const TTS_FORMAT_RULES = ` PUNCTUATION FOR TTS: Use ellipses (...) for natural breath pauses between thoughts. Use em-dashes (—) for casual mid-sentence pivots. Keep EVERY sentence under 12 words — short bursts sound alive on radio. No run-on sentences.${BANNED_OPENERS}`;

function pickHookAngle(): (typeof HOOK_ANGLES)[number] {
  return HOOK_ANGLES[Math.floor(Math.random() * HOOK_ANGLES.length)];
}

export async function POST(request: Request) {
  try {
    const { songTitle, artistName, maxDurationInSeconds, personaId, djPersonaPrompt } =
      await request.json();

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

    const persona = typeof personaId === "string" ? getPersonaById(personaId) : undefined;
    const hookAngle = pickHookAngle();
    const systemPrompt =
      (persona?.systemPrompt ??
        (typeof djPersonaPrompt === "string" && djPersonaPrompt.trim()
          ? djPersonaPrompt.trim()
          : DEFAULT_PERSONA.systemPrompt)) +
      TTS_DIALOGUE_RULES +
      TTS_FORMAT_RULES;

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
          {
            role: "user",
            content: `Introduce "${songTitle}" by ${artistName}. Use the "${hookAngle.name}" hook angle: ${hookAngle.instruction} Keep it under ${maxDurationInSeconds ?? 5} seconds when spoken.`,
          },
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
    const script = rawScript
      ? formatScriptForTts(sanitizeDjScript(rawScript))
      : "";

    if (!script) {
      return NextResponse.json({ error: "No script generated" }, { status: 502 });
    }

    return NextResponse.json({ script });
  } catch (error) {
    console.error("generate-script error:", error);
    return NextResponse.json({ error: "Failed to generate script" }, { status: 500 });
  }
}

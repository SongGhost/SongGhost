import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../route";
import { clearCuratedPromptMemory } from "@/lib/curated-prompt-memory";

vi.mock("@/lib/youtube-search", () => {
  let videoSeq = 0;
  return {
    resolveTrackVideoId: vi.fn(async () => {
      videoSeq += 1;
      return `v${String(videoSeq).padStart(10, "0")}`.slice(0, 11);
    }),
  };
});

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/curate-playlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function llmPayload(tracks: { title: string; artist: string }[], description = "Rain on the glass") {
  return {
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              name: "Night Window",
              description,
              personaId: "warm-companion",
              accentColor: "#F2AD4A",
              tracks,
            }),
          },
        },
      ],
    }),
  };
}

describe("POST /api/curate-playlist", () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    clearCuratedPromptMemory();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    clearCuratedPromptMemory();
  });

  it("asks for up to 25 songs and does not keep an 800-token budget", async () => {
    const tracks = Array.from({ length: 12 }, (_, index) => ({
      title: `Window Song ${index + 1}`,
      artist: "The Real Ones",
    }));
    globalThis.fetch = vi.fn().mockResolvedValue(llmPayload(tracks)) as unknown as typeof fetch;

    const res = await POST(jsonRequest({ prompt: "rainy night drive" }));
    const data = (await res.json()) as { tracks: { title: string }[]; description: string };

    expect(res.status).toBe(200);
    expect(data.tracks).toHaveLength(12);
    expect(data.description.toLowerCase()).toContain("fewer than 25");

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { body: string },
    ];
    const body = JSON.parse(init.body) as {
      max_tokens: number;
      messages: { content: string }[];
    };
    expect(body.max_tokens).toBeGreaterThan(800);
    expect(body.max_tokens).not.toBe(800);
    expect(body.messages[0].content.toLowerCase()).not.toContain("exactly 10");
    expect(body.messages[0].content).toContain("up to 25");
    expect(body.messages[0].content.toLowerCase()).toContain("never invent");
  });

  it("returns different songs when the same prompt is sent with a previous list", async () => {
    const previous = Array.from({ length: 10 }, (_, index) => ({
      title: `Canon ${index + 1}`,
      artist: "The Real Ones",
    }));
    const fresh = Array.from({ length: 6 }, (_, index) => ({
      title: `Fresh Cut ${index + 1}`,
      artist: "The Real Ones",
    }));

    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: { role: string; content: string }[];
      };
      const user = body.messages.find((message) => message.role === "user")?.content ?? "";
      const askedForDifferent =
        user.includes("Canon 1") && user.toLowerCase().includes("different real songs");
      const tracks = askedForDifferent ? [...previous, ...fresh] : previous;
      return llmPayload(tracks);
    }) as unknown as typeof fetch;

    const res = await POST(
      jsonRequest({ prompt: "rainy night drive", previousTitles: previous }),
    );
    const data = (await res.json()) as { tracks: { title: string; artist: string }[]; description: string };

    expect(res.status).toBe(200);
    expect(data.tracks.map((track) => track.title)).toEqual(fresh.map((song) => song.title));
    expect(data.tracks.map((track) => `${track.artist} — ${track.title}`)).not.toEqual(
      previous.map((song) => `${song.artist} — ${song.title}`),
    );
    expect(data.description.toLowerCase()).toContain("different songs");
    expect(data.description.toLowerCase()).toContain("fewer than 25");
  });

  it("does not accept padded titles when the model tries to fill 25", async () => {
    const real = Array.from({ length: 8 }, (_, index) => ({
      title: `Midnight Drive ${index + 1}`,
      artist: "The Real Ones",
    }));
    const pads = Array.from({ length: 17 }, (_, index) => ({
      title: `Song ${index + 1}`,
      artist: "Placeholder",
    }));
    globalThis.fetch = vi.fn().mockResolvedValue(llmPayload([...real, ...pads])) as unknown as typeof fetch;

    const res = await POST(jsonRequest({ prompt: "desert highway at dusk" }));
    const data = (await res.json()) as { tracks: { title: string }[]; description: string };

    expect(res.status).toBe(200);
    expect(data.tracks.map((track) => track.title)).toEqual(real.map((song) => song.title));
    expect(data.tracks).toHaveLength(8);
    expect(data.description.toLowerCase()).toContain("fewer than 25");
  });

  it("does not replay the identical set when no different songs were returned", async () => {
    const previous = [{ title: "Nightswimming", artist: "R.E.M." }];
    globalThis.fetch = vi.fn().mockResolvedValue(llmPayload(previous)) as unknown as typeof fetch;

    const res = await POST(
      jsonRequest({ prompt: "rainy night drive", previousTitles: previous }),
    );
    const data = (await res.json()) as { error?: string; tracks?: unknown[] };

    expect(res.status).toBe(422);
    expect(data.tracks).toBeUndefined();
    expect(data.error?.toLowerCase()).toContain("different");
  });
});
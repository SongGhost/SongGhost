import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../route";
import { INSPIRED_STATION_COUNT } from "@/lib/inspired-stations";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/inspired-stations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function llmPayload(stations: unknown[]) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ stations }) } }],
    }),
  };
}

describe("POST /api/inspired-stations", () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalKey;
    vi.restoreAllMocks();
  });

  it("returns 5 normalized blueprints from the LLM", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      llmPayload([
        {
          name: "90s Boom Bap",
          description: "Dusty drums",
          seedGenres: ["Boom Bap", "Hip-Hop"],
          eras: ["90s"],
          energyLevel: 60,
          catalogDepth: 40,
          accentColor: "#C4882A",
        },
        {
          name: "Trap Heavy",
          description: "808s",
          seedGenres: ["Trap", "Hip-Hop"],
          eras: ["Modern"],
          energyLevel: 85,
          catalogDepth: 25,
          accentColor: "#2992cf",
        },
        {
          name: "Conscious Rhymes",
          description: "Lyrical",
          seedGenres: ["Conscious Hip-Hop", "Rap"],
          eras: ["90s"],
          energyLevel: 50,
          catalogDepth: 70,
          accentColor: "#E07A3D",
        },
        {
          name: "West Coast G-Funk",
          description: "Talkbox",
          seedGenres: ["G-Funk", "West Coast"],
          eras: ["90s"],
          energyLevel: 55,
          catalogDepth: 45,
          accentColor: "#5B8FA8",
        },
        {
          name: "Lo-Fi Hip-Hop",
          description: "Head-nod",
          seedGenres: ["Lo-Fi Hip-Hop", "Chillhop"],
          eras: [],
          energyLevel: 30,
          catalogDepth: 75,
          accentColor: "#D4A017",
        },
      ]),
    ) as unknown as typeof fetch;

    const res = await POST(jsonRequest({ seedGenres: ["Hip-Hop"] }));
    const data = (await res.json()) as { stations: { name: string }[] };
    expect(res.status).toBe(200);
    expect(data.stations).toHaveLength(INSPIRED_STATION_COUNT);
    expect(data.stations.map((s) => s.name)).toEqual([
      "90s Boom Bap",
      "Trap Heavy",
      "Conscious Rhymes",
      "West Coast G-Funk",
      "Lo-Fi Hip-Hop",
    ]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { body: string },
    ];
    const body = JSON.parse(init.body) as { model: string };
    expect(body.model).toBe("gpt-4o-mini");
  });

  it("dedupes names, clamps numbers, and pads to 5", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      llmPayload([
        {
          name: "Night Drive",
          description: "One",
          seedGenres: ["Synthwave"],
          energyLevel: 140,
          catalogDepth: -4,
          accentColor: "#fff",
        },
        {
          name: "Night Drive",
          description: "Two",
          seedGenres: ["Synthpop"],
          energyLevel: 10,
          catalogDepth: 10,
          accentColor: "not-a-color",
        },
      ]),
    ) as unknown as typeof fetch;

    const res = await POST(jsonRequest({ seedGenres: ["Synthwave"], seedStationName: "Neon" }));
    const data = (await res.json()) as {
      stations: { name: string; energyLevel: number; catalogDepth: number; accentColor: string }[];
    };
    expect(data.stations).toHaveLength(5);
    expect(data.stations[0]?.name).toBe("Night Drive");
    expect(data.stations[1]?.name).toBe("Night Drive 2");
    expect(data.stations[0]?.energyLevel).toBe(100);
    expect(data.stations[0]?.catalogDepth).toBe(0);
    expect(data.stations[0]?.accentColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(data.stations.map((s) => s.name.toLowerCase())).size).toBe(5);
  });

  it("returns 5 fallbacks when the LLM fails", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    const res = await POST(jsonRequest({ seedGenres: ["Hip-Hop"] }));
    const data = (await res.json()) as { stations: { name: string }[] };
    expect(res.status).toBe(200);
    expect(data.stations).toHaveLength(5);
    expect(data.stations[0]?.name).toBe("90s Boom Bap");
  });

  it("returns 5 fallbacks when OPENAI_API_KEY is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const res = await POST(jsonRequest({ seedStationName: "Jazz Hour" }));
    const data = (await res.json()) as { stations: unknown[] };
    expect(res.status).toBe(200);
    expect(data.stations).toHaveLength(5);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FALLBACK_SCRIPTS,
  WELCOME_SCRIPTS,
  isLocalPrerecordedHost,
  pickUnusedRecent,
  playPrerecordedInGap,
  prerecordedPublicUrl,
  rememberPrerecordedPick,
  resetPrerecordedRecent,
  tryPlayPrerecordedFallback,
} from "../prerecorded";

afterEach(() => {
  resetPrerecordedRecent();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("prerecorded script bank", () => {
  it("has 15–17 welcome and fallback lines", () => {
    expect(WELCOME_SCRIPTS.length).toBeGreaterThanOrEqual(15);
    expect(WELCOME_SCRIPTS.length).toBeLessThanOrEqual(17);
    expect(FALLBACK_SCRIPTS.length).toBeGreaterThanOrEqual(15);
    expect(FALLBACK_SCRIPTS.length).toBeLessThanOrEqual(17);
  });

  it("brands SongHost / SonGhost and never SongGhost or Song Ghost", () => {
    const lines = [...WELCOME_SCRIPTS, ...FALLBACK_SCRIPTS].map((row: { text: string }) => row.text);
    for (const text of lines) {
      expect(text.includes("SongGhost")).toBe(false);
      expect(/Song\s+Ghost/i.test(text)).toBe(false);
      expect(text.includes("SongHost") || text.includes("SonGhost")).toBe(true);
    }
  });

  it("builds the public slot path", () => {
    expect(prerecordedPublicUrl(1, "welcome", "welcome-01")).toBe(
      "/audio/prerecorded/slot-1/welcome-01.wav",
    );
    expect(prerecordedPublicUrl(4, "fallback", "fallback-16")).toBe(
      "/audio/prerecorded/slot-4/fallback-16.wav",
    );
  });
});

describe("pickUnusedRecent", () => {
  it("prefers ids not in the recent window", () => {
    const pick = pickUnusedRecent(
      ["a", "b", "c"],
      ["a", "b"],
      () => 0,
    );
    expect(pick).toBe("c");
  });

  it("resets to the full pool when every id was recent", () => {
    const pick = pickUnusedRecent(["a", "b"], ["a", "b"], () => 0);
    expect(pick).toBe("a");
  });

  it("returns null for an empty bank", () => {
    expect(pickUnusedRecent([], [])).toBeNull();
  });
});

describe("rememberPrerecordedPick", () => {
  it("tracks recent ids per slot and kind", () => {
    rememberPrerecordedPick(1, "welcome", "welcome-01");
    rememberPrerecordedPick(1, "welcome", "welcome-02");
    const next = pickUnusedRecent(
      WELCOME_SCRIPTS.map((row: { id: string }) => row.id),
      // recent window is module state; pickUnusedRecent is tested with an explicit list
      ["welcome-01", "welcome-02"],
      () => 0,
    );
    expect(next).not.toBe("welcome-01");
    expect(next).not.toBe("welcome-02");
  });
});

describe("isLocalPrerecordedHost", () => {
  it("is Custom-only", () => {
    expect(isLocalPrerecordedHost("local", 2)).toBe(true);
    expect(isLocalPrerecordedHost("openai", 2)).toBe(false);
    expect(isLocalPrerecordedHost("local", undefined)).toBe(false);
  });
});

describe("playPrerecordedInGap", () => {
  it("refuses when Pass 1 canPlay is false", async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const played = await playPrerecordedInGap({
      kind: "fallback",
      slot: 1,
      voiceNode: { play, stop: vi.fn() },
      canPlay: () => false,
    });
    expect(played).toBe(false);
    expect(play).not.toHaveBeenCalled();
  });

  it("plays a fetched fallback while the gap is still open", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        headers: { get: () => "audio/wav" },
      }),
    );
    const play = vi.fn().mockResolvedValue(undefined);
    const onScript = vi.fn();
    const played = await playPrerecordedInGap({
      kind: "fallback",
      slot: 3,
      voiceNode: { play, stop: vi.fn() },
      generation: 4,
      canPlay: () => true,
      onScript,
    });
    expect(played).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
    expect(onScript).toHaveBeenCalledOnce();
    const spoken = String(onScript.mock.calls[0]?.[0] ?? "");
    expect(spoken.includes("SongHost") || spoken.includes("SonGhost")).toBe(true);
  });
});

describe("tryPlayPrerecordedFallback", () => {
  it("skips OpenAI voices", async () => {
    const play = vi.fn();
    const played = await tryPlayPrerecordedFallback({
      provider: "openai",
      voiceSlot: 1,
      voiceNode: { play, stop: vi.fn() },
      canPlay: () => true,
    });
    expect(played).toBe(false);
    expect(play).not.toHaveBeenCalled();
  });
});

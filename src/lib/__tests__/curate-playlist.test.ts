import { describe, expect, it } from "vitest";
import {
  CURATE_MAX_TOKENS,
  CURATE_TRACK_CAP,
  buildCurateSystemPrompt,
  buildCurateUserContent,
  selectHonestCuratedTracks,
} from "../curate-playlist";

describe("AI curate prompt", () => {
  it("asks for up to 25 real songs and raises the reply budget past 800", () => {
    const system = buildCurateSystemPrompt("warm-companion");
    expect(system).toContain("up to 25");
    expect(system.toLowerCase()).not.toContain("exactly 10");
    expect(system.toLowerCase()).toContain("never invent");
    expect(CURATE_TRACK_CAP).toBe(25);
    expect(CURATE_MAX_TOKENS).toBeGreaterThan(800);
    expect(CURATE_MAX_TOKENS).not.toBe(800);
  });

  it("sends the previous titles back and asks for different songs in the same scene", () => {
    const user = buildCurateUserContent("rainy night drive", [
      { title: "Nightswimming", artist: "R.E.M." },
    ]);
    expect(user).toContain("rainy night drive");
    expect(user).toContain("R.E.M. — Nightswimming");
    expect(user.toLowerCase()).toContain("era, mood, and scene");
    expect(user.toLowerCase()).toContain("different real songs");
    expect(user.toLowerCase()).toContain("do not invent");
  });
});

describe("selectHonestCuratedTracks", () => {
  const previous = [
    { title: "Nightswimming", artist: "R.E.M." },
    { title: "Enjoy the Silence", artist: "Depeche Mode" },
  ];

  it("returns the different honest titles and not the identical previous set", () => {
    const fresh = [
      { title: "Bizarre Love Triangle", artist: "New Order" },
      { title: "Friday I'm in Love", artist: "The Cure" },
    ];
    const selected = selectHonestCuratedTracks([...previous, ...fresh], previous);

    expect(selected.tracks).toEqual(fresh);
    expect(selected.tracks).not.toEqual(previous);
    expect(selected.droppedRepeats).toBe(true);
  });

  it("does not accept invented or padded titles to hit 25", () => {
    const real = Array.from({ length: 8 }, (_, index) => ({
      title: `Midnight Drive ${index + 1}`,
      artist: "The Real Ones",
    }));
    const pads = Array.from({ length: 17 }, (_, index) => ({
      title: `Song ${index + 1}`,
      artist: "Placeholder",
    }));

    const selected = selectHonestCuratedTracks([...real, ...pads], []);

    expect(selected.tracks).toEqual(real);
    expect(selected.tracks).toHaveLength(8);
    expect(selected.tracks.length).not.toBe(25);
    expect(selected.tracks.some((song) => /placeholder|song \d+/i.test(song.title))).toBe(false);
  });

  it("returns a shorter list when every title repeats the previous station", () => {
    const selected = selectHonestCuratedTracks(previous, previous);
    expect(selected.tracks).toEqual([]);
    expect(selected.droppedRepeats).toBe(true);
  });
});
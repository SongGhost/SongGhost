import { describe, expect, it } from "vitest";
import { eventMatchesArtist, normalizeArtistName } from "../artist-events";

describe("normalizeArtistName", () => {
  it("strips leading articles", () => {
    expect(normalizeArtistName("The Beatles")).toBe("beatles");
    expect(normalizeArtistName("A Perfect Circle")).toBe("perfect circle");
    expect(normalizeArtistName("An Horse")).toBe("horse");
  });

  it("normalizes punctuation and spacing", () => {
    expect(normalizeArtistName("AC/DC")).toBe("ac dc");
    expect(normalizeArtistName("Panic! At The Disco")).toBe("panic at the disco");
    expect(normalizeArtistName("  Portishead  ")).toBe("portishead");
  });

  it("normalizes both spellings of an article-prefixed band to the same key", () => {
    expect(normalizeArtistName("The Doors")).toBe(normalizeArtistName("Doors"));
  });
});

describe("eventMatchesArtist", () => {
  const event = (name: string, attractions?: string[]) => ({
    name,
    _embedded: attractions ? { attractions: attractions.map((a) => ({ name: a })) } : undefined,
  });

  it("matches on the attraction entity", () => {
    expect(eventMatchesArtist(event("Summer Slam 2026", ["Radiohead"]), "Radiohead")).toBe(true);
  });

  it("falls back to the event title when there are no attractions", () => {
    expect(eventMatchesArtist(event("An Evening With Tori Amos"), "Tori Amos")).toBe(true);
  });

  it("matches article-prefixed bands in either direction", () => {
    expect(eventMatchesArtist(event("Live: The Doors Tribute", ["The Doors"]), "Doors")).toBe(true);
    expect(eventMatchesArtist(event("Doors Reunion", ["Doors"]), "The Doors")).toBe(true);
  });

  it("no longer matches every 'The ...' event on the shared article", () => {
    // The old first-word check matched "the", so any "The ..." event looked like a hit.
    expect(eventMatchesArtist(event("The Weeknd"), "The Doors")).toBe(false);
    expect(eventMatchesArtist(event("The Killers", ["The Killers"]), "The Cure")).toBe(false);
  });

  it("ignores events with no usable name", () => {
    expect(eventMatchesArtist(event(""), "Radiohead")).toBe(false);
    expect(eventMatchesArtist(event("Radiohead"), "")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { pickMusicBrainzArtist } from "@/lib/catalog/musicbrainz";
import {
  claimsFromProse,
  copiesSource,
  memberClaim,
} from "../claims";
import { buildFactPack } from "../factPack";
import { composeNewBreak } from "../compose";
import { scriptPassesGate } from "../gate";

describe("artist identity lock", () => {
  it("keeps The National and drops The National Parks", () => {
    const hit = pickMusicBrainzArtist("The National", [
      { id: "parks", name: "The National Parks", score: 100, type: "Group" },
      { id: "ohio", name: "The National", score: 90, type: "Group" },
      { id: "other", name: "National", score: 80, type: "Group" },
    ]);
    expect(hit?.id).toBe("ohio");
  });
});

describe("wikipedia is paraphrased, not stored", () => {
  it("turns a band summary into short claims and drops a death sentence", () => {
    const extract = "The National is an American rock band from Cincinnati, Ohio, formed in 1999. The band consists of Matt Berninger (vocals) and Aaron Dessner (guitar). The singer died in 2020 after a long addiction.";
    const claims = claimsFromProse({
      text: extract,
      subject: "The National",
      kind: "band",
      sourceUrl: "https://en.wikipedia.org/wiki/The_National_(band)",
    });
    const blob = claims.map((claim) => claim.claim).join(" ");
    expect(blob).toMatch(/Cincinnati/);
    expect(blob).toMatch(/1999/);
    expect(blob.toLowerCase()).toMatch(/matt berninger/);
    expect(blob.toLowerCase()).not.toMatch(/died|addiction|american rock band/);
    for (const claim of claims) {
      expect(copiesSource(claim.claim, extract)).toBe(false);
      expect(claim.claim.length).toBeLessThan(extract.length / 2);
      expect(claim.sourceName).toBe("Wikipedia");
      expect(claim.sourceUrl).toContain("wikipedia.org");
    }
  });
});

describe("former members", () => {
  it("gives a founding member a leave year", () => {
    const claim = memberClaim({
      name: "Bryan Devendorf",
      instruments: ["drums"],
      beginYear: 1999,
      endYear: 2024,
      formedYear: 1999,
      sourceName: "MusicBrainz",
      sourceUrl: "https://musicbrainz.org/artist/example",
    });
    expect(claim?.claim).toMatch(/founding member, left in 2024/);
    expect(claim?.claim.toLowerCase()).not.toMatch(/died/);
  });
});

describe("release facts stay behind the story", () => {
  it("features a player before the year, and the fallback is not a track number", () => {
    const pack = buildFactPack({
      title: "Ice Machines",
      artist: "The National",
      album: "First Two Pages of Frankenstein",
      releaseYear: 2023,
      lookupTrackNumber: 9,
      depth: "directors_cut",
      personaId: "warm-companion",
      claims: [{
        id: "members:matt",
        claim: "Matt Berninger sings.",
        topic: "members",
        names: ["Matt Berninger"],
        places: [],
        years: [],
        numbers: [],
        instruments: ["vocals"],
        sourceName: "MusicBrainz",
        sourceUrl: "https://musicbrainz.org/artist/example",
        confidence: "high",
      }],
      plan: {
        kind: "song_intro",
        transition: "full_break",
        announceTracks: [{ title: "Ice Machines", artist: "The National" }],
        maxDurationSeconds: 20,
        isSessionOpening: false,
      },
    });
    expect(pack.nuggets[0]?.id).toBe("members:matt");
    expect(pack.nuggets[0]?.topic).toBe("members");
    const spoken = composeNewBreak(pack, "Ice Machines by The National came out in 2023. It is track 9.");
    expect(spoken.fellBack).toBe(true);
    expect(spoken.script).toMatch(/Matt Berninger/);
    expect(spoken.script).not.toMatch(/track 9/);
    expect(scriptPassesGate(
      "Ice Machines by The National came out in 2023. It is track 9.",
      pack,
    )).toBe(false);
  });

  it("rejects a name that is not on the sheet", () => {
    const pack = buildFactPack({
      title: "Ice Machines",
      artist: "The National",
      depth: "roots_branches",
      personaId: "standard-broadcast",
      claims: [{
        id: "members:matt",
        claim: "Matt Berninger sings.",
        topic: "members",
        names: ["Matt Berninger"],
        places: [],
        years: [],
        numbers: [],
        instruments: ["vocals"],
        sourceName: "MusicBrainz",
        sourceUrl: "https://musicbrainz.org/artist/example",
        confidence: "high",
      }],
      plan: {
        kind: "song_intro",
        transition: "full_break",
        announceTracks: [{ title: "Ice Machines", artist: "The National" }],
        maxDurationSeconds: 18,
        isSessionOpening: false,
      },
    });
    expect(scriptPassesGate(
      "Up next, Ice Machines by The National. Sufjan Stevens sings on this one. Notice the vocal when it comes in. That is the whole story of the take, and it is why the next song is worth hearing right now.",
      pack,
    )).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  isLaterEditionTitle,
  pickOriginalStudioRelease,
  readMusicBrainzMembers,
} from "@/lib/catalog/musicbrainz";
import { claimsFromProse } from "../claims";
import { buildFactPack } from "../factPack";
import { sourceLineOk } from "../sourceGate";
import type { FactPack } from "../types";

describe("original studio album", () => {
  it("keeps Rumours in 1977 and drops a 2019 remaster title", () => {
    const pick = pickOriginalStudioRelease({
      releases: [
        {
          title: "Rumours (2019 Remaster)",
          date: "2019-01-01",
          status: "Official",
          "release-group": { id: "rg-re", title: "Rumours (2019 Remaster)", "primary-type": "Album" },
        },
        {
          title: "Rumours",
          date: "1977-02-04",
          status: "Official",
          "release-group": { id: "rg-rumours", title: "Rumours", "primary-type": "Album" },
        },
      ],
    });
    expect(isLaterEditionTitle("Jolene (Kygo Edit)")).toBe(true);
    expect(pick?.title).toBe("Rumours");
    expect(pick?.year).toBe(1977);
    expect(pick?.releaseGroupId).toBe("rg-rumours");
  });
});

describe("band membership", () => {
  it("does not say someone left when a later membership continues", () => {
    const members = readMusicBrainzMembers([
      {
        type: "member of band",
        ended: true,
        begin: "1968",
        end: "1969",
        artist: { name: "Geezer Butler" },
        attributes: ["bass"],
      },
      {
        type: "member of band",
        begin: "1969",
        artist: { name: "Geezer Butler" },
        attributes: ["bass guitar"],
      },
      {
        type: "member of band",
        ended: true,
        begin: "1981",
        end: "1983",
        artist: { name: "Dave Mustaine" },
        attributes: ["guitar"],
      },
    ]);
    const geezer = members.find((member) => member.name === "Geezer Butler");
    const dave = members.find((member) => member.name === "Dave Mustaine");
    expect(geezer?.ended).toBe(false);
    expect(geezer?.endYear).toBeUndefined();
    expect(dave?.ended).toBe(true);
    expect(dave?.endYear).toBe(1983);
  });
});

describe("wikipedia fragments", () => {
  it("does not store an about-line that runs past a sentence", () => {
    const claims = claimsFromProse({
      text: "Livin' la Vida Loca is about an irresistible particularly sinister wild woman who lives in a story that keeps going well past the point where a short cut would stop cold.",
      subject: "Livin' la Vida Loca",
      kind: "song",
      artistName: "Ricky Martin",
      sourceUrl: "https://en.wikipedia.org/wiki/Livin%27_la_Vida_Loca",
    });
    expect(claims.map((claim) => claim.claim).join(" ")).not.toMatch(/who lives/);
  });
});

describe("source gate", () => {
  const pack = {
    engine: "new",
    depth: "standard",
    maxNuggets: 1,
    personaId: "standard-broadcast",
    shape: "lore",
    shapeVariant: 0,
    includeStationId: false,
    now: { title: "Go Your Own Way", artist: "Fleetwood Mac" },
    songOneExit: false,
    recapLines: [],
    nuggets: [],
    sheet: [{
      id: "song_story:composer",
      claim: "Lindsey Buckingham composed Go Your Own Way.",
      topic: "song_story",
      names: ["Lindsey Buckingham", "Go Your Own Way"],
      places: [],
      years: [],
      numbers: [],
      instruments: [],
      sourceName: "MusicBrainz",
      sourceUrl: "https://musicbrainz.org/recording/example",
      confidence: "high",
    }],
    passages: [{
      sourceName: "Wikipedia",
      url: "https://en.wikipedia.org/wiki/Rumours_(album)",
      title: "Rumours",
      text: "Rumours is the eleventh studio album by Fleetwood Mac, released in 1977 in the United States. The band recorded it at studios in California.",
    }],
    nextSheet: [],
    allowExplicit: true,
    allowedYears: [1977],
    length: { minWords: 40, maxWords: 70 },
    sessionOpening: false,
  } as FactPack;

  it("allows U.S. when the source says United States", () => {
    const line = "I love how Rumours, cut in California and out in 1977, still feels like the band is in the room. This is Go Your Own Way by Fleetwood Mac, their first top-ten hit in the U.S.";
    expect(sourceLineOk(line, pack)).toBe(true);
    const invented = "This is Go Your Own Way by Fleetwood Mac, a hit in the U.K. in 1977.";
    expect(sourceLineOk(invented, pack)).toBe(false);
  });

  it("allows a warm line when the year and the name are in the source", () => {
    const line = "I love how Rumours, cut in California and out in 1977, still feels like the band is in the room. This is Go Your Own Way by Fleetwood Mac, and it is the one I turn up.";
    expect(sourceLineOk(line, pack)).toBe(true);
  });

  it("rejects a year and a name the source does not have", () => {
    expect(sourceLineOk("Go Your Own Way came out in 2019, from Fleetwood Mac.", pack)).toBe(false);
    expect(sourceLineOk("Geezer Butler left in 1969. This is Go Your Own Way by Fleetwood Mac.", pack)).toBe(false);
  });

  it("does not let a composer be called the lyricist", () => {
    expect(sourceLineOk("Lindsey Buckingham wrote the lyrics for Go Your Own Way by Fleetwood Mac.", pack)).toBe(false);
  });

  it("does not tease the next song's story", () => {
    const built = buildFactPack({
      title: "So What",
      artist: "Miles Davis",
      depth: "standard",
      claims: [],
      nextClaims: [{
        id: "song_story:desmond",
        claim: "Paul Desmond composed Take Five.",
        topic: "song_story",
        names: ["Paul Desmond", "Take Five"],
        places: [],
        years: [],
        numbers: [],
        instruments: [],
        sourceName: "Wikipedia",
        sourceUrl: "https://en.wikipedia.org/wiki/Take_Five",
        confidence: "high",
      }],
      plan: {
        kind: "song_intro",
        transition: "full_break",
        announceTracks: [{ title: "So What", artist: "Miles Davis" }],
        maxDurationSeconds: 12,
        isSessionOpening: false,
      },
    });
    expect(built.tease).toBeUndefined();
  });
});

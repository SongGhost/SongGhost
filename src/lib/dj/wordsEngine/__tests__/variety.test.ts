/**
 * Variety: a break cannot repeat a fact, a stock closer, a bare name,
 * or a listen-for that is not a sound.
 */
import { describe, expect, it } from "vitest";
import { claimsFromProse } from "../claims";
import { buildFactPack } from "../factPack";
import { scriptPassesGate } from "../gate";
import { exampleBreak } from "../prompt";
import type { SheetClaim } from "../claims";
import type { FactPackInput } from "../types";
import { earCue, factKey, isBlankCredit, rotationType, specificCreditRole } from "../variety";

function claim(partial: Partial<SheetClaim> & Pick<SheetClaim, "id" | "claim" | "topic">): SheetClaim {
  return {
    names: [],
    places: [],
    years: [],
    numbers: [],
    instruments: [],
    sourceName: "Wikipedia",
    sourceUrl: "https://en.wikipedia.org/wiki/Example",
    confidence: "high",
    ...partial,
  };
}

function plan(title: string, artist: string, index = 0) {
  return {
    kind: "song_intro" as const,
    transition: "full_break" as const,
    announceTracks: [{ title, artist }],
    maxDurationSeconds: 20,
    isSessionOpening: false,
    styleRotationIndex: index,
  };
}

function pack(input: FactPackInput) {
  return buildFactPack({
    depth: "roots_branches",
    personaId: "warm-companion",
    ...input,
  });
}

describe("listen-for is only a sound", () => {
  it("does not treat a studio as something to listen for", () => {
    const studio = {
      sentence: "Oblivions was recorded at Long Pond.",
      places: ["Long Pond"],
      instruments: [],
      names: ["Oblivions"],
    };
    expect(earCue(studio)).toBeNull();
    const built = pack({
      title: "Oblivions",
      artist: "The National",
      claims: [claim({
        id: "album_story:pond",
        claim: "Oblivions was recorded at Long Pond.",
        topic: "album_story",
        names: ["Oblivions"],
        places: ["Long Pond"],
      })],
      plan: plan("Oblivions", "The National"),
    });
    expect(exampleBreak(built)).not.toMatch(/listen for/i);
    expect(scriptPassesGate(
      "Listen for Long Pond studio. Oblivions was recorded at Long Pond. Here's Oblivions.",
      built,
    )).toBe(false);
    expect(scriptPassesGate(
      "Listen for Drummerman Studios by The National. Mr. November was recorded there. Here's Oblivions.",
      built,
    )).toBe(false);
  });

  it("keeps listen-for for an instrument on the sheet", () => {
    const built = pack({
      title: "Born to Beg",
      artist: "The National",
      claims: [claim({
        id: "members:aaron",
        claim: "Aaron Dessner plays guitar.",
        topic: "members",
        names: ["Aaron Dessner"],
        instruments: ["guitar"],
      })],
      plan: plan("Born to Beg", "The National"),
    });
    expect(earCue(built.nuggets[0]!)).toBe("guitar");
    expect(exampleBreak(built)).toMatch(/the guitar you'll hear/i);
    expect(exampleBreak(built)).not.toMatch(/^(?:hear|listen for)\b/i);
    expect(scriptPassesGate(exampleBreak(built), built)).toBe(true);
    expect(scriptPassesGate(
      "Aaron Dessner plays guitar. Hear the guitar. Here's Born to Beg.",
      built,
    )).toBe(false);
  });
});

describe("empty credit roles are dropped", () => {
  it("drops a credit whose role is only the word instrument", () => {
    expect(specificCreditRole("instrument")).toBeNull();
    expect(specificCreditRole("electric guitar")).toBe("electric guitar");
    expect(isBlankCredit("Sufjan Stevens is credited on Re: Stacks for instrument.")).toBe(true);
    const built = pack({
      title: "Re: Stacks",
      artist: "Bon Iver",
      claims: [
        claim({
          id: "connections:blank",
          claim: "Sufjan Stevens is credited on Re: Stacks for instrument.",
          topic: "connections",
          names: ["Sufjan Stevens", "Re: Stacks"],
          instruments: ["instrument"],
        }),
        claim({
          id: "members:justin",
          claim: "Justin Vernon sings.",
          topic: "members",
          names: ["Justin Vernon"],
          instruments: ["vocals"],
        }),
      ],
      plan: plan("Re: Stacks", "Bon Iver"),
    });
    expect(built.nuggets.map((nugget) => nugget.sentence).join(" ")).not.toMatch(/instrument/);
    expect(scriptPassesGate(
      "Listen for the instrument. Justin Vernon sings. Here's Re: Stacks.",
      built,
    )).toBe(false);
  });
});

describe("stock closers and bare names", () => {
  it("rejects the repeated stock phrases and a sentence that is only a name", () => {
    const built = pack({
      title: "Tropic Morning News",
      artist: "The National",
      claims: [claim({
        id: "origin:cincy",
        claim: "The National formed in Cincinnati in 1999.",
        topic: "origin",
        names: ["The National"],
        places: ["Cincinnati"],
        years: [1999],
      })],
      plan: plan("Tropic Morning News", "The National"),
    });
    const spoken = exampleBreak(built);
    expect(spoken).not.toMatch(/That's the part worth knowing|That's the record this song is on|got started|you'll find this track/i);
    expect(spoken).not.toMatch(/(?:^|\.\s+)The National\./);
    expect(scriptPassesGate(spoken, built)).toBe(true);
    expect(scriptPassesGate(
      "The National formed in Cincinnati in 1999. That's where The National got started. Here's Tropic Morning News.",
      built,
    )).toBe(false);
    expect(scriptPassesGate(
      "The National formed in Cincinnati in 1999. That's the part worth knowing about The National. Here's Tropic Morning News.",
      built,
    )).toBe(false);
    expect(scriptPassesGate(
      "The National. The National formed in Cincinnati in 1999. Here's Tropic Morning News.",
      built,
    )).toBe(false);
    expect(scriptPassesGate(
      "The National formed in Cincinnati in 1999. Tropic Morning News by The National. Here's Tropic Morning News.",
      built,
    )).toBe(false);
    const again = pack({
      title: "Oblivions",
      artist: "The National",
      usedConnectors: ["is named in that"],
      claims: [claim({
        id: "members:matt",
        claim: "Matt Berninger sings.",
        topic: "members",
        names: ["Matt Berninger"],
        instruments: ["vocals"],
      })],
      plan: plan("Oblivions", "The National"),
    });
    expect(scriptPassesGate(
      "Matt Berninger sings. Matt Berninger is named in that. Here's Oblivions.",
      again,
    )).toBe(false);
  });
});

describe("a station does not reuse a fact", () => {
  it("skips a studio and an album already used, and does not restate a tease", () => {
    const pond = claim({
      id: "album_story:studio:long-pond-studio",
      claim: "Tropic Morning News was recorded at Long Pond studio.",
      topic: "album_story",
      names: ["Tropic Morning News"],
      places: ["Long Pond studio"],
    });
    const ordinal = claim({
      id: "album_story:ordinal:ninth",
      claim: "Their ninth studio album is First Two Pages of Frankenstein.",
      topic: "album_story",
      names: ["First Two Pages of Frankenstein"],
    });
    const guitar = claim({
      id: "members:aaron-guitar",
      claim: "Aaron Dessner plays guitar.",
      topic: "members",
      names: ["Aaron Dessner"],
      instruments: ["guitar"],
    });
    expect(factKey(pond)).toBe(factKey({
      id: "album_story:studio:long-pond",
      claim: "Oblivions was recorded at Long Pond.",
      places: ["Long Pond"],
    }));
    const next = pack({
      title: "Oblivions",
      artist: "The National",
      usedFactKeys: [factKey(pond), factKey(ordinal)],
      recentRotation: ["place", "album_story", "place"],
      claims: [pond, ordinal, guitar],
      plan: plan("Oblivions", "The National"),
    });
    expect(next.nuggets[0]?.sentence).toMatch(/guitar/);
    expect(next.nuggets.map((nugget) => nugget.sentence).join(" ")).not.toMatch(/Long Pond|Frankenstein/);

    const teased = claim({
      id: "album_story:producer:aaron",
      claim: "Aaron Dessner produced Graceless.",
      topic: "album_story",
      names: ["Aaron Dessner", "Graceless"],
    });
    const deeper = pack({
      title: "Graceless",
      artist: "The National",
      payoff: teased,
      usedFactKeys: [factKey(teased)],
      boostNames: ["Aaron Dessner"],
      recentRotation: ["collaboration", "place", "album_story"],
      claims: [
        teased,
        claim({
          id: "members:aaron",
          claim: "Aaron Dessner plays guitar.",
          topic: "members",
          names: ["Aaron Dessner"],
          instruments: ["guitar"],
        }),
      ],
      plan: plan("Graceless", "The National"),
    });
    expect(deeper.nuggets[0]?.sentence).toMatch(/guitar/);
    expect(deeper.nuggets.map((row) => row.sentence).join(" ")).not.toMatch(/produced/);
    expect(scriptPassesGate(
      "Aaron Dessner produced Graceless. Aaron Dessner plays guitar. Here's Graceless.",
      deeper,
    )).toBe(false);
    expect(rotationType(guitar)).toBe("sound");
    expect(rotationType(pond)).toBe("place");
  });
});

describe("deeper sheet claims", () => {
  it("keeps siblings, meaning, a chart single, a cover, and a film use", () => {
    const text = [
      "Aaron Dessner and Bryce Dessner are brothers.",
      "The band met in Cincinnati while attending college.",
      "Matt Berninger sings the lead vocals.",
      "Bloodbuzz Ohio is about missing Ohio.",
      "Bloodbuzz Ohio was the lead single.",
      "It reached number 12.",
      "The song samples \"Tapes\".",
      "It was used in the film Somewhere.",
      "Sharon Van Etten covered Bloodbuzz Ohio.",
    ].join(" ");
    const claims = claimsFromProse({
      text,
      subject: "Bloodbuzz Ohio",
      kind: "song",
      artistName: "The National",
      allowedPeople: ["Aaron Dessner", "Bryce Dessner", "Matt Berninger"],
      sourceUrl: "https://en.wikipedia.org/wiki/Bloodbuzz_Ohio",
    });
    const blob = claims.map((row) => row.claim).join(" | ");
    expect(blob).toMatch(/brothers/);
    expect(blob).toMatch(/lead vocals|sings/);
    expect(blob).toMatch(/about missing Ohio/);
    expect(blob).toMatch(/lead single/);
    expect(blob).toMatch(/number 12/);
    expect(blob).toMatch(/samples/);
    expect(blob).toMatch(/Somewhere/);
    expect(blob).toMatch(/Sharon Van Etten/);
    const topics = new Set(claims.map((row) => row.topic));
    expect(topics.has("song_story") || topics.has("connections") || topics.has("reception")).toBe(true);
  });

  it("does not store a quotation that was cut off mid-sentence", () => {
    const claims = claimsFromProse({
      text: 'Fake Empire is about "where you can\'t deal with the fact that the world is ending." The National are the band.',
      subject: "Fake Empire",
      kind: "song",
      artistName: "The National",
      sourceUrl: "https://en.wikipedia.org/wiki/Fake_Empire",
    });
    const blob = claims.map((row) => row.claim).join(" | ");
    expect(blob).not.toMatch(/deal with the/);
    expect(blob).not.toMatch(/["“”]/);
  });

  it("does not treat a nationality as the person who wrote the song", () => {
    const claims = claimsFromProse({
      text: "The lyrics were written by American singer-songwriter Justin Vernon.",
      subject: "Skinny Love",
      kind: "song",
      artistName: "Bon Iver",
      sourceUrl: "https://en.wikipedia.org/wiki/Skinny_Love",
    });
    const blob = claims.map((row) => row.claim).join(" | ");
    expect(blob).toMatch(/Justin Vernon wrote the lyrics/);
    expect(blob).not.toMatch(/American wrote/);
    const instrumental = claimsFromProse({
      text: "So What was written by Miles Davis.",
      subject: "So What",
      kind: "song",
      artistName: "Miles Davis",
      sourceUrl: "https://en.wikipedia.org/wiki/So_What_(Miles_Davis_composition)",
    });
    const written = instrumental.map((row) => row.claim).join(" | ");
    expect(written).toMatch(/Miles Davis wrote So What/);
    expect(written).not.toMatch(/lyrics/);
    const dotted = claimsFromProse({
      text: "Folsom Prison Blues was composed by Gordon Jenkins.",
      subject: "Folsom Prison Blues",
      kind: "song",
      artistName: "Johnny Cash",
      sourceUrl: "https://en.wikipedia.org/wiki/Folsom_Prison_Blues",
    });
    expect(dotted.map((row) => row.claim).join(" | ")).toMatch(/Gordon Jenkins composed Folsom Prison Blues/);
    expect(dotted.map((row) => row.claim).join(" | ")).not.toMatch(/Jenkins\./);
  });

  it("keeps a film title and drops the rest of the sentence", () => {
    const claims = claimsFromProse({
      text: "I Need My Girl was featured in the film Entourage and on episodes of the television series The Mindy Project.",
      subject: "I Need My Girl",
      kind: "song",
      artistName: "The National",
      sourceUrl: "https://en.wikipedia.org/wiki/I_Need_My_Girl",
    });
    const blob = claims.map((row) => row.claim).join(" | ");
    expect(blob).toMatch(/used in Entourage/);
    expect(blob).not.toMatch(/episodes of the/);
  });
});

describe("titles with a period", () => {
  it("accepts Up next for a title like Mr. November", () => {
    const built = pack({
      title: "Mr. November",
      artist: "The National",
      claims: [claim({
        id: "album_story:alligator",
        claim: "Their third studio album is Alligator.",
        topic: "album_story",
        names: ["Alligator"],
      })],
      plan: plan("Mr. November", "The National", 2),
    });
    const spoken = exampleBreak(built);
    expect(spoken).toMatch(/Up next, Mr\. November by The National/);
    expect(scriptPassesGate(spoken, built)).toBe(true);
    expect(spoken).not.toMatch(/is named in that/);
  });
});

import { describe, expect, it } from "vitest";
import { claimsFromProse, hometownClaim } from "../claims";
import { composeNewBreak } from "../compose";
import { buildFactPack } from "../factPack";
import {
  albumTitleMismatch,
  brokenOrdinal,
  scriptPassesGate,
  stackedFacts,
  teaseFactForeign,
} from "../gate";
import { exampleBreak } from "../prompt";
import type { FactPackInput } from "../types";
import type { SheetClaim } from "../claims";

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

function plan(title: string, artist: string, album?: string) {
  return {
    kind: "song_intro" as const,
    transition: "full_break" as const,
    announceTracks: [{ title, artist, ...(album ? { album } : {}) }],
    maxDurationSeconds: 20,
    isSessionOpening: false,
    styleRotationIndex: 0,
  };
}

function pack(input: FactPackInput) {
  return buildFactPack({
    depth: "roots_branches",
    personaId: "warm-companion",
    ...input,
  });
}

describe("human DJ breaks", () => {
  it("rejects a broken album-number template and speaks the ordinal as a word", () => {
    const frankenstein = "First Two Pages of Frankenstein is the ninth studio album by the National, released on April 28, 2023, by 4AD.";
    const claims = claimsFromProse({
      text: frankenstein,
      subject: "First Two Pages of Frankenstein",
      kind: "album",
      artistName: "The National",
      sourceUrl: "https://en.wikipedia.org/wiki/First_Two_Pages_of_Frankenstein",
    });
    const ordinal = claims.find((row) => row.id.startsWith("album_story:ordinal"));
    expect(ordinal?.claim).toBe("Their ninth studio album is First Two Pages of Frankenstein.");
    expect(ordinal?.claim).not.toMatch(/album number|number of the album/i);

    const built = pack({
      title: "Oblivions",
      artist: "The National",
      album: "First Two Pages of Frankenstein",
      claims: ordinal ? [ordinal] : [],
      plan: plan("Oblivions", "The National", "First Two Pages of Frankenstein"),
    });
    const spoken = exampleBreak(built);
    expect(brokenOrdinal("The number of the album is eighth.")).toBe(true);
    expect(brokenOrdinal("This is album number ninth.")).toBe(true);
    expect(scriptPassesGate("The number of the album is eighth. That is the record. Here's Oblivions.", built)).toBe(false);
    expect(scriptPassesGate("This is album number ninth. That is the record. Here's Oblivions.", built)).toBe(false);
    expect(spoken).not.toMatch(/album number|number of the album/i);
    expect(spoken).toMatch(/Their ninth studio album is First Two Pages of Frankenstein/);
  });

  it("keeps the full album title and does not attach eighth to Frankenstein", () => {
    const easy = claimsFromProse({
      text: "I Am Easy to Find is the eighth studio album by The National.",
      subject: "I Am Easy to Find",
      kind: "album",
      artistName: "The National",
      sourceUrl: "https://en.wikipedia.org/wiki/I_Am_Easy_to_Find",
    });
    expect(easy.map((row) => row.claim).join(" ")).toMatch(/Their eighth studio album is I Am Easy to Find/);
    expect(easy.map((row) => row.claim).join(" ")).not.toMatch(/\bFind is the eighth/);

    const mixed = claimsFromProse({
      text: "First Two Pages of Frankenstein is the ninth studio album by the National. It followed I Am Easy to Find, their eighth studio album.",
      subject: "First Two Pages of Frankenstein",
      kind: "album",
      artistName: "The National",
      sourceUrl: "https://en.wikipedia.org/wiki/First_Two_Pages_of_Frankenstein",
    });
    const blob = mixed.map((row) => row.claim).join(" ");
    expect(blob).toMatch(/ninth/);
    expect(blob).not.toMatch(/eighth/);
    expect(blob).not.toMatch(/Frankenstein is the ninth/);

    const built = pack({
      title: "Oblivions",
      artist: "The National",
      album: "First Two Pages of Frankenstein",
      claims: [
        claim({
          id: "album_story:ordinal:eighth",
          claim: "Their eighth studio album is I Am Easy to Find.",
          topic: "album_story",
          names: ["I Am Easy to Find"],
        }),
        claim({
          id: "album_story:ordinal:ninth",
          claim: "Their ninth studio album is First Two Pages of Frankenstein.",
          topic: "album_story",
          names: ["First Two Pages of Frankenstein"],
        }),
      ],
      plan: plan("Oblivions", "The National", "First Two Pages of Frankenstein"),
    });
    expect(built.nuggets.map((nugget) => nugget.sentence).join(" ")).not.toMatch(/eighth|I Am Easy to Find/);
    expect(built.nuggets[0]?.sentence).toMatch(/First Two Pages of Frankenstein/);
    const fragment = "Find is the eighth studio album. That's the record this song is on. Here's Oblivions.";
    expect(albumTitleMismatch(fragment, built)).toBe(true);
    expect(scriptPassesGate(fragment, built)).toBe(false);
    const frankenstein = "Frankenstein is the ninth studio album. That's the record this song is on. Here's Oblivions.";
    expect(scriptPassesGate(frankenstein, built)).toBe(false);
    const clause = "Their ninth studio album is First Two Pages of Frankenstein, which is where this track comes from. That's the record this song is on. Here's Oblivions.";
    expect(albumTitleMismatch(clause, built)).toBe(false);
  });

  it("rejects label praise and does not teach a label on its own", () => {
    const built = pack({
      title: "Oblivions",
      artist: "The National",
      album: "First Two Pages of Frankenstein",
      claims: [
        claim({
          id: "album_story:label:4ad",
          claim: "First Two Pages of Frankenstein came out on 4AD.",
          topic: "album_story",
          names: ["4AD", "First Two Pages of Frankenstein"],
        }),
        claim({
          id: "album_story:pond",
          claim: "Oblivions was recorded at Long Pond.",
          topic: "album_story",
          names: ["Oblivions"],
          places: ["Long Pond"],
        }),
      ],
      plan: plan("Oblivions", "The National", "First Two Pages of Frankenstein"),
    });
    expect(built.nuggets.some((nugget) => /4AD|label/i.test(nugget.sentence))).toBe(false);
    const praise = "4AD is the label here, recognized for its influential roster. That's the label. Here's Oblivions.";
    expect(scriptPassesGate(praise, built)).toBe(false);
    expect(scriptPassesGate("Long Pond is known for its acclaimed rooms. That's where they cut this one. Here's Oblivions.", built)).toBe(false);
  });

  it("leads with the featured guest on this track, not an album guest", () => {
    const built = pack({
      title: "This Isn't Helping (feat. Phoebe Bridgers)",
      artist: "The National",
      album: "First Two Pages of Frankenstein",
      depth: "directors_cut",
      claims: [
        claim({
          id: "connections:sufjan",
          claim: "Sufjan Stevens is a guest on First Two Pages of Frankenstein.",
          topic: "connections",
          names: ["Sufjan Stevens", "First Two Pages of Frankenstein"],
        }),
        claim({
          id: "album_story:ordinal:ninth",
          claim: "Their ninth studio album is First Two Pages of Frankenstein.",
          topic: "album_story",
          names: ["First Two Pages of Frankenstein"],
        }),
      ],
      plan: plan("This Isn't Helping (feat. Phoebe Bridgers)", "The National", "First Two Pages of Frankenstein"),
    });
    expect(built.nuggets[0]?.sentence).toMatch(/Phoebe Bridgers/);
    expect(built.nuggets[0]?.sentence).not.toMatch(/Sufjan/);
    expect(built.nuggets.some((nugget) => /ninth|Sufjan/.test(nugget.sentence))).toBe(false);
    const spoken = exampleBreak(built);
    expect(spoken).toMatch(/Phoebe Bridgers/);
    expect(spoken.indexOf("Phoebe")).toBeLessThan(spoken.indexOf("Sufjan") === -1 ? spoken.length : spoken.indexOf("Sufjan"));
    expect(spoken).not.toMatch(/\(feat\./i);
    expect(spoken).not.toMatch(/This Isn't Helping \(feat\. Phoebe Bridgers\)\./);
  });

  it("teases the next song's sheet as a hook, not After that plus another album", () => {
    const built = pack({
      title: "Start a War",
      artist: "The National",
      album: "Boxer",
      depth: "directors_cut",
      claims: [
        claim({
          id: "album_story:ordinal:fourth",
          claim: "Their fourth studio album is Boxer.",
          topic: "album_story",
          names: ["Boxer"],
        }),
      ],
      nextClaims: [
        claim({
          id: "release:album",
          claim: "Oblivions is on First Two Pages of Frankenstein.",
          topic: "release",
          names: ["Oblivions", "First Two Pages of Frankenstein"],
        }),
        claim({
          id: "album_story:ordinal:ninth",
          claim: "Their ninth studio album is First Two Pages of Frankenstein.",
          topic: "album_story",
          names: ["First Two Pages of Frankenstein"],
        }),
        claim({
          id: "connections:phoebe",
          claim: "Phoebe Bridgers is a guest on Oblivions.",
          topic: "connections",
          names: ["Phoebe Bridgers", "Oblivions"],
        }),
      ],
      plan: plan("Start a War", "The National", "Boxer"),
    });
    expect(built.tease?.claim).toMatch(/Phoebe Bridgers/);
    expect(built.tease?.claim).not.toMatch(/Frankenstein|ninth/);
    const spoken = exampleBreak(built);
    expect(spoken).toMatch(/Stick around, the next one has Phoebe Bridgers/);
    expect(spoken).not.toMatch(/After that/i);
    expect(scriptPassesGate(spoken, built)).toBe(true);
    const wrong = "Start a War is on Boxer. That's the record. After that, Frankenstein is the ninth studio album.";
    expect(teaseFactForeign(wrong, built)).toBe(true);
    expect(scriptPassesGate(wrong, built)).toBe(false);
  });

  it("does not append a station label or a bare title, and strips a featuring parenthesis", () => {
    const built = pack({
      title: "This Isn't Helping (feat. Phoebe Bridgers)",
      artist: "The National",
      album: "First Two Pages of Frankenstein",
      stationName: "Artist Radio: The National",
      claims: [
        claim({
          id: "track-feat:phoebe-bridgers",
          claim: "Phoebe Bridgers is the featured guest on this song.",
          topic: "connections",
          names: ["Phoebe Bridgers"],
        }),
      ],
      plan: {
        ...plan("This Isn't Helping (feat. Phoebe Bridgers)", "The National", "First Two Pages of Frankenstein"),
        includeStinger: true,
      },
    });
    const passed = exampleBreak(built);
    const spoken = composeNewBreak(built, JSON.stringify({ script: passed }));
    expect(spoken.fellBack).toBe(false);
    expect(spoken.script).toBe(passed);
    expect(spoken.script).not.toMatch(/Artist Radio/);
    expect(spoken.script).not.toMatch(/\(feat\./i);
    expect(spoken.script).not.toMatch(/(?:^|\.\s+)This Isn't Helping\.$/);
    expect(spoken.script).toMatch(/Here's This Isn't Helping, from The National\.$/);

    const fallback = composeNewBreak(built, "Oblivions.");
    expect(fallback.fellBack).toBe(true);
    expect(fallback.script).not.toMatch(/Artist Radio/);
    expect(fallback.script).not.toMatch(/\bOblivions\.$/);
    expect(fallback.script).not.toMatch(/\(feat\./i);
  });

  it("connects two facts or keeps one, and rejects a credit stack", () => {
    const stack = "Sufjan Stevens is a guest. 4AD is the label. Aaron Dessner plays guitar.";
    expect(stackedFacts(stack)).toBe(true);
    const linked = pack({
      title: "Graceless",
      artist: "The National",
      album: "Trouble Will Find Me",
      depth: "directors_cut",
      claims: [
        claim({
          id: "album_story:producer:aaron",
          claim: "Aaron Dessner produced Graceless.",
          topic: "album_story",
          names: ["Aaron Dessner", "Graceless"],
        }),
        claim({
          id: "members:aaron",
          claim: "Aaron Dessner plays guitar.",
          topic: "members",
          names: ["Aaron Dessner"],
          instruments: ["guitar"],
        }),
        claim({
          id: "album_story:label:4ad",
          claim: "Trouble Will Find Me came out on 4AD.",
          topic: "album_story",
          names: ["4AD"],
        }),
      ],
      plan: plan("Graceless", "The National", "Trouble Will Find Me"),
    });
    expect(linked.nuggets.map((nugget) => nugget.id)).toEqual(["members:aaron", "album_story:producer:aaron"]);
    expect(linked.nuggets.some((nugget) => /4AD/.test(nugget.sentence))).toBe(false);
    const spoken = exampleBreak(linked);
    expect(spoken).toMatch(/same one/i);
    expect(spoken).not.toMatch(/4AD/);
    expect(scriptPassesGate(stack, linked)).toBe(false);

    const unlinked = pack({
      title: "Graceless",
      artist: "The National",
      album: "Trouble Will Find Me",
      depth: "directors_cut",
      claims: [
        claim({
          id: "album_story:pond",
          claim: "Graceless was recorded at Long Pond.",
          topic: "album_story",
          names: ["Graceless"],
          places: ["Long Pond"],
        }),
        claim({
          id: "members:bryan",
          claim: "Bryan Devendorf plays drums.",
          topic: "members",
          names: ["Bryan Devendorf"],
          instruments: ["drums"],
        }),
      ],
      plan: plan("Graceless", "The National", "Trouble Will Find Me"),
    });
    expect(unlinked.nuggets).toHaveLength(1);
    expect(unlinked.nuggets[0]?.sentence).toMatch(/Long Pond/);

    const sameSong = pack({
      title: "Bloodbuzz Ohio",
      artist: "The National",
      album: "High Violet",
      depth: "directors_cut",
      claims: [
        claim({
          id: "credit:bryce",
          claim: "Bryce Dessner is credited on Bloodbuzz Ohio for electric guitar.",
          topic: "members",
          names: ["Bryce Dessner", "Bloodbuzz Ohio"],
          instruments: ["electric guitar"],
        }),
        claim({
          id: "album_story:kampo",
          claim: "Bloodbuzz Ohio was recorded at Kampo Studios.",
          topic: "album_story",
          names: ["Bloodbuzz Ohio"],
          places: ["Kampo Studios"],
        }),
      ],
      plan: plan("Bloodbuzz Ohio", "The National", "High Violet"),
    });
    expect(sameSong.nuggets).toHaveLength(1);

    const mister = exampleBreak(pack({
      title: "Mr. November",
      artist: "The National",
      album: "Alligator",
      claims: [
        claim({
          id: "album_story:drummerman",
          claim: "Mr. November was recorded at Drummerman Studios.",
          topic: "album_story",
          names: ["Mr. November"],
          places: ["Drummerman Studios"],
        }),
      ],
      plan: plan("Mr. November", "The National", "Alligator"),
    }));
    expect(mister.match(/Here's Mr\. November/g)).toHaveLength(1);
    expect(hometownClaim({
      name: "Sufjan Stevens.",
      place: "American",
      sourceName: "MusicBrainz",
      sourceUrl: "https://musicbrainz.org/artist/x",
    })).toBeNull();
  });
});

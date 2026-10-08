/**
 * A break sounds spoken: varied handoff, a woven cue, a fact worth hearing,
 * and a tease that is spent before the next break.
 */
import { describe, expect, it } from "vitest";
import type { SheetClaim } from "../claims";
import { oneFactLine } from "../compose";
import { buildFactPack } from "../factPack";
import { scriptPassesGate } from "../gate";
import { exampleBreak } from "../prompt";
import type { FactPackInput } from "../types";
import {
  cannedSongHandoff,
  factKey,
  hasStandaloneCue,
  spentFact,
  repeatsSentenceShape,
  restatesFact,
  sentenceShape,
  sentenceShapes,
} from "../variety";

function claim(partial: Partial<SheetClaim> & Pick<SheetClaim, "id" | "claim" | "topic">): SheetClaim {
  return {
    names: [],
    places: [],
    years: [],
    numbers: [],
    instruments: [],
    sourceName: "MusicBrainz",
    sourceUrl: "https://musicbrainz.org/recording/example",
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
    depth: "directors_cut",
    personaId: "warm-companion",
    ...input,
  });
}

const walla = claim({
  id: "members:walla",
  claim: "Chris Walla played guitar, founding member, left in 2014.",
  topic: "members",
  names: ["Chris Walla"],
  years: [2014],
  instruments: ["guitar"],
});
const lyrics = claim({
  id: "song_story:lyrics",
  claim: "Justin Vernon wrote the lyrics for Skinny Love.",
  topic: "song_story",
  names: ["Justin Vernon", "Skinny Love"],
});
const lyricsOtherWords = claim({
  id: "connections:lyrics:justin-vernon",
  claim: "Justin Vernon has written lyrics for Skinny Love.",
  topic: "connections",
  names: ["Justin Vernon", "Skinny Love"],
});
const behind = claim({
  id: "connections:project:justin-vernon",
  claim: "Justin Vernon is the musician behind Skinny Love.",
  topic: "connections",
  names: ["Justin Vernon", "Skinny Love"],
});
const year = claim({
  id: "release:year",
  claim: "Skinny Love came out in 2008.",
  topic: "release",
  names: ["Skinny Love"],
  years: [2008],
  numbers: ["2008"],
});
const trumpet = claim({
  id: "connections:william-swan:trumpet",
  claim: "William Swan is credited on Soul Meets Body for trumpet.",
  topic: "connections",
  names: ["William Swan", "Soul Meets Body"],
  instruments: ["trumpet"],
});
const album = claim({
  id: "album_story:plans",
  claim: "Soul Meets Body is on Plans.",
  topic: "album_story",
  names: ["Plans"],
});
const formed = claim({
  id: "origin:bellingham",
  claim: "Death Cab for Cutie formed in Bellingham.",
  topic: "origin",
  names: ["Death Cab for Cutie"],
  places: ["Bellingham"],
});

describe("handoff is optional and does not repeat", () => {
  it("bans The song is X, from Y, and does not draft that line", () => {
    const built = pack({
      title: "Soul Meets Body",
      artist: "Death Cab for Cutie",
      claims: [walla],
      plan: plan("Soul Meets Body", "Death Cab for Cutie", 3),
    });
    const banned = "The song is Soul Meets Body, from Death Cab for Cutie. Chris Walla played guitar, founding member, left in 2014.";
    expect(cannedSongHandoff(banned)).toBe(true);
    expect(scriptPassesGate(banned, built)).toBe(false);
    for (let index = 0; index < 5; index += 1) {
      const draft = exampleBreak(pack({
        title: "Soul Meets Body",
        artist: "Death Cab for Cutie",
        claims: [walla],
        plan: plan("Soul Meets Body", "Death Cab for Cutie", index),
      }));
      expect(draft).not.toMatch(/the song is .+ from /i);
      expect(cannedSongHandoff(draft)).toBe(false);
    }
  });

  it("rejects a handoff shape this station already used", () => {
    const first = "Here's Soul Meets Body.";
    const built = pack({
      title: "Rosyln",
      artist: "Bon Iver & St. Vincent",
      claims: [claim({
        id: "members:justin",
        claim: "Justin Vernon sings on Rosyln.",
        topic: "song_story",
        names: ["Justin Vernon"],
      })],
      plan: plan("Rosyln", "Bon Iver & St. Vincent"),
    });
    const used = sentenceShape(first, {
      ...built,
      now: { title: "Soul Meets Body", artist: "Death Cab for Cutie" },
    });
    const again = pack({
      title: "Rosyln",
      artist: "Bon Iver & St. Vincent",
      usedShapes: [used],
      claims: [claim({
        id: "song_story:film",
        claim: "Rosyln was used in New Moon.",
        topic: "song_story",
        names: ["New Moon"],
      })],
      plan: plan("Rosyln", "Bon Iver & St. Vincent"),
    });
    expect(sentenceShape("Here's Rosyln.", again)).toBe(used);
    expect(scriptPassesGate(
      "Rosyln was used in New Moon. Here's Rosyln. Bon Iver & St. Vincent.",
      again,
    )).toBe(false);
    expect(repeatsSentenceShape("Here's Rosyln.", again)).toBe(true);
  });
});

describe("a listen-for is woven into the fact", () => {
  it("rejects Hear the trumpet and Listen for the guitar as their own sentences", () => {
    const built = pack({
      title: "Soul Meets Body",
      artist: "Death Cab for Cutie",
      claims: [trumpet],
      plan: plan("Soul Meets Body", "Death Cab for Cutie"),
    });
    expect(built.nuggets[0]?.sentence).toBe("William Swan plays the trumpet on this one.");
    const tacked = "William Swan plays the trumpet on this one. Hear the trumpet. Here's Soul Meets Body by Death Cab for Cutie.";
    expect(hasStandaloneCue(tacked)).toBe(true);
    expect(scriptPassesGate(tacked, built)).toBe(false);
    expect(scriptPassesGate(
      "Listen for the trumpet. William Swan plays the trumpet on this one. Soul Meets Body by Death Cab for Cutie.",
      built,
    )).toBe(false);
    const woven = "William Swan plays the trumpet you'll hear on Soul Meets Body by Death Cab for Cutie.";
    expect(hasStandaloneCue(woven)).toBe(false);
    expect(scriptPassesGate(woven, built)).toBe(true);
  });
});

describe("fact value", () => {
  it("ranks a person with a story, then song, album, and hometown, above a year or a bare credit", () => {
    const songs = [
      walla,
      lyrics,
      album,
      formed,
      year,
      behind,
      trumpet,
    ];
    const first = pack({
      title: "Soul Meets Body",
      artist: "Death Cab for Cutie",
      claims: songs,
      plan: plan("Soul Meets Body", "Death Cab for Cutie"),
    });
    expect(first.nuggets[0]?.sentence).toMatch(/Chris Walla/);
    expect(first.nuggets.map((nugget) => nugget.sentence).join(" ")).not.toMatch(/2008|musician behind|trumpet/);

    const afterPeople = pack({
      title: "Skinny Love",
      artist: "Bon Iver",
      usedFactKeys: [factKey(walla)],
      claims: [lyrics, album, formed, year, behind, trumpet],
      plan: plan("Skinny Love", "Bon Iver"),
    });
    expect(afterPeople.nuggets[0]?.sentence).toMatch(/wrote the lyrics/);

    const afterSong = pack({
      title: "Soul Meets Body",
      artist: "Death Cab for Cutie",
      usedFactKeys: [factKey(walla), factKey(lyrics)],
      claims: [album, formed, year, behind, trumpet],
      plan: plan("Soul Meets Body", "Death Cab for Cutie"),
    });
    expect(afterSong.nuggets[0]?.sentence).toMatch(/Plans/);

    const afterAlbum = pack({
      title: "Soul Meets Body",
      artist: "Death Cab for Cutie",
      usedFactKeys: [factKey(walla), factKey(lyrics), factKey(album)],
      claims: [formed, year, behind, trumpet],
      plan: plan("Soul Meets Body", "Death Cab for Cutie"),
    });
    expect(afterAlbum.nuggets[0]?.sentence).toMatch(/Bellingham/);

    const onlyThin = pack({
      title: "Skinny Love",
      artist: "Bon Iver",
      claims: [year, behind],
      plan: plan("Skinny Love", "Bon Iver"),
    });
    expect(onlyThin.nuggets[0]?.sentence).toMatch(/musician behind|2008/);
  });
});

describe("a tease spends its fact in the gate", () => {
  it("does not let the next break restate the lyric fact in different words", () => {
    expect(factKey(lyrics)).toBe(factKey(lyricsOtherWords));
    expect(factKey(lyrics)).toBe("lyric:justin-vernon");
    const gibbardFull = claim({
      id: "song_story:gibbard",
      claim: "Singer-songwriter Ben Gibbard wrote Soul Meets Body.",
      topic: "song_story",
      names: ["Ben Gibbard", "Soul Meets Body"],
    });
    const gibbardShort = claim({
      id: "song_story:gibbard-short",
      claim: "Gibbard wrote Soul Meets Body.",
      topic: "song_story",
      names: ["Gibbard", "Soul Meets Body"],
    });
    expect(factKey(gibbardFull)).toBe("lyric:ben-gibbard");
    expect(spentFact(new Set([factKey(gibbardFull)]), gibbardShort)).toBe(true);
    expect(restatesFact(
      "Coming up, Soul Meets Body by Death Cab for Cutie. Gibbard wrote Soul Meets Body.",
      gibbardFull,
    )).toBe(true);
    const aaron = claim({
      id: "song_story:aaron",
      claim: "Aaron Dessner wrote the lyrics for The System Only Dreams in Total Darkness.",
      topic: "song_story",
      names: ["Aaron Dessner"],
    });
    const bryce = claim({
      id: "song_story:bryce",
      claim: "Bryce Dessner wrote the lyrics for Fake Empire.",
      topic: "song_story",
      names: ["Bryce Dessner"],
    });
    expect(spentFact(new Set([factKey(aaron)]), bryce)).toBe(false);
    expect(restatesFact("Bryce Dessner wrote the lyrics for Fake Empire.", aaron)).toBe(false);
    const next = pack({
      title: "Skinny Love",
      artist: "Bon Iver",
      payoff: lyrics,
      usedFactKeys: [factKey(lyrics)],
      boostNames: ["Justin Vernon"],
      claims: [lyricsOtherWords, behind, claim({
        id: "album_story:cabin",
        claim: "Skinny Love was recorded at a hunting cabin.",
        topic: "album_story",
        names: ["Skinny Love"],
        places: ["a hunting cabin"],
      })],
      plan: plan("Skinny Love", "Bon Iver"),
    });
    expect(next.nuggets[0]?.sentence).toMatch(/hunting cabin/);
    expect(next.nuggets.map((nugget) => nugget.sentence).join(" ")).not.toMatch(/lyrics|musician behind/);
    const repeated = "Justin Vernon wrote the lyrics for Skinny Love, and he is also the musician behind it. Skinny Love by Bon Iver.";
    expect(restatesFact(repeated, lyrics)).toBe(true);
    expect(scriptPassesGate(repeated, next)).toBe(false);
    const paid = "Skinny Love was recorded at a hunting cabin. That's Skinny Love by Bon Iver.";
    expect(scriptPassesGate(paid, next)).toBe(true);
  });
});

describe("a departure is one fact", () => {
  it("treats left-in 1999 and left-in 2000 as the same person leaving", () => {
    const early = claim({
      id: "members:nathan-1999",
      claim: "Nathan Good, founding member, left in 1999.",
      topic: "members",
      names: ["Nathan Good"],
      years: [1999],
    });
    const later = claim({
      id: "members:nathan-2000",
      claim: "Nathan Good, founding member, left in 2000.",
      topic: "members",
      names: ["Nathan Good"],
      years: [2000],
    });
    expect(factKey(early)).toBe(factKey(later));
    expect(factKey(early)).toBe("left:nathan-good");
    const next = pack({
      title: "I Will Follow You Into the Dark",
      artist: "Death Cab for Cutie",
      payoff: later,
      usedFactKeys: [factKey(later)],
      claims: [early, later, claim({
        id: "album_story:long-view",
        claim: "I Will Follow You Into the Dark was recorded at Long View Farm Studios.",
        topic: "album_story",
        places: ["Long View Farm Studios"],
        names: ["I Will Follow You Into the Dark"],
      })],
      plan: plan("I Will Follow You Into the Dark", "Death Cab for Cutie"),
    });
    expect(next.nuggets[0]?.sentence).toMatch(/Long View/);
    expect(restatesFact("Nathan Good, a founding member, left the band in 1999.", later)).toBe(true);
    expect(scriptPassesGate(
      "Nathan Good, a founding member, left the band in 1999. Here's I Will Follow You Into the Dark by Death Cab for Cutie.",
      next,
    )).toBe(false);
  });
});

describe("sentence shape", () => {
  it("masks names and titles so two handoffs are one shape", () => {
    const built = pack({
      title: "I Will Follow You Into the Dark",
      artist: "Death Cab for Cutie",
      claims: [formed],
      plan: plan("I Will Follow You Into the Dark", "Death Cab for Cutie"),
    });
    const left = sentenceShape("The song is Soul Meets Body, from Death Cab for Cutie.", {
      ...built,
      now: { title: "Soul Meets Body", artist: "Death Cab for Cutie" },
    });
    const right = sentenceShape("The song is I Will Follow You Into the Dark, from Death Cab for Cutie.", built);
    expect(left).toBe(right);
    expect(sentenceShape("Here's Soul Meets Body.", built)).not.toBe(left);
    const firstClose = "Andy Immernan engineered Holocene, on Holocene by Bon Iver.";
    const secondClose = "Crooked Teeth reached number 10, on Crooked Teeth by Death Cab for Cutie.";
    const holocene = pack({
      title: "Holocene",
      artist: "Bon Iver",
      claims: [claim({
        id: "album_story:engineer",
        claim: "Andy Immernan engineered Holocene.",
        topic: "album_story",
        names: ["Andy Immernan", "Holocene"],
      })],
      plan: plan("Holocene", "Bon Iver"),
    });
    const teeth = pack({
      title: "Crooked Teeth",
      artist: "Death Cab for Cutie",
      usedShapes: sentenceShapes(firstClose, holocene),
      claims: [claim({
        id: "reception:ten",
        claim: "Crooked Teeth reached number 10.",
        topic: "reception",
        names: ["Crooked Teeth"],
        numbers: ["10"],
      })],
      plan: plan("Crooked Teeth", "Death Cab for Cutie"),
    });
    expect(scriptPassesGate(secondClose, teeth)).toBe(false);
  });

  it("picks a new closing shape when on-title-by-artist is already used", () => {
    const holocene = pack({
      title: "Holocene",
      artist: "Bon Iver",
      claims: [claim({
        id: "album_story:engineer",
        claim: "Andy Immernan engineered Holocene.",
        topic: "album_story",
        names: ["Andy Immernan", "Holocene"],
      })],
      plan: plan("Holocene", "Bon Iver"),
    });
    const first = oneFactLine(holocene).script;
    expect(first).toMatch(/on Holocene by Bon Iver/i);
    const girl = pack({
      title: "I Need My Girl",
      artist: "The National",
      usedShapes: sentenceShapes(first, holocene),
      claims: [claim({
        id: "song_story:lyrics",
        claim: "Matt Berninger wrote the lyrics for I Need My Girl.",
        topic: "song_story",
        names: ["Matt Berninger", "I Need My Girl"],
      })],
      plan: plan("I Need My Girl", "The National"),
    });
    const second = oneFactLine(girl).script;
    const used = new Set(sentenceShapes(first, holocene));
    for (const shape of sentenceShapes(second, girl)) {
      expect(used.has(shape), shape).toBe(false);
    }
    expect(second).not.toMatch(/on I Need My Girl by The National/i);
  });
});

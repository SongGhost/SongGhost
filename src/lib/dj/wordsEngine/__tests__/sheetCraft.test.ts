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

describe("album story is kept, release trivia is not the story", () => {
  it("pulls the studio, the label, and the guests off an album summary", () => {
    const album = "First Two Pages of Frankenstein is the ninth studio album by the American indie rock band the National, released on April 28, 2023, by 4AD. The album was produced by The National at Long Pond studio in upstate New York and features guest appearances from Sufjan Stevens, Phoebe Bridgers, and Taylor Swift.";
    const claims = claimsFromProse({
      text: album,
      subject: "First Two Pages of Frankenstein",
      kind: "album",
      sourceUrl: "https://en.wikipedia.org/wiki/First_Two_Pages_of_Frankenstein",
      allowedPeople: ["Matt Berninger"],
    });
    const blob = claims.map((claim) => claim.claim).join(" | ");
    expect(blob).toMatch(/Long Pond/);
    expect(blob).toMatch(/Sufjan Stevens/);
    expect(blob).toMatch(/Phoebe Bridgers/);
    expect(blob).toMatch(/Taylor Swift/);
    expect(blob).toMatch(/4AD/);
    expect(blob).toMatch(/ninth studio album/);
    expect(blob).toMatch(/The National produced/);
    for (const claim of claims) {
      expect(copiesSource(claim.claim, album)).toBe(false);
    }
  });

  it("does not turn the last word of a long album title into the subject", () => {
    const text = "I Never Loved a Man the Way I Love You is the ninth studio album by American singer Aretha Franklin, released on March 10, 1967, by Atlantic Records.";
    const claims = claimsFromProse({
      text,
      subject: "I Never Loved a Man the Way I Love You",
      kind: "album",
      sourceUrl: "https://en.wikipedia.org/wiki/I_Never_Loved_a_Man_the_Way_I_Love_You",
    });
    const blob = claims.map((claim) => claim.claim).join(" ");
    expect(blob).toMatch(/This record is the ninth studio album/);
    expect(blob).not.toMatch(/You is the ninth/);
    expect(blob).toMatch(/Atlantic Records/);
  });

  it("does not borrow the original artist's year from a shared song page", () => {
    const text = "Respect is a song by American soul singer-songwriter Otis Redding, originally recorded and released by himself in 1965 as a single from his third album Otis Blue. Aretha Franklin in 1967 rearranged, rephrased, and covered it, resulting in her breakout hit.";
    const claims = claimsFromProse({
      text,
      subject: "Respect",
      kind: "song",
      artistName: "Aretha Franklin",
      sourceUrl: "https://en.wikipedia.org/wiki/Respect_(song)",
    });
    const blob = claims.map((claim) => claim.claim).join(" ");
    expect(blob).toMatch(/1967/);
    expect(blob).toMatch(/Aretha Franklin/);
    expect(blob).not.toMatch(/1965/);
    expect(blob).not.toMatch(/Otis/);
  });

  it("keeps a hometown apart from the city where the band formed", () => {
    const text = "The National is an American rock band from Cincinnati, Ohio, formed in Brooklyn, New York City, in 1999.";
    const claims = claimsFromProse({
      text,
      subject: "The National",
      kind: "band",
      sourceUrl: "https://en.wikipedia.org/wiki/The_National_(band)",
    });
    const blob = claims.map((claim) => claim.claim).join(" ");
    expect(blob).toMatch(/from Cincinnati/);
    expect(blob).toMatch(/formed in Brooklyn in 1999/);
    expect(blob).not.toMatch(/formed in Cincinnati/);
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

describe("album and song pages keep the story", () => {
  it("pulls a writer, what the song is about, and a lead single", () => {
    const text = "I Need My Girl is a song by the American indie rock band The National. Matt Berninger wrote it about his wife during a hard tour. It was the lead single from Trouble Will Find Me.";
    const claims = claimsFromProse({
      text,
      subject: "I Need My Girl",
      kind: "song",
      artistName: "The National",
      sourceUrl: "https://en.wikipedia.org/wiki/I_Need_My_Girl",
    });
    const blob = claims.map((claim) => claim.claim).join(" | ");
    expect(blob).toMatch(/Matt Berninger wrote/);
    expect(blob).toMatch(/about his wife/);
    expect(blob).toMatch(/lead single/);
    expect(blob).not.toMatch(/hard tour/);
  });

  it("pulls who mixed the record and where the sessions were", () => {
    const text = "Trouble Will Find Me is the sixth studio album by The National. It was mixed by Peter Katis. The band held sessions at Tarbox Road Studios before the release.";
    const claims = claimsFromProse({
      text,
      subject: "Trouble Will Find Me",
      kind: "album",
      artistName: "The National",
      sourceUrl: "https://en.wikipedia.org/wiki/Trouble_Will_Find_Me",
    });
    const blob = claims.map((claim) => claim.claim).join(" | ");
    expect(blob).toMatch(/Peter Katis mixed/);
    expect(blob).toMatch(/Tarbox Road Studios/);
    expect(blob).toMatch(/sixth studio album/);
  });
});

describe("story beats another instrument, and credited on stays credited on", () => {
  it("features the album story when a guitar credit is also new", () => {
    const pack = buildFactPack({
      title: "Bloodbuzz Ohio",
      artist: "The National",
      depth: "roots_branches",
      personaId: "warm-companion",
      claims: [
        {
          id: "members:aaron",
          claim: "Aaron Dessner plays guitar.",
          topic: "members",
          names: ["Aaron Dessner"],
          places: [],
          years: [],
          numbers: [],
          instruments: ["guitar"],
          sourceName: "MusicBrainz",
          sourceUrl: "https://musicbrainz.org/artist/example",
          confidence: "high",
        },
        {
          id: "album_story:pond",
          claim: "Bloodbuzz Ohio was recorded at Long Pond.",
          topic: "album_story",
          names: ["Bloodbuzz Ohio"],
          places: ["Long Pond"],
          years: [],
          numbers: [],
          instruments: [],
          sourceName: "Wikipedia",
          sourceUrl: "https://en.wikipedia.org/wiki/High_Violet",
          confidence: "high",
        },
      ],
      plan: {
        kind: "song_intro",
        transition: "full_break",
        announceTracks: [{ title: "Bloodbuzz Ohio", artist: "The National" }],
        maxDurationSeconds: 18,
        isSessionOpening: false,
      },
    });
    expect(pack.nuggets[0]?.topic).toBe("album_story");
    expect(pack.nuggets[0]?.sentence).toMatch(/Long Pond/);
  });

  it("does not turn a credit into plays", () => {
    const pack = buildFactPack({
      title: "Bloodbuzz Ohio",
      artist: "The National",
      depth: "roots_branches",
      personaId: "standard-broadcast",
      claims: [{
        id: "connections:sufjan",
        claim: "Sufjan Stevens is credited on guitar.",
        topic: "connections",
        names: ["Sufjan Stevens"],
        places: [],
        years: [],
        numbers: [],
        instruments: ["guitar"],
        sourceName: "MusicBrainz",
        sourceUrl: "https://musicbrainz.org/recording/example",
        confidence: "high",
      }],
      plan: {
        kind: "song_intro",
        transition: "full_break",
        announceTracks: [{ title: "Bloodbuzz Ohio", artist: "The National" }],
        maxDurationSeconds: 18,
        isSessionOpening: false,
      },
    });
    expect(pack.nuggets[0]?.sentence).toBe("Sufjan Stevens is credited on guitar.");
    expect(pack.nuggets[0]?.sentence).not.toMatch(/\bplays\b/);
  });
});

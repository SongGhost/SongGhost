import { describe, expect, it, vi } from "vitest";
import { TEACHING_TRUTH_RULE } from "@/lib/dj/legacyTeachingPrompt";
import type { AlbumContext } from "@/types/station";
import { resolveEarconSrc } from "@/lib/dj/earcon";
import { buildFactPack } from "../factPack";
import { composeNewBreak } from "../compose";
import { isMoodColorWithoutFact, scriptPassesGate, wordCount } from "../gate";
import { newBreakWantsEarcon } from "../playNewBreak";
import { buildNewWordsPrompt } from "../prompt";
import { resolveNewWordsFromBody } from "../handleRequest";
import { clearSpokenFacts, spokenFactIdsFor } from "../spokenFacts";
import { synthesizeNewBreak } from "../synthesize";
import type { FactPack } from "../types";

vi.mock("@/lib/itunes", () => ({
  lookupITunesTrack: vi.fn(async () => null),
}));

vi.mock("@/lib/catalog/musicbrainz", () => ({
  lookupMusicBrainzRecording: vi.fn(async () => null),
}));

const sleeve: AlbumContext = {
  albumTitle: "Rumours",
  artist: "Fleetwood Mac",
  releaseYear: 1977,
  producer: "Lindsey Buckingham",
  recordingStudio: "Record Plant",
  label: "Warner Bros",
  personnel: [],
  trackList: [{ position: 1, title: "Go Your Own Way" }],
};

function packFor(depth: FactPack["depth"], extra?: Parameters<typeof buildFactPack>[0]): FactPack {
  return buildFactPack({
    title: "Go Your Own Way",
    artist: "Fleetwood Mac",
    album: "Rumours",
    releaseYear: 1977,
    albumContext: sleeve,
    personaId: "standard-broadcast",
    depth,
    plan: {
      kind: "song_intro",
      transition: "full_break",
      announceTracks: [{ title: "Go Your Own Way", artist: "Fleetwood Mac", album: "Rumours" }],
      maxDurationSeconds: 12,
      isSessionOpening: false,
      styleRotationIndex: 0,
    },
    ...extra,
  });
}

describe("New fact pack", () => {
  it("keeps Standard on the names even when the sleeve is full", () => {
    const pack = packFor("standard");
    const spoken = composeNewBreak(pack, null);
    expect(pack.nuggets).toHaveLength(0);
    expect(spoken.script).not.toMatch(/1977/);
    expect(spoken.script).not.toContain("Rumours");
    expect(spoken.script).not.toContain("Lindsey");
    expect(spoken.script).toContain("Go Your Own Way");
    expect(spoken.script).not.toBe("Go Your Own Way by Fleetwood Mac.");
    expect(wordCount(spoken.script)).toBeLessThanOrEqual(32);
    expect(scriptPassesGate(spoken.script, pack)).toBe(true);
  });

  it("lets Roots use one nugget and Time Capsule three when three exist", () => {
    const rootsPack = packFor("roots_branches");
    const capsulePack = packFor("time_capsule");
    const roots = composeNewBreak(rootsPack, null).script;
    const capsule = composeNewBreak(capsulePack, null).script;
    expect(rootsPack.nuggets).toHaveLength(1);
    expect(capsulePack.maxNuggets).toBe(3);
    expect(capsulePack.nuggets).toHaveLength(3);
    expect(roots).toContain("1977");
    expect(roots).not.toContain("Rumours");
    expect(roots).not.toContain("Lindsey");
    expect(capsule).toContain("1977");
    expect(capsule).toContain("Rumours");
    expect(capsule).toContain("Lindsey");
    expect(capsule).not.toContain("Record Plant");
    expect(wordCount(capsule)).toBeGreaterThan(wordCount(roots));
  });

  it("keeps Time Capsule at the facts that exist when there are only two", () => {
    const pack = buildFactPack({
      title: "Go Your Own Way",
      artist: "Fleetwood Mac",
      album: "Rumours",
      releaseYear: 1977,
      depth: "time_capsule",
      personaId: "standard-broadcast",
      plan: {
        kind: "song_intro",
        transition: "full_break",
        announceTracks: [{ title: "Go Your Own Way", artist: "Fleetwood Mac", album: "Rumours" }],
        maxDurationSeconds: 12,
        isSessionOpening: false,
      },
    });
    const spoken = composeNewBreak(pack, null).script;
    expect(pack.nuggets).toHaveLength(2);
    expect(spoken).toContain("1977");
    expect(spoken).toContain("Rumours");
    expect(spoken).not.toContain("Lindsey");
  });

  it("lets Director's Cut use the sleeve, and stays short when the pack is thin", () => {
    const rich = composeNewBreak(packFor("directors_cut"), null).script;
    expect(rich).toContain("1977");
    expect(rich).toContain("Lindsey Buckingham");
    expect(rich).toContain("Record Plant");

    const thin = buildFactPack({
      title: "Go Your Own Way",
      artist: "Fleetwood Mac",
      personaId: "standard-broadcast",
      depth: "directors_cut",
      plan: {
        kind: "artist_trivia",
        transition: "full_break",
        announceTracks: [{ title: "Go Your Own Way", artist: "Fleetwood Mac" }],
        maxDurationSeconds: 20,
        isSessionOpening: false,
      },
    });
    const spoken = composeNewBreak(thin, null).script;
    expect(thin.nuggets).toHaveLength(0);
    expect(spoken).not.toMatch(/\b(?:19|20)\d{2}\b/);
    expect(spoken).not.toBe("Go Your Own Way by Fleetwood Mac.");
    expect(wordCount(spoken)).toBeLessThanOrEqual(32);
    expect(wordCount(spoken)).toBeLessThan(wordCount(rich));
  });

  it("does not treat genre or era tags as a fact break", () => {
    const pack = buildFactPack({
      title: "1979",
      artist: "The Smashing Pumpkins",
      depth: "directors_cut",
      eraTag: "90s",
      genreTag: "alternative rock",
      catalogNote: "Listed as Alternative.",
      personaId: "standard-broadcast",
      plan: {
        kind: "artist_trivia",
        transition: "full_break",
        announceTracks: [{ title: "1979", artist: "The Smashing Pumpkins" }],
        maxDurationSeconds: 20,
        isSessionOpening: false,
        styleRotationIndex: 1,
      },
    });
    const spoken = composeNewBreak(
      pack,
      "It is filed under the 90s. It is filed under alternative rock. 1979 by The Smashing Pumpkins.",
    );
    expect(pack.nuggets).toHaveLength(0);
    expect(spoken.script.toLowerCase()).not.toContain("filed under");
    expect(spoken.script.toLowerCase()).not.toContain("alternative");
    expect(spoken.script).not.toBe("1979 by The Smashing Pumpkins.");
    expect(spoken.usedNuggetIds).toEqual([]);
  });

  it("keeps song 1 on the station welcome even when a fact pack was supplied", () => {
    const pack = buildFactPack({
      title: "Come As You Are",
      artist: "Nirvana",
      album: "Nevermind",
      releaseYear: 1991,
      stationName: "SongHost",
      depth: "directors_cut",
      personaId: "standard-broadcast",
      plan: {
        kind: "artist_trivia",
        transition: "full_break",
        announceTracks: [{ title: "Come As You Are", artist: "Nirvana", album: "Nevermind" }],
        maxDurationSeconds: 20,
        isSessionOpening: true,
      },
    });
    const spoken = composeNewBreak(
      pack,
      "Come As You Are by Nirvana, a deep cut from the 1991 album Nevermind.",
    );
    expect(pack.sessionOpening).toBe(true);
    expect(pack.nuggets).toHaveLength(0);
    expect(spoken.script).toContain("SongHost");
    expect(spoken.script).toContain("Come As You Are");
    expect(spoken.script).not.toContain("Nevermind");
    expect(spoken.script).not.toMatch(/\b1991\b/);
    expect(spoken.usedNuggetIds).toEqual([]);
  });

  it("drops an invented proper noun and keeps the true draft", () => {
    const pack = packFor("roots_branches");
    const safe = composeNewBreak(pack, null);
    const rejected = composeNewBreak(
      pack,
      "Quincy Jones cut this at Abbey Road in 1888.",
    );
    expect(rejected.fellBack).toBe(true);
    expect(rejected.script).toBe(safe.script);
    expect(rejected.script).not.toContain("Quincy");
    expect(rejected.script).not.toContain("Abbey");
    expect(rejected.script).not.toContain("1888");
  });

  it("rotates shape and colors the persona without new facts", () => {
    const namesFirst = composeNewBreak(packFor("roots_branches"), null).script;
    const factFirst = composeNewBreak(
      packFor("roots_branches", {
        plan: {
          kind: "song_intro",
          transition: "full_break",
          announceTracks: [{ title: "Go Your Own Way", artist: "Fleetwood Mac", album: "Rumours" }],
          maxDurationSeconds: 12,
          isSessionOpening: false,
          styleRotationIndex: 1,
        },
      }),
      null,
    ).script;
    expect(namesFirst.indexOf("by Fleetwood Mac")).toBeLessThan(namesFirst.indexOf("1977"));
    expect(factFirst.indexOf("1977")).toBeLessThan(factFirst.indexOf("by Fleetwood Mac"));

    const critic = composeNewBreak(
      packFor("roots_branches", { personaId: "sarcastic-critic" }),
      null,
    ).script;
    expect(critic).not.toMatch(/Worth your ear|Listen for this|Hold onto this/);
    expect(critic).not.toContain("Quincy");

    const guidePrompt = buildNewWordsPrompt(
      packFor("roots_branches", { personaId: "warm-companion" }),
      critic,
    );
    const criticPrompt = buildNewWordsPrompt(
      packFor("roots_branches", { personaId: "sarcastic-critic" }),
      critic,
    );
    expect(guidePrompt.system).not.toBe(criticPrompt.system);
    expect(guidePrompt.system).toMatch(/Guide/);
    expect(criticPrompt.system).toMatch(/Critic/);
    expect(`${guidePrompt.system}\n${criticPrompt.system}`).not.toMatch(
      /Worth your ear|Listen for this|Hold onto this/,
    );
  });

  it("makes Song 1 to Song 2 one catch-up that names both songs", () => {
    const pack = buildFactPack({
      title: "Dreams",
      artist: "Fleetwood Mac",
      depth: "standard",
      personaId: "standard-broadcast",
      previous: { title: "Go Your Own Way", artist: "Fleetwood Mac" },
      plan: {
        kind: "up_next",
        transition: "full_break",
        announceTracks: [{ title: "Dreams", artist: "Fleetwood Mac" }],
        recapTracks: [{ title: "Go Your Own Way", artist: "Fleetwood Mac" }],
        maxDurationSeconds: 12,
        isFirstPlaylistPack: true,
      },
    });
    const script = composeNewBreak(pack, null).script;
    expect(pack.shape).toBe("catchup");
    expect(script).toContain("That was");
    expect(script).toContain("Go Your Own Way");
    expect(script).toContain("Dreams");
    expect(script).not.toMatch(/1977/);
  });

  it("uses a lookup year only after the row and the sleeve", () => {
    const fromLookup = buildFactPack({
      title: "Go Your Own Way",
      artist: "Fleetwood Mac",
      depth: "directors_cut",
      lookupYear: 1977,
      lookupAlbum: "Rumours",
      catalogNote: "Listed as Rock.",
      personaId: "standard-broadcast",
      plan: {
        kind: "song_intro",
        transition: "full_break",
        announceTracks: [{ title: "Go Your Own Way", artist: "Fleetwood Mac" }],
        maxDurationSeconds: 12,
        isSessionOpening: false,
      },
    });
    expect(fromLookup.nuggets.map((nugget) => nugget.id)).toEqual(["year", "album"]);
    expect(fromLookup.nuggets.some((nugget) => /listed as|filed under/i.test(nugget.sentence))).toBe(
      false,
    );

    const sleeveWins = buildFactPack({
      title: "Go Your Own Way",
      artist: "Fleetwood Mac",
      album: "Rumours",
      releaseYear: 1977,
      albumContext: sleeve,
      depth: "roots_branches",
      lookupYear: 1999,
      lookupAlbum: "Tusk",
      personaId: "standard-broadcast",
      plan: {
        kind: "song_intro",
        transition: "full_break",
        announceTracks: [{ title: "Go Your Own Way", artist: "Fleetwood Mac", album: "Rumours" }],
        maxDurationSeconds: 12,
        isSessionOpening: false,
      },
    });
    expect(sleeveWins.nuggets[0]?.sentence).toContain("1977");
    expect(sleeveWins.nuggets[0]?.sentence).not.toContain("1999");
    expect(sleeveWins.nuggets.some((nugget) => nugget.sentence.includes("Tusk"))).toBe(false);
  });

  it("puts the station name in the same speech when the scheduler asked for a sweeper", () => {
    const pack = packFor("standard", {
      stationName: "Night Owl",
      plan: {
        kind: "song_intro",
        transition: "full_break",
        announceTracks: [{ title: "Go Your Own Way", artist: "Fleetwood Mac" }],
        maxDurationSeconds: 8,
        isSessionOpening: false,
        includeStinger: true,
      },
    });
    expect(composeNewBreak(pack, null).script).toContain("Night Owl");
  });

  it("keeps a true rephrase and rejects a second Roots nugget", () => {
    const pack = packFor("roots_branches");
    const draft = composeNewBreak(pack, null).script;
    const rewrite = "You're about to hear Go Your Own Way by Fleetwood Mac, out in 1977.";
    expect(rewrite).not.toBe(draft);
    expect(scriptPassesGate(rewrite, pack)).toBe(true);
    const spoken = composeNewBreak(pack, rewrite);
    expect(spoken.fellBack).toBe(false);
    expect(spoken.script).toBe(rewrite);

    const overrun = "Go Your Own Way by Fleetwood Mac came out in 1977. It is on Rumours.";
    expect(scriptPassesGate(overrun, pack)).toBe(false);
    expect(composeNewBreak(pack, overrun).script).not.toContain("Rumours");
    expect(pack.nuggets).toHaveLength(1);
  });

  it("rejects an up-next line that names a different song", () => {
    const pack = buildFactPack({
      title: "Dreams",
      artist: "Fleetwood Mac",
      depth: "standard",
      personaId: "standard-broadcast",
      previous: { title: "Go Your Own Way", artist: "Fleetwood Mac" },
      plan: {
        kind: "up_next",
        transition: "full_break",
        announceTracks: [{ title: "Dreams", artist: "Fleetwood Mac" }],
        recapTracks: [{ title: "Go Your Own Way", artist: "Fleetwood Mac" }],
        maxDurationSeconds: 12,
        isFirstPlaylistPack: true,
      },
    });
    const wrong = "That was Dreams by Fleetwood Mac. Up next, Go Your Own Way by Fleetwood Mac.";
    expect(scriptPassesGate(wrong, pack)).toBe(false);
    const right = "That was Go Your Own Way by Fleetwood Mac. Up next, Dreams by Fleetwood Mac.";
    expect(scriptPassesGate(right, pack)).toBe(true);
    expect(composeNewBreak(pack, wrong).script).toContain("Up next");
    expect(composeNewBreak(pack, wrong).script.toLowerCase()).toContain("dreams");
    expect(composeNewBreak(pack, wrong).script.toLowerCase().split("up next")[1]).toContain("dreams");
  });

  it("includes a player credit on Director's Cut when the sleeve lists one", () => {
    const pack = buildFactPack({
      title: "Go Your Own Way",
      artist: "Fleetwood Mac",
      album: "Rumours",
      releaseYear: 1977,
      depth: "directors_cut",
      personaId: "standard-broadcast",
      albumContext: {
        ...sleeve,
        personnel: [{ name: "John McVie", role: "bass" }],
      },
      plan: {
        kind: "artist_trivia",
        transition: "full_break",
        announceTracks: [{ title: "Go Your Own Way", artist: "Fleetwood Mac", album: "Rumours" }],
        maxDurationSeconds: 20,
        isSessionOpening: false,
      },
    });
    expect(pack.nuggets.some((nugget) => nugget.id === "credit:john-mcvie")).toBe(true);
    const spoken = composeNewBreak(pack, null).script;
    expect(spoken).toContain("John McVie");
    expect(spoken.toLowerCase()).toContain("bass");

    const yearAndAlbum = "Go Your Own Way by Fleetwood Mac came out in 1977. It is on Rumours.";
    expect(composeNewBreak(pack, yearAndAlbum).script).toContain("John McVie");

    const rephrase = "Go Your Own Way by Fleetwood Mac. John McVie is credited on bass, from the 1977 album Rumours.";
    expect(scriptPassesGate(rephrase, pack)).toBe(true);
    expect(composeNewBreak(pack, rephrase).script).toBe(rephrase);
  });

  it("does not repeat a spoken fact while another unused fact is waiting", () => {
    const first = packFor("roots_branches");
    expect(first.nuggets.map((nugget) => nugget.id)).toEqual(["year"]);
    const second = packFor("roots_branches", { spokenFactIds: ["year"] });
    expect(second.nuggets.map((nugget) => nugget.id)).toEqual(["album"]);
    expect(composeNewBreak(second, null).script).not.toContain("1977");
    expect(composeNewBreak(second, null).script).toContain("Rumours");

    const capsule = packFor("time_capsule");
    const used = capsule.nuggets.map((nugget) => nugget.id);
    const next = packFor("time_capsule", { spokenFactIds: used });
    expect(next.nuggets.map((nugget) => nugget.id)).not.toEqual(used);
    expect(next.nuggets.some((nugget) => nugget.id === "studio")).toBe(true);
    expect(next.nuggets[0]?.id).not.toBe("year");
  });

  it("rejects the canned title line when the pack is empty and keeps a human one", () => {
    const pack = buildFactPack({
      title: "Go Your Own Way",
      artist: "Fleetwood Mac",
      depth: "standard",
      personaId: "standard-broadcast",
      plan: {
        kind: "song_intro",
        transition: "full_break",
        announceTracks: [{ title: "Go Your Own Way", artist: "Fleetwood Mac" }],
        maxDurationSeconds: 12,
        isSessionOpening: false,
      },
    });
    const canned = "Go Your Own Way by Fleetwood Mac.";
    expect(pack.nuggets).toHaveLength(0);
    expect(scriptPassesGate(canned, pack)).toBe(false);
    expect(scriptPassesGate("This one is Go Your Own Way, from Fleetwood Mac.", pack)).toBe(true);
    const spoken = composeNewBreak(pack, canned);
    expect(spoken.script).not.toBe(canned);
    expect(spoken.script).toContain("Go Your Own Way");
    expect(spoken.fellBack).toBe(true);
  });

  it("rejects a Director's Cut line that uses none of a real fact pack", () => {
    const vibes = "That was Would? by Alice in Chains. Now, let's dive into the soaring sounds of Tonight, Tonight by The Smashing Pumpkins.";
    for (const depth of ["roots_branches", "time_capsule", "directors_cut"] as const) {
      const pack = packFor(depth);
      expect(pack.nuggets.length).toBeGreaterThan(0);
      expect(isMoodColorWithoutFact(vibes.replace("Tonight, Tonight by The Smashing Pumpkins", "Go Your Own Way by Fleetwood Mac"), pack)).toBe(true);
      expect(scriptPassesGate(
        "Up next, Go Your Own Way by Fleetwood Mac. Let's dive into the soaring essence of it.",
        pack,
      )).toBe(false);
      const spoken = composeNewBreak(
        pack,
        "Up next, Go Your Own Way by Fleetwood Mac. Let's dive into the soaring essence of it.",
      );
      expect(spoken.usedNuggetIds.length).toBeGreaterThan(0);
      expect(spoken.script).toMatch(/1977|Rumours|Lindsey|Record Plant/);
      expect(spoken.script.toLowerCase()).not.toMatch(/soaring|dive into|essence of/);
    }
    expect(vibes.toLowerCase()).toMatch(/soaring|dive into/);
  });

  it("does not treat a soaring dive-into line as a fact break or a lore chime", () => {
    const pack = buildFactPack({
      title: "Tonight, Tonight",
      artist: "The Smashing Pumpkins",
      depth: "directors_cut",
      personaId: "standard-broadcast",
      previous: { title: "Would?", artist: "Alice in Chains" },
      plan: {
        kind: "song_intro",
        transition: "full_break",
        announceTracks: [{ title: "Tonight, Tonight", artist: "The Smashing Pumpkins" }],
        recapTracks: [{ title: "Would?", artist: "Alice in Chains" }],
        maxDurationSeconds: 20,
        isSessionOpening: false,
        isFirstPlaylistPack: true,
      },
    });
    const vibes = 'That was "Would?" by Alice in Chains. Now, let\'s dive into the soaring sounds of "Tonight, Tonight" by The Smashing Pumpkins.';
    expect(pack.nuggets).toHaveLength(0);
    expect(scriptPassesGate(vibes, pack)).toBe(false);
    expect(isMoodColorWithoutFact(vibes, pack)).toBe(true);
    const spoken = composeNewBreak(pack, vibes);
    expect(spoken.script).not.toBe("Tonight, Tonight by The Smashing Pumpkins.");
    expect(spoken.script.toLowerCase()).not.toMatch(/soaring|dive into|essence of/);
    expect(spoken.script).toContain("Tonight, Tonight");
    expect(spoken.script).toContain("The Smashing Pumpkins");
    expect(spoken.usedNuggetIds).toEqual([]);
    const earcon = resolveEarconSrc({
      kind: "song_intro",
      isSessionOpening: false,
    });
    expect(newBreakWantsEarcon(earcon, spoken.usedNuggetIds.length > 0, spoken.script)).toBe(false);
    expect(newBreakWantsEarcon(earcon, true, vibes)).toBe(false);
  });

  it("keeps grounded color when it is wrapped around a sourced fact", () => {
    const pack = buildFactPack({
      title: "Come As You Are",
      artist: "Nirvana",
      album: "Nevermind",
      releaseYear: 1991,
      depth: "directors_cut",
      personaId: "standard-broadcast",
      plan: {
        kind: "artist_trivia",
        transition: "full_break",
        announceTracks: [{ title: "Come As You Are", artist: "Nirvana", album: "Nevermind" }],
        maxDurationSeconds: 20,
        isSessionOpening: false,
      },
    });
    const line = "Up next, Come As You Are by Nirvana, from the 1991 album Nevermind.";
    expect(scriptPassesGate(line, pack)).toBe(true);
    expect(composeNewBreak(pack, line).usedNuggetIds.length).toBeGreaterThan(0);
    const earcon = resolveEarconSrc({ kind: "artist_trivia", isSessionOpening: false });
    expect(newBreakWantsEarcon(earcon, true, line)).toBe(true);
  });

  it("does not recover the canned title line when a Director's Cut pack is empty", () => {
    const pack = buildFactPack({
      title: "Tonight, Tonight",
      artist: "The Smashing Pumpkins",
      depth: "directors_cut",
      personaId: "standard-broadcast",
      plan: {
        kind: "artist_trivia",
        transition: "full_break",
        announceTracks: [{ title: "Tonight, Tonight", artist: "The Smashing Pumpkins" }],
        maxDurationSeconds: 20,
        isSessionOpening: false,
      },
    });
    const canned = "Tonight, Tonight by The Smashing Pumpkins.";
    expect(pack.nuggets).toHaveLength(0);
    expect(scriptPassesGate(canned, pack)).toBe(false);
    const spoken = composeNewBreak(pack, canned);
    expect(spoken.script).not.toBe(canned);
    expect(spoken.script).toContain("Tonight, Tonight");
    expect(spoken.script).toContain("The Smashing Pumpkins");
    expect(spoken.usedNuggetIds).toEqual([]);
  });

  it("does not treat the old persona tags as the voice", () => {
    const pack = packFor("roots_branches", { personaId: "sarcastic-critic" });
    expect(scriptPassesGate("Go Your Own Way by Fleetwood Mac. Worth your ear.", pack)).toBe(false);
    expect(scriptPassesGate("Listen for this. Go Your Own Way by Fleetwood Mac.", pack)).toBe(false);
    expect(scriptPassesGate("Hold onto this. Go Your Own Way by Fleetwood Mac.", pack)).toBe(false);
  });
});

describe("New prompt", () => {
  it("forbids new proper nouns and does not use the Classic teaching contract", () => {
    const pack = packFor("directors_cut");
    const draft = composeNewBreak(pack, null).script;
    const prompt = buildNewWordsPrompt(pack, draft);
    const text = `${prompt.system}\n${prompt.user}`;
    expect(text.toLowerCase()).toContain("proper noun");
    expect(text).toContain(draft);
    expect(text).not.toContain(TEACHING_TRUTH_RULE.trim());
    expect(text).not.toContain("PERSONA JOB");
    expect(text).not.toMatch(/at most two/i);
  });
});

describe("resolveNewWordsFromBody", () => {
  it("keeps a free listener on a short true line even if Director's Cut was stored", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    try {
      const result = await resolveNewWordsFromBody(
        {
          songTitle: "Go Your Own Way",
          artistName: "Fleetwood Mac",
          releaseYear: 1977,
          commentaryFormat: "directors_cut",
          hostId: "sarcastic-critic",
          segmentPlan: {
            kind: "song_intro",
            transition: "full_break",
            announceTracks: [{ title: "Go Your Own Way", artist: "Fleetwood Mac" }],
            maxDurationSeconds: 12,
            isSessionOpening: false,
          },
        },
        "free",
      );
      expect(result.status).toBe(200);
      expect(result.script).toContain("Go Your Own Way");
      expect(result.script).not.toMatch(/1977/);
      expect(result.script).not.toContain("Worth your ear");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("asks the writer on an empty Director's Cut pack and does not air the bare template", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              script: "Fleetwood Mac. The song is Go Your Own Way.",
            }),
          },
        }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await resolveNewWordsFromBody(
        {
          songTitle: "Go Your Own Way",
          artistName: "Fleetwood Mac",
          commentaryFormat: "directors_cut",
          hostId: "the-musicologist",
          segmentPlan: {
            kind: "artist_trivia",
            transition: "full_break",
            announceTracks: [{ title: "Go Your Own Way", artist: "Fleetwood Mac" }],
            maxDurationSeconds: 20,
            isSessionOpening: false,
          },
        },
        "pro",
      );
      expect(fetchMock).toHaveBeenCalled();
      const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1] && (fetchMock.mock.calls[0][1] as { body?: string }).body));
      const system = String(request.messages[0].content);
      const user = String(request.messages[1].content);
      expect(user).toContain("Upcoming title: Go Your Own Way");
      expect(system).toMatch(/Archivist/);
      expect(system).not.toMatch(/Worth your ear|Listen for this|Hold onto this/);
      expect(result.status).toBe(200);
      expect(result.script).toBe("Fleetwood Mac. The song is Go Your Own Way.");
      expect(result.script).not.toBe("Go Your Own Way by Fleetwood Mac.");
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("skips a fact already spoken for this song when another fact is unused", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    try {
      const result = await resolveNewWordsFromBody(
        {
          songTitle: "Go Your Own Way",
          artistName: "Fleetwood Mac",
          album: "Rumours",
          releaseYear: 1977,
          commentaryFormat: "roots_branches",
          albumContext: sleeve,
          spokenFactIds: ["year"],
          segmentPlan: {
            kind: "song_intro",
            transition: "full_break",
            announceTracks: [{ title: "Go Your Own Way", artist: "Fleetwood Mac", album: "Rumours" }],
            maxDurationSeconds: 12,
            isSessionOpening: false,
          },
        },
        "pro",
      );
      expect(result.status).toBe(200);
      expect(result.script).not.toContain("1977");
      expect(result.script).toContain("Rumours");
      expect(result.usedFactIds).toContain("album");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("does not speak genre or era tags when that is all the row has", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    try {
      const result = await resolveNewWordsFromBody(
        {
          songTitle: "1979",
          artistName: "The Smashing Pumpkins",
          commentaryFormat: "directors_cut",
          eraTag: "90s",
          genreTag: "alternative rock",
          catalogNote: "Listed as Alternative.",
          segmentPlan: {
            kind: "artist_trivia",
            transition: "full_break",
            announceTracks: [{ title: "1979", artist: "The Smashing Pumpkins" }],
            maxDurationSeconds: 20,
            isSessionOpening: false,
            styleRotationIndex: 1,
          },
        },
        "pro",
      );
      expect(result.status).toBe(200);
      expect(result.script?.toLowerCase()).not.toContain("filed under");
      expect(result.script?.toLowerCase()).not.toContain("alternative");
      expect(result.script?.toLowerCase()).not.toContain("90s");
      expect(result.script).not.toBe("1979 by The Smashing Pumpkins.");
      expect(result.usedFactIds).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("uses the station welcome for song 1 instead of a Director's Cut", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await resolveNewWordsFromBody(
        {
          songTitle: "Come As You Are",
          artistName: "Nirvana",
          album: "Nevermind",
          releaseYear: 1991,
          stationName: "SongHost",
          commentaryFormat: "directors_cut",
          segmentPlan: {
            kind: "artist_trivia",
            transition: "full_break",
            announceTracks: [{ title: "Come As You Are", artist: "Nirvana", album: "Nevermind" }],
            maxDurationSeconds: 20,
            isSessionOpening: true,
          },
        },
        "pro",
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.status).toBe(200);
      expect(result.script).toContain("SongHost");
      expect(result.script).toContain("Come As You Are");
      expect(result.script).toContain("Nirvana");
      expect(result.script).not.toContain("Nevermind");
      expect(result.script).not.toMatch(/\b1991\b/);
      expect(result.usedFactIds).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});

describe("session fact memory", () => {
  it("remembers aired facts and sends them on the next break for that song", async () => {
    clearSpokenFacts();
    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("generate-script")) {
        bodies.push(String(init?.body ?? ""));
        return {
          ok: true,
          json: async () => ({
            script: "This one is Go Your Own Way, from Fleetwood Mac.",
            usedFactIds: ["year"],
          }),
        };
      }
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(4),
        headers: { get: () => "audio/mpeg" },
      };
    }));
    try {
      await synthesizeNewBreak({
        songTitle: "Go Your Own Way",
        artistName: "Fleetwood Mac",
      });
      expect(spokenFactIdsFor("Fleetwood Mac", "Go Your Own Way")).toEqual(["year"]);
      await synthesizeNewBreak({
        songTitle: "Go Your Own Way",
        artistName: "Fleetwood Mac",
      });
      const second = JSON.parse(bodies[1] ?? "{}") as { spokenFactIds?: string[] };
      expect(second.spokenFactIds).toContain("year");
    } finally {
      clearSpokenFacts();
      vi.unstubAllGlobals();
    }
  });
});

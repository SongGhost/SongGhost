import { afterEach, describe, expect, it, vi } from "vitest";
import { TEACHING_TRUTH_RULE } from "@/lib/dj/legacyTeachingPrompt";
import type { AlbumContext } from "@/types/station";
import { resolveEarconSrc } from "@/lib/dj/earcon";
import { buildFactPack } from "../factPack";
import { composeNewBreak } from "../compose";
import { hasSoftClaimAbsentFromPack, isCreditRoll, isMoodColorWithoutFact, scriptPassesGate, wordCount } from "../gate";
import {
  DIRECTORS_CUT_WRITER_MODEL,
  NEW_WORDS_MAX_TOKENS,
  SHEET_GAP_WAIT_MS,
  SHEET_WARM_WAIT_MS,
  newWordsWriterModel,
  sheetWaitMs,
} from "../handleRequest";
import { loadBreakSheet } from "../sheet";
import { newBreakWantsEarcon } from "../playNewBreak";
import { buildNewWordsPrompt, exampleBreak, spokenSkeleton } from "../prompt";
import { resolveNewWordsFromBody } from "../handleRequest";
import { clearSpokenFacts, spokenFactIdsFor } from "../spokenFacts";
import { clearStationMemory } from "../stationMemory";
import { synthesizeNewBreak } from "../synthesize";
import type { FactPack } from "../types";

vi.mock("../sheet", () => ({
  loadBreakSheet: vi.fn(async () => ({
    claims: [],
    nextClaims: [],
    sources: [],
  })),
}));

afterEach(() => {
  vi.mocked(loadBreakSheet).mockReset();
  vi.mocked(loadBreakSheet).mockImplementation(async () => ({
    claims: [],
    nextClaims: [],
    sources: [],
  }));
  vi.useRealTimers();
});

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

  it("lets Roots and Time Capsule each teach one fact", () => {
    const rootsPack = packFor("roots_branches");
    const capsulePack = packFor("time_capsule");
    const roots = composeNewBreak(rootsPack, null).script;
    const capsule = composeNewBreak(capsulePack, null).script;
    expect(rootsPack.nuggets).toHaveLength(1);
    expect(rootsPack.nuggets[0]?.id).toBe("studio");
    expect(capsulePack.maxNuggets).toBe(1);
    expect(capsulePack.nuggets.map((nugget) => nugget.id)).toEqual(["studio"]);
    expect(roots).toContain("Record Plant");
    expect(roots).not.toContain("1977");
    expect(capsule).toContain("Record Plant");
    expect(capsule).not.toMatch(/track \d/);
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
    expect(pack.nuggets.map((nugget) => nugget.id)).toEqual(["year"]);
    expect(spoken).toContain("1977");
    expect(spoken).not.toContain("Lindsey");
  });

  it("lets Director's Cut use the sleeve, and stays short when the pack is thin", () => {
    const richPack = packFor("directors_cut");
    const rich = composeNewBreak(richPack, null).script;
    expect(richPack.maxNuggets).toBe(2);
    expect(richPack.nuggets.length).toBeLessThanOrEqual(2);
    expect(richPack.nuggets.some((nugget) => nugget.sentence.includes("Record Plant"))).toBe(true);
    expect(rich).toContain("Record Plant");
    expect(rich).not.toContain("Lindsey Buckingham");
    expect(rich).not.toMatch(/track \d/);

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
    expect(namesFirst).toContain("Record Plant");
    expect(factFirst).toContain("Record Plant");
    expect(namesFirst).not.toContain("1977");
    expect(factFirst).not.toContain("1977");

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
    expect(fromLookup.nuggets.map((nugget) => nugget.id)).toEqual(["year"]);
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
    expect(JSON.stringify(sleeveWins.sheet)).toContain("1977");
    expect(JSON.stringify(sleeveWins)).not.toContain("1999");
    expect(sleeveWins.nuggets.some((nugget) => nugget.sentence.includes("Tusk"))).toBe(false);
    expect(sleeveWins.nuggets[0]?.id).toBe("studio");
  });

  it("does not read a station label onto a fact break", () => {
    const pack = packFor("standard", {
      stationName: "Artist Radio: The National",
      plan: {
        kind: "song_intro",
        transition: "full_break",
        announceTracks: [{ title: "Go Your Own Way", artist: "Fleetwood Mac" }],
        maxDurationSeconds: 8,
        isSessionOpening: false,
        includeStinger: true,
      },
    });
    const script = composeNewBreak(pack, null).script;
    expect(script).not.toContain("Artist Radio");
    expect(script).not.toContain("Night Owl");
    expect(script).toContain("Go Your Own Way");
  });

  it("keeps a true rephrase and rejects a second Roots nugget", () => {
    const pack = packFor("roots_branches");
    const draft = composeNewBreak(pack, null).script;
    const rewrite = "Lindsey Buckingham produced Go Your Own Way. That choice is the fact. Up next, Go Your Own Way by Fleetwood Mac.";
    expect(rewrite).not.toBe(draft);
    expect(pack.nuggets).toHaveLength(1);
    expect(pack.nuggets[0]?.id).toBe("studio");
    const overrun = "Go Your Own Way by Fleetwood Mac came out in 1977. It is on Rumours.";
    expect(scriptPassesGate(overrun, pack)).toBe(false);
    expect(composeNewBreak(pack, overrun).script).toContain("Record Plant");
    expect(composeNewBreak(pack, overrun).script).not.toContain("Rumours");
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
    expect(pack.nuggets.some((nugget) => nugget.sentence.includes("Record Plant"))).toBe(true);
    expect(pack.nuggets.some((nugget) => nugget.id === "credit:john-mcvie")).toBe(false);
    const spoken = composeNewBreak(pack, null).script;
    expect(spoken).toContain("Record Plant");
    expect(spoken).not.toContain("John McVie");

    const yearAndAlbum = "Go Your Own Way by Fleetwood Mac came out in 1977. It is on Rumours.";
    expect(composeNewBreak(pack, yearAndAlbum).script).toContain("Record Plant");

    const rephrase = "Go Your Own Way by Fleetwood Mac came out in 1977. It is on Rumours.";
    expect(scriptPassesGate(rephrase, pack)).toBe(false);
    expect(composeNewBreak(pack, rephrase).script).toContain("Record Plant");
  });

  it("does not repeat a spoken fact while another unused fact is waiting", () => {
    const first = packFor("roots_branches");
    expect(first.nuggets.map((nugget) => nugget.id)).toEqual(["studio"]);
    const second = packFor("roots_branches", { spokenFactIds: ["studio"] });
    expect(second.nuggets[0]?.id).toBe("producer");
    expect(composeNewBreak(second, null).script).toContain("Lindsey");
    expect(composeNewBreak(second, null).script).not.toContain("Record Plant");

    const capsule = packFor("time_capsule");
    const used = capsule.nuggets.map((nugget) => nugget.id);
    const next = packFor("time_capsule", { spokenFactIds: used });
    expect(used).toEqual(["studio"]);
    expect(next.nuggets.map((nugget) => nugget.id)).not.toEqual(used);
    expect(next.nuggets.every((nugget) => !used.includes(nugget.id))).toBe(true);
    expect(next.nuggets[0]?.id).toBe("producer");
    expect(next.nuggets[0]?.topic).not.toBe("release");
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

  it("says That was only on the song-1 exit, and only Director's Cut may add one past fact", () => {
    const exitPlan = (
      depth: FactPack["depth"],
      firstExit: boolean,
    ) => buildFactPack({
      title: "Dreams",
      artist: "Fleetwood Mac",
      depth,
      personaId: "standard-broadcast",
      previous: { title: "Go Your Own Way", artist: "Fleetwood Mac", album: "Rumours" },
      plan: {
        kind: "up_next",
        transition: "full_break",
        announceTracks: [{ title: "Dreams", artist: "Fleetwood Mac" }],
        recapTracks: [{ title: "Go Your Own Way", artist: "Fleetwood Mac", album: "Rumours" }],
        maxDurationSeconds: 12,
        isSessionOpening: false,
        isFirstPlaylistPack: firstExit,
        styleRotationIndex: 2,
      },
    });

    const first = exitPlan("standard", true);
    const firstLine = composeNewBreak(first, null).script;
    expect(first.songOneExit).toBe(true);
    expect(firstLine).toMatch(/That was/);
    expect(firstLine).toContain("Go Your Own Way");
    expect(firstLine).toContain("Dreams");
    expect(firstLine).not.toContain("Rumours");

    for (const depth of ["roots_branches", "time_capsule"] as const) {
      const pack = exitPlan(depth, true);
      const script = composeNewBreak(pack, null).script;
      expect(pack.pastNugget).toBeUndefined();
      expect(script).toMatch(/That was/);
      expect(script).not.toContain("Rumours");
      expect(scriptPassesGate(
        'That was Go Your Own Way by Fleetwood Mac. Go Your Own Way is on Rumours. Up next, Dreams by Fleetwood Mac.',
        pack,
      )).toBe(false);
    }

    const directors = exitPlan("directors_cut", true);
    const directorsLine = composeNewBreak(directors, null).script;
    expect(directors.pastNugget?.sentence).toBe("Go Your Own Way is on Rumours.");
    expect(directorsLine).toMatch(/^That was /);
    expect(directorsLine.indexOf("Rumours")).toBeGreaterThan(-1);
    expect(directorsLine.indexOf("Rumours")).toBeLessThan(directorsLine.toLowerCase().indexOf("up next"));
    expect(directorsLine).toContain("Dreams");

    const later = exitPlan("directors_cut", false);
    const laterLine = composeNewBreak(later, null).script;
    const laterThatWas = "That was Go Your Own Way by Fleetwood Mac. Up next, Dreams by Fleetwood Mac.";
    expect(later.songOneExit).toBe(false);
    expect(later.previous).toBeUndefined();
    expect(later.pastNugget).toBeUndefined();
    expect(laterLine).not.toMatch(/That was/i);
    expect(laterLine).not.toMatch(/you just heard/i);
    expect(laterLine).not.toContain("Go Your Own Way");
    expect(scriptPassesGate(laterThatWas, later)).toBe(false);
    expect(composeNewBreak(later, laterThatWas).script).not.toMatch(/That was/i);

    const welcome = buildFactPack({
      title: "Dreams",
      artist: "Fleetwood Mac",
      stationName: "Night Owl",
      plan: {
        kind: "song_intro",
        transition: "full_break",
        announceTracks: [{ title: "Dreams", artist: "Fleetwood Mac" }],
        maxDurationSeconds: 8,
        isSessionOpening: true,
      },
    });
    expect(welcome.songOneExit).toBe(false);
    expect(composeNewBreak(welcome, null).script).not.toMatch(/That was/i);

    const firstPrompt = buildNewWordsPrompt(first, firstLine);
    const directorsPrompt = buildNewWordsPrompt(directors, directorsLine);
    const laterPrompt = buildNewWordsPrompt(later, laterLine);
    expect(firstPrompt.system).toContain('You may open with "That was"');
    expect(firstPrompt.system).toContain("Do not add a fact about the finished song");
    expect(directorsPrompt.system).toContain('Open with "That was"');
    expect(directorsPrompt.system).toContain("Go Your Own Way is on Rumours.");
    expect(directorsPrompt.system).toContain("Do not add a second fact about the finished song");
    expect(laterPrompt.system).toContain('Do not open with "That was" or "You just heard"');
    expect(laterPrompt.system).not.toContain("Rumours");
  });

  it("does not treat the old persona tags as the voice", () => {
    const pack = packFor("roots_branches", { personaId: "sarcastic-critic" });
    expect(scriptPassesGate("Go Your Own Way by Fleetwood Mac. Worth your ear.", pack)).toBe(false);
    expect(scriptPassesGate("Listen for this. Go Your Own Way by Fleetwood Mac.", pack)).toBe(false);
    expect(scriptPassesGate("Hold onto this. Go Your Own Way by Fleetwood Mac.", pack)).toBe(false);
  });

  it("gives each persona a different posture on the same song and fact pack", () => {
    const draft = composeNewBreak(packFor("roots_branches"), null).script;
    const ids = [
      "warm-companion",
      "sarcastic-critic",
      "the-musicologist",
      "standard-broadcast",
    ] as const;
    const systems = ids.map(
      (personaId) => buildNewWordsPrompt(packFor("roots_branches", { personaId }), draft).system,
    );
    const postures = systems.map((system) => system.match(/Posture: [^.]+\./)?.[0] ?? "");

    expect(postures).toEqual([
      "Posture: invitation.",
      "Posture: taste.",
      "Posture: catalog.",
      "Posture: handoff.",
    ]);
    expect(new Set(postures).size).toBe(4);

    expect(systems[0]).toContain("The Guide");
    expect(systems[0]).toContain("people and the story");
    expect(systems[0]).toContain("Do not invent a listen-for");
    expect(systems[1]).toContain("The Critic");
    expect(systems[1]).toContain("one fair judgment");
    expect(systems[1]).toContain("No insults");
    expect(systems[2]).toContain("The Archivist");
    expect(systems[2]).toContain("lineage");
    expect(systems[3]).toContain("Standard Broadcast");
    expect(systems[3]).toContain("one strong fact");
    expect(systems[3]).toContain("Posture: handoff.");

    for (const system of systems) {
      expect(system).toContain("Roots & Branches: that identity plus one fact");
      expect(system).toContain('Do not open with "That was" or "You just heard"');
      expect(system).not.toMatch(/Open with "That was"/);
      expect(system).not.toMatch(/Worth your ear|Listen for this|Hold onto this/);
    }

    const exitPlan = {
      kind: "up_next" as const,
      transition: "full_break" as const,
      announceTracks: [{ title: "Dreams", artist: "Fleetwood Mac" }],
      recapTracks: [{ title: "Go Your Own Way", artist: "Fleetwood Mac", album: "Rumours" }],
      maxDurationSeconds: 12,
      isSessionOpening: false,
      isFirstPlaylistPack: true,
    };
    for (const personaId of ids) {
      const standardExit = buildNewWordsPrompt(
        buildFactPack({
          title: "Dreams",
          artist: "Fleetwood Mac",
          depth: "standard",
          personaId,
          previous: { title: "Go Your Own Way", artist: "Fleetwood Mac" },
          plan: exitPlan,
        }),
        draft,
      ).system;
      expect(standardExit).toContain('You may open with "That was"');
      expect(standardExit).toContain("Do not add a fact about the finished song");
      expect(standardExit).not.toContain('Open with "That was"');
    }

    const unknown = buildNewWordsPrompt(
      packFor("roots_branches", { personaId: "not-a-persona" }),
      draft,
    ).system;
    expect(unknown).toContain("Posture: handoff.");
  });
});

describe("New prompt", () => {
  it("forbids new proper nouns and does not use the Classic teaching contract", () => {
    const pack = packFor("directors_cut");
    const draft = composeNewBreak(pack, null).script;
    const prompt = buildNewWordsPrompt(pack, draft);
    const text = `${prompt.system}\n${prompt.user}`;
    expect(text.toLowerCase()).toContain("proper noun");
    expect(text).toContain("at most two");
    expect(text).toContain("Never read a credit roll");
    expect(text).toContain("unique");
    expect(text).toContain("resonates");
    expect(text).toContain("showcasing");
    expect(text).toContain("guest vocalist");
    expect(text).toContain("moods as facts");
    expect(text).toContain("brand mis-says");
    expect(text).toContain("Do not pad to a monologue");
    expect(text).toContain("only around that real fact");
    expect(text).toContain(draft);
    expect(text).not.toContain(TEACHING_TRUTH_RULE.trim());
    expect(text).not.toContain("PERSONA JOB");
    expect(text).not.toContain("The pack holds up to 6 facts");
    expect(text).not.toContain("Give each featured fact its own sentence");
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
      expect(result.script).toBe("This one is Go Your Own Way, from Fleetwood Mac.");
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
      expect(result.script).toContain("Record Plant");
      expect(result.usedFactIds).toContain("studio");
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

function triviaPlan(title: string, artist: string) {
  return {
    kind: "artist_trivia" as const,
    transition: "full_break" as const,
    announceTracks: [{ title, artist }],
    maxDurationSeconds: 20,
    isSessionOpening: false,
  };
}

describe("MusicBrainz credits in the New pack", () => {
  it("maps lookup producer, studio, and engineer into the existing nuggets", () => {
    const pack = buildFactPack({
      title: "Come Together",
      artist: "The Beatles",
      depth: "directors_cut",
      personaId: "standard-broadcast",
      lookupYear: 1969,
      lookupAlbum: "Abbey Road",
      lookupProducer: "George Martin",
      lookupStudio: "Abbey Road Studios",
      lookupEngineers: ["Geoff Emerick"],
      plan: triviaPlan("Come Together", "The Beatles"),
    });
    expect(pack.nuggets.map((nugget) => nugget.id)).toEqual(["studio"]);
    expect(pack.sheet.some((claim) => claim.id === "credit:geoff-emerick")).toBe(true);
    expect(pack.sheet.find((claim) => claim.id === "producer")?.claim).toBe(
      "George Martin produced it.",
    );
    expect(pack.nuggets.find((nugget) => nugget.id === "studio")?.sentence).toBe(
      "Recorded at Abbey Road Studios.",
    );
    expect(pack.sheet.find((claim) => claim.id === "credit:geoff-emerick")?.claim).toBe(
      "Geoff Emerick engineered this one.",
    );
  });

  it("lets a Time Capsule pack teach one fact when producer and studio both exist", () => {
    const pack = buildFactPack({
      title: "Come Together",
      artist: "The Beatles",
      depth: "time_capsule",
      personaId: "standard-broadcast",
      lookupProducer: "George Martin",
      lookupStudio: "Abbey Road Studios",
      plan: triviaPlan("Come Together", "The Beatles"),
    });
    expect(pack.maxNuggets).toBe(1);
    expect(pack.nuggets.map((nugget) => nugget.id)).toEqual(["studio"]);
  });

  it("keeps the sleeve producer and studio ahead of the lookup", () => {
    const pack = buildFactPack({
      title: "Go Your Own Way",
      artist: "Fleetwood Mac",
      album: "Rumours",
      releaseYear: 1977,
      depth: "directors_cut",
      personaId: "standard-broadcast",
      albumContext: sleeve,
      lookupProducer: "Quincy Jones",
      lookupStudio: "Abbey Road Studios",
      plan: triviaPlan("Go Your Own Way", "Fleetwood Mac"),
    });
    expect(pack.sheet.find((claim) => claim.id === "producer")?.claim).toContain(
      "Lindsey Buckingham",
    );
    expect(pack.sheet.find((claim) => claim.id === "producer")?.claim).not.toContain(
      "Quincy",
    );
    expect(pack.nuggets.find((nugget) => nugget.id === "studio")?.sentence).toContain(
      "Record Plant",
    );
    expect(pack.nuggets.some((nugget) => nugget.sentence.includes("Abbey Road"))).toBe(false);
  });

  it("does not treat a filed-under lookup line as a producer fact", () => {
    const pack = buildFactPack({
      title: "1979",
      artist: "The Smashing Pumpkins",
      depth: "directors_cut",
      personaId: "standard-broadcast",
      lookupProducer: "Filed under alternative rock",
      lookupStudio: "Listed as 90s",
      plan: triviaPlan("1979", "The Smashing Pumpkins"),
    });
    expect(pack.nuggets).toHaveLength(0);
  });
});

describe("a live place is not recorded-at", () => {
  it("keeps Nevermind facts and drops a concert hall filed as the studio", () => {
    const pack = buildFactPack({
      title: "Come as You Are",
      artist: "Nirvana",
      album: "Nevermind",
      releaseYear: 1991,
      lookupTrackNumber: 3,
      lookupStudio: "Zénith de Paris",
      depth: "directors_cut",
      personaId: "standard-broadcast",
      plan: triviaPlan("Come as You Are", "Nirvana"),
    });
    const blob = pack.nuggets.map((nugget) => nugget.sentence).join(" ");
    const sheetBlob = pack.sheet.map((claim) => claim.claim).join(" ");
    expect(blob).toMatch(/1991/);
    expect(sheetBlob).toContain("Nevermind");
    expect(sheetBlob).toContain("track 3");
    expect(blob).not.toMatch(/recorded at/i);
    expect(blob).not.toMatch(/z[eé]nith|paris/i);
    expect(sheetBlob).not.toMatch(/z[eé]nith|paris/i);
    const spoken = composeNewBreak(pack, null).script;
    expect(spoken).toMatch(/1991/);
    expect(pack.sheet.some((claim) => claim.claim.includes("Nevermind"))).toBe(true);
    expect(spoken.toLowerCase()).not.toMatch(/recorded at|z[eé]nith|paris/);
  });

  it("drops a venue stored on the sleeve as the studio", () => {
    const pack = buildFactPack({
      title: "Come as You Are",
      artist: "Nirvana",
      album: "Nevermind",
      releaseYear: 1991,
      depth: "directors_cut",
      personaId: "standard-broadcast",
      albumContext: {
        albumTitle: "Nevermind",
        artist: "Nirvana",
        releaseYear: 1991,
        recordingStudio: "Le Zénith, Paris",
        personnel: [],
        trackList: [{ position: 3, title: "Come as You Are" }],
      },
      plan: triviaPlan("Come as You Are", "Nirvana"),
    });
    expect(pack.nuggets.some((nugget) => /recorded at/i.test(nugget.sentence))).toBe(false);
    expect(JSON.stringify(pack.nuggets)).not.toMatch(/z[eé]nith|paris/i);
  });

  it("still says recorded at when the place is a studio", () => {
    const pack = buildFactPack({
      title: "Come as You Are",
      artist: "Nirvana",
      album: "Nevermind",
      releaseYear: 1991,
      lookupStudio: "Sound City Studios",
      depth: "directors_cut",
      personaId: "standard-broadcast",
      plan: triviaPlan("Come as You Are", "Nirvana"),
    });
    expect(pack.nuggets.find((nugget) => nugget.id === "studio")?.sentence).toBe(
      "Recorded at Sound City Studios.",
    );
  });
});

describe("soft claims stay out of the gate", () => {
  it("rejects a guest vocalist, a mood stated as a fact, or a brand the pack does not name", () => {
    const pack = packFor("directors_cut");
    const soft = "Up next, Go Your Own Way by Fleetwood Mac. It came out in 1977, with a guest vocalist on a haunting ballad.";
    expect(hasSoftClaimAbsentFromPack(soft, pack)).toBe(true);
    expect(scriptPassesGate(soft, pack)).toBe(false);

    const brand = "Go Your Own Way by Fleetwood Mac came out in 1977 on the columbia label.";
    expect(scriptPassesGate(brand, pack)).toBe(false);

    const warm = "Up next, Go Your Own Way by Fleetwood Mac, a warm one from 1977 on Rumours.";
    expect(hasSoftClaimAbsentFromPack(warm, pack)).toBe(false);
    expect(scriptPassesGate(warm, pack)).toBe(false);

    const trueLabel = "Go Your Own Way by Fleetwood Mac came out in 1977 on the Warner label.";
    expect(hasSoftClaimAbsentFromPack(trueLabel, pack)).toBe(false);
  });

  it("rejects a place, person, year, chart, or gear the pack does not list", () => {
    const pack = buildFactPack({
      title: "Come as You Are",
      artist: "Nirvana",
      album: "Nevermind",
      releaseYear: 1991,
      lookupTrackNumber: 3,
      depth: "directors_cut",
      personaId: "standard-broadcast",
      plan: triviaPlan("Come as You Are", "Nirvana"),
    });
    expect(scriptPassesGate(
      "Up next, Come as You Are by Nirvana, released in 1991, recorded at Zénith de Paris.",
      pack,
    )).toBe(false);
    expect(scriptPassesGate(
      "Up next, Come as You Are by Nirvana, released in 1991 on Nevermind, recorded at zenith de paris.",
      pack,
    )).toBe(false);
    expect(scriptPassesGate(
      "Come as You Are by Nirvana came out in 1991 on Nevermind. It was produced by Butch Vig.",
      pack,
    )).toBe(false);
    expect(scriptPassesGate(
      "Come as You Are by Nirvana came out in 1984 on Nevermind.",
      pack,
    )).toBe(false);
    expect(scriptPassesGate(
      "Come as You Are by Nirvana came out in 1991 on Nevermind and went number one on Billboard.",
      pack,
    )).toBe(false);
    expect(scriptPassesGate(
      "Come as You Are by Nirvana came out in 1991 on Nevermind, played on a Les Paul.",
      pack,
    )).toBe(false);
    expect(scriptPassesGate(
      "Up next, Come as You Are by Nirvana. It came out in 1991. It is on Nevermind. It is track 3.",
      pack,
    )).toBe(false);
    expect(pack.sheet.some((claim) => claim.claim.includes("track 3"))).toBe(true);
    expect(buildNewWordsPrompt(pack, "seed").system).toContain("concert hall");
  });

  it("uses a short human line when the pack is empty and the model invents a studio and a city", () => {
    const pack = buildFactPack({
      title: "Come as You Are",
      artist: "Nirvana",
      depth: "directors_cut",
      personaId: "standard-broadcast",
      plan: triviaPlan("Come as You Are", "Nirvana"),
    });
    const invented = "Come as You Are by Nirvana was recorded at Sound City in Seattle in 1991.";
    expect(pack.nuggets).toHaveLength(0);
    expect(scriptPassesGate(invented, pack)).toBe(false);
    const spoken = composeNewBreak(pack, invented);
    expect(spoken.script).toContain("Come as You Are");
    expect(spoken.script).toContain("Nirvana");
    expect(spoken.script).not.toBe("Come as You Are by Nirvana.");
    expect(spoken.script.toLowerCase()).not.toMatch(/recorded at|sound city|seattle|\b1991\b/);
    expect(spoken.usedNuggetIds).toEqual([]);
    const earcon = resolveEarconSrc({ kind: "artist_trivia", isSessionOpening: false });
    expect(newBreakWantsEarcon(earcon, spoken.usedNuggetIds.length > 0, spoken.script)).toBe(false);
  });

  it("still recovers a human line when an empty pack is handed the canned title", () => {
    const pack = buildFactPack({
      title: "Tonight, Tonight",
      artist: "The Smashing Pumpkins",
      depth: "directors_cut",
      personaId: "standard-broadcast",
      plan: triviaPlan("Tonight, Tonight", "The Smashing Pumpkins"),
    });
    const canned = "Tonight, Tonight by The Smashing Pumpkins.";
    expect(pack.nuggets).toHaveLength(0);
    expect(scriptPassesGate(canned, pack)).toBe(false);
    const spoken = composeNewBreak(pack, canned);
    expect(spoken.script).not.toBe(canned);
    expect(spoken.script).toContain("Tonight, Tonight");
    expect(spoken.script).toContain("The Smashing Pumpkins");
  });
});

describe("one surprise, no credit roll, no press-kit filler", () => {
  it("rejects filler even when the line also states a real fact", () => {
    const pack = packFor("roots_branches", {
      albumContext: { ...sleeve, recordingStudio: undefined },
    });
    const clean = "Lindsey Buckingham produced Go Your Own Way. That is why the song holds together the way it does. Up next, Go Your Own Way by Fleetwood Mac.";
    const filler = "Lindsey Buckingham produced Go Your Own Way. Its unique sound resonates, showcasing their talents and adding depth. Up next, Go Your Own Way by Fleetwood Mac.";
    expect(scriptPassesGate(clean, pack)).toBe(true);
    expect(scriptPassesGate(filler, pack)).toBe(false);
    expect(filler.toLowerCase()).toMatch(/unique|resonates|showcasing|talents|depth/);
    const vibe = "Aaron Dessner produced Graceless. Notice how their touch influences the overall vibe. Up next, Graceless by The National.";
    const character = "The National formed in Brooklyn in 1999. Their music has a distinct character that draws you in. Up next, Fake Empire by The National.";
    const personal = "Matt Berninger wrote the lyrics, bringing his personal experiences into the song. Up next, I Need My Girl by The National.";
    expect(scriptPassesGate(vibe, pack)).toBe(false);
    expect(scriptPassesGate(character, pack)).toBe(false);
    expect(scriptPassesGate(personal, pack)).toBe(false);

    const next = "Up next, Go Your Own Way by Fleetwood Mac.";
    const fact = "Lindsey Buckingham produced Go Your Own Way.";
    expect(scriptPassesGate(`${fact} That shows their evolution and growth. ${next}`, pack)).toBe(false);
    expect(scriptPassesGate(`${fact} It has a distinctive sound. ${next}`, pack)).toBe(false);
    expect(scriptPassesGate(`${fact} It carries deep emotions that many can relate to. ${next}`, pack)).toBe(false);
    expect(scriptPassesGate(`${fact} This milestone is capturing the moment. ${next}`, pack)).toBe(false);
    expect(scriptPassesGate(`${fact} Collaboration shapes the song and sets the stage. ${next}`, pack)).toBe(false);
    expect(scriptPassesGate(`${fact} That lyric credit shows his role in shaping the song. ${next}`, pack)).toBe(false);
    expect(scriptPassesGate(`${fact} Lindsey Buckingham is the producer on the sheet. ${next}`, pack)).toBe(true);

    const sourced = buildFactPack({
      title: "Go Your Own Way",
      artist: "Fleetwood Mac",
      depth: "roots_branches",
      personaId: "standard-broadcast",
      claims: [{
        id: "song_story:note",
        claim: "The sleeve notes call the record a period of evolution.",
        topic: "song_story",
        names: [],
        places: [],
        years: [],
        numbers: [],
        instruments: [],
        sourceName: "Wikipedia",
        sourceUrl: "https://en.wikipedia.org/wiki/Rumours",
        confidence: "high",
      }],
      plan: triviaPlan("Go Your Own Way", "Fleetwood Mac"),
    });
    expect(scriptPassesGate(
      "The sleeve notes call the record a period of evolution. That is the fact on the sheet. Here's Go Your Own Way by Fleetwood Mac.",
      sourced,
    )).toBe(true);
    expect(scriptPassesGate(
      "The sleeve notes call the record a period of evolution and growth. That is the fact on the sheet. Here's Go Your Own Way by Fleetwood Mac.",
      sourced,
    )).toBe(false);
  });

  it("keeps a people fact as a story beat and does not invent a listen-for", () => {
    const pack = buildFactPack({
      title: "I Need My Girl",
      artist: "The National",
      depth: "roots_branches",
      personaId: "warm-companion",
      claims: [{
        id: "song_story:lyrics",
        claim: "Matt Berninger wrote the lyrics for I Need My Girl.",
        topic: "song_story",
        names: ["Matt Berninger"],
        places: [],
        years: [],
        numbers: [],
        instruments: [],
        sourceName: "Wikipedia",
        sourceUrl: "https://en.wikipedia.org/wiki/I_Need_My_Girl",
        confidence: "high",
      }],
      nextClaims: [{
        id: "origin:brooklyn",
        claim: "The National formed in Brooklyn in 1999.",
        topic: "origin",
        names: ["The National"],
        places: ["Brooklyn"],
        years: [1999],
        numbers: [],
        instruments: [],
        sourceName: "MusicBrainz",
        sourceUrl: "https://musicbrainz.org/artist/example",
        confidence: "high",
      }],
      plan: triviaPlan("I Need My Girl", "The National"),
    });
    const invented = "Up next, I Need My Girl by The National. Matt Berninger wrote the lyrics, so listen for the lyrics when the song opens.";
    expect(scriptPassesGate(invented, pack)).toBe(false);
    const onlyOnTease = 'Up next, I Need My Girl by The National. Matt Berninger wrote the lyrics, bringing a personal note. After that, listen for how The National formed in Brooklyn in 1999.';
    expect(scriptPassesGate(onlyOnTease, pack)).toBe(false);
    const shape = exampleBreak(pack);
    expect(shape).toMatch(/Matt Berninger/);
    expect(shape).not.toMatch(/That's who wrote this one/i);
    expect(shape).not.toMatch(/That's the part worth knowing/i);
    expect(shape).not.toMatch(/lyric credit/i);
    expect(shape).not.toMatch(/listen for/i);
    expect(shape).not.toMatch(/when the song opens/i);
    expect(shape).not.toMatch(/\b(?:evolution|growth|milestone|distinctive|unique sound|deep emotions|relate to|capturing|set the stage|shapes the song|collaboration shapes)\b/i);
    expect(shape).not.toMatch(/on the sheet/i);
    expect(scriptPassesGate(shape, pack)).toBe(true);
    const prompt = buildNewWordsPrompt(pack, shape).system;
    expect(prompt).toContain("Do not invent a listen-for");
    expect(prompt).toContain("when the song opens");
  });

  it("does not turn a guest or a credit into a performance", () => {
    const guest = buildFactPack({
      title: "Ice Machines",
      artist: "The National",
      depth: "roots_branches",
      personaId: "warm-companion",
      claims: [{
        id: "connections:sufjan-stevens",
        claim: "Sufjan Stevens is a guest on First Two Pages of Frankenstein.",
        topic: "connections",
        names: ["Sufjan Stevens"],
        places: [],
        years: [],
        numbers: [],
        instruments: [],
        sourceName: "Wikipedia",
        sourceUrl: "https://en.wikipedia.org/wiki/First_Two_Pages_of_Frankenstein",
        confidence: "high",
      }],
      plan: triviaPlan("Ice Machines", "The National"),
    });
    const upgraded = 'Get ready for a treat. Sufjan Stevens lends his voice as a guest. Notice how Sufjan Stevens comes in. Ice Machines by The National.';
    expect(scriptPassesGate(upgraded, guest)).toBe(false);
    const kept = "Sufjan Stevens is a guest on First Two Pages of Frankenstein by The National. Notice how Sufjan Stevens comes in. Here's Ice Machines.";
    expect(scriptPassesGate(kept, guest)).toBe(true);
    const aired = "Ice Machines by The National. Sufjan Stevens lends his voice as a guest on First Two Pages of Frankenstein. Notice how Sufjan Stevens comes in. Ice Machines by The National.";
    expect(scriptPassesGate(aired, guest)).toBe(false);
    const joins = "Ice Machines by The National. Sufjan Stevens joins in on First Two Pages of Frankenstein. Notice how Sufjan Stevens comes in. Ice Machines by The National.";
    expect(scriptPassesGate(joins, guest)).toBe(false);

    const credit = buildFactPack({
      title: "Born to Beg",
      artist: "The National",
      depth: "roots_branches",
      personaId: "warm-companion",
      claims: [{
        id: "members:sufjan",
        claim: "Sufjan Stevens is credited on guitar.",
        topic: "members",
        names: ["Sufjan Stevens"],
        places: [],
        years: [],
        numbers: [],
        instruments: ["guitar"],
        sourceName: "MusicBrainz",
        sourceUrl: "https://musicbrainz.org/artist/example",
        confidence: "high",
      }],
      plan: triviaPlan("Born to Beg", "The National"),
    });
    const plays = "Sufjan Stevens plays guitar. Listen for the guitar. Born to Beg by The National.";
    expect(scriptPassesGate(plays, credit)).toBe(false);
  });

  it("gives five Guide breaks five shapes, and a guitar cue a varied listen-for", () => {
    const skeletons = new Set<string>();
    for (let index = 0; index < 5; index += 1) {
      const pack = buildFactPack({
        title: "Born to Beg",
        artist: "The National",
        depth: "roots_branches",
        personaId: "warm-companion",
        claims: [{
          id: "song_story:lyrics",
          claim: "Matt Berninger wrote the lyrics for Born to Beg.",
          topic: "song_story",
          names: ["Matt Berninger"],
          places: [],
          years: [],
          numbers: [],
          instruments: [],
          sourceName: "Wikipedia",
          sourceUrl: "https://en.wikipedia.org/wiki/Born_to_Beg",
          confidence: "high",
        }],
        plan: { ...triviaPlan("Born to Beg", "The National"), styleRotationIndex: index },
      });
      const shape = exampleBreak(pack);
      expect(scriptPassesGate(shape, pack)).toBe(true);
      expect(shape).not.toMatch(/when the song opens|because that is the part to hear|so listen for/i);
      skeletons.add(spokenSkeleton(shape));
    }
    expect(skeletons.size).toBe(5);

    const guitar = buildFactPack({
      title: "Born to Beg",
      artist: "The National",
      depth: "roots_branches",
      personaId: "warm-companion",
      claims: [{
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
      }],
      plan: { ...triviaPlan("Born to Beg", "The National"), styleRotationIndex: 0 },
    });
    const heard = exampleBreak(guitar);
    expect(heard).toMatch(/the guitar you'll hear/i);
    expect(heard).not.toMatch(/\bHear the guitar\b|\bListen for the guitar\b/);
    expect(heard).not.toMatch(/when the song opens|because that is the part to hear/i);
    expect(scriptPassesGate(heard, guitar)).toBe(true);
  });

  it("does not tease the fact this break is already teaching", () => {
    const pack = buildFactPack({
      title: "I Need My Girl",
      artist: "The National",
      depth: "directors_cut",
      personaId: "warm-companion",
      claims: [{
        id: "origin:brooklyn",
        claim: "The National formed in Brooklyn in 1999.",
        topic: "origin",
        names: ["The National"],
        places: ["Brooklyn"],
        years: [1999],
        numbers: [],
        instruments: [],
        sourceName: "MusicBrainz",
        sourceUrl: "https://musicbrainz.org/artist/example",
        confidence: "high",
      }],
      nextClaims: [
        {
          id: "origin:brooklyn-next",
          claim: "The National formed in Brooklyn in 1999.",
          topic: "origin",
          names: ["The National"],
          places: ["Brooklyn"],
          years: [1999],
          numbers: [],
          instruments: [],
          sourceName: "MusicBrainz",
          sourceUrl: "https://musicbrainz.org/artist/example",
          confidence: "high",
        },
        {
          id: "studio:kampo",
          claim: "Bloodbuzz Ohio was recorded at Kampo Studios.",
          topic: "album_story",
          names: [],
          places: ["Kampo Studios"],
          years: [],
          numbers: [],
          instruments: [],
          sourceName: "MusicBrainz",
          sourceUrl: "https://musicbrainz.org/recording/example",
          confidence: "high",
        },
      ],
      plan: triviaPlan("I Need My Girl", "The National"),
    });
    expect(pack.tease?.id).toBe("studio:kampo");
    expect(scriptPassesGate(exampleBreak(pack), pack)).toBe(true);
  });

  it("rejects three credits in a row and keeps one", () => {
    const roll = "Aaron Dessner plays guitar. Bryan Devendorf plays drums. Scott Devendorf plays bass. Up next, Born to Beg by The National.";
    expect(isCreditRoll(roll)).toBe(true);
    expect(isCreditRoll("Aaron Dessner plays guitar, bass, and drums on Born to Beg.")).toBe(true);
    expect(isCreditRoll("Aaron Dessner plays guitar. Hear how it opens. Up next, Born to Beg by The National.")).toBe(false);
    expect(isCreditRoll("Up next, Born to Beg by The National. The National formed in Brooklyn in 1999, so listen for Brooklyn when the song opens. After that, Aaron Dessner and Bryce Dessner produced Graceless.")).toBe(false);

    const pack = buildFactPack({
      title: "Born to Beg",
      artist: "The National",
      depth: "directors_cut",
      personaId: "warm-companion",
      claims: [
        {
          id: "members:aaron",
          claim: "Aaron Dessner plays guitar, piano, and keyboards.",
          topic: "members",
          names: ["Aaron Dessner"],
          places: [],
          years: [],
          numbers: [],
          instruments: ["guitar", "piano", "keyboards"],
          sourceName: "MusicBrainz",
          sourceUrl: "https://musicbrainz.org/artist/example",
          confidence: "high",
        },
      ],
      plan: triviaPlan("Born to Beg", "The National"),
    });
    expect(pack.nuggets).toHaveLength(1);
    expect(pack.nuggets[0]?.sentence).toBe("Aaron Dessner plays guitar.");
    const spoken = composeNewBreak(pack, roll);
    expect(spoken.fellBack).toBe(true);
    expect(spoken.script).toContain("Aaron Dessner");
    expect(spoken.script).not.toMatch(/Bryan|Scott/);
    expect(isCreditRoll(spoken.script)).toBe(false);
  });

  it("does not tease a credit list", () => {
    const pack = buildFactPack({
      title: "Born to Beg",
      artist: "The National",
      depth: "roots_branches",
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
      nextClaims: [
        {
          id: "guests",
          claim: "Sufjan Stevens, Phoebe Bridgers, and Taylor Swift are guests.",
          topic: "connections",
          names: ["Sufjan Stevens", "Phoebe Bridgers", "Taylor Swift"],
          places: [],
          years: [],
          numbers: [],
          instruments: [],
          sourceName: "Wikipedia",
          sourceUrl: "https://en.wikipedia.org/wiki/Example",
          confidence: "high",
        },
        {
          id: "pond",
          claim: "It was recorded at Long Pond.",
          topic: "album_story",
          names: [],
          places: ["Long Pond"],
          years: [],
          numbers: [],
          instruments: [],
          sourceName: "Wikipedia",
          sourceUrl: "https://en.wikipedia.org/wiki/Example",
          confidence: "high",
        },
      ],
      plan: triviaPlan("Born to Beg", "The National"),
    });
    expect(pack.tease?.id).toBe("pond");
    expect(pack.tease?.claim).not.toMatch(/Sufjan|Phoebe|Taylor/);
  });
});

describe("New writer model and sheet wait", () => {
  it("uses gpt-4o-mini for every mode and leaves the Director's Cut switch off", async () => {
    expect(DIRECTORS_CUT_WRITER_MODEL).toBeNull();
    expect(newWordsWriterModel("standard")).toBe("gpt-4o-mini");
    expect(newWordsWriterModel("roots_branches")).toBe("gpt-4o-mini");
    expect(newWordsWriterModel("time_capsule")).toBe("gpt-4o-mini");
    expect(newWordsWriterModel("directors_cut")).toBe("gpt-4o-mini");
    expect(sheetWaitMs("gap")).toBe(SHEET_GAP_WAIT_MS);
    expect(sheetWaitMs("warm")).toBe(SHEET_WARM_WAIT_MS);
    expect(sheetWaitMs(undefined)).toBe(1000);
    expect(NEW_WORDS_MAX_TOKENS).toBe(420);

    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: { content: JSON.stringify({ script: "This one is Go Your Own Way, from Fleetwood Mac." }) },
        }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const bodyFor = (commentaryFormat: string) => ({
        songTitle: "Go Your Own Way",
        artistName: "Fleetwood Mac",
        commentaryFormat,
        segmentPlan: triviaPlan("Go Your Own Way", "Fleetwood Mac"),
      });
      for (const format of ["directors_cut", "time_capsule", "standard", "roots_branches"] as const) {
        fetchMock.mockClear();
        await resolveNewWordsFromBody(bodyFor(format), "pro");
        const request = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as { body?: string } | undefined)?.body));
        expect(request.model).toBe("gpt-4o-mini");
        expect(request.model).not.toMatch(/gpt-5/);
        expect(request.max_tokens).toBe(420);
      }
      fetchMock.mockClear();
      await resolveNewWordsFromBody(bodyFor("directors_cut"), "free");
      const freeRequest = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as { body?: string } | undefined)?.body));
      expect(freeRequest.model).toBe("gpt-4o-mini");
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it("does not hold a gap break for a sheet that is still running", async () => {
    vi.useFakeTimers();
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.mocked(loadBreakSheet).mockImplementation(() => new Promise(() => {}));
    let settled = false;
    const pending = resolveNewWordsFromBody(
      {
        songTitle: "Go Your Own Way",
        artistName: "Fleetwood Mac",
        commentaryFormat: "roots_branches",
        research: "gap",
        segmentPlan: triviaPlan("Go Your Own Way", "Fleetwood Mac"),
      },
      "pro",
    ).finally(() => {
      settled = true;
    });
    try {
      await vi.advanceTimersByTimeAsync(1000);
      expect(settled).toBe(true);
      const result = await pending;
      expect(result.script).not.toMatch(/\b1977\b/);
      expect(result.script).toContain("Go Your Own Way");
      expect(result.gate).toBe("fallback");
    } finally {
      await vi.advanceTimersByTimeAsync(20000);
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });
});

describe("backed tease is set and then paid off", () => {
  it("remembers the next-song promise and clears it when that song arrives", async () => {
    clearStationMemory();
    const tease = {
      id: "next:guitar",
      claim: "Aaron Dessner plays guitar.",
      topic: "members" as const,
      names: ["Aaron Dessner"],
      places: [],
      years: [],
      numbers: [],
      instruments: ["guitar"],
      sourceName: "MusicBrainz",
      sourceUrl: "https://musicbrainz.org/recording/example",
      confidence: "high" as const,
    };
    vi.mocked(loadBreakSheet).mockImplementation(async () => ({
      claims: [],
      nextClaims: [tease],
      sources: [{ name: "MusicBrainz", url: "https://musicbrainz.org/recording/example" }],
    }));
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const scripts = [
      "Up next, New Order T-Shirt by The National. Aaron Dessner plays guitar.",
      "Aaron Dessner plays guitar. Up next, Ice Machines by The National.",
    ];
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ script: scripts[call++] }) } }],
        usage: { prompt_tokens: 100, completion_tokens: 40 },
      }),
    })));
    try {
      const first = await resolveNewWordsFromBody(
        {
          songTitle: "New Order T-Shirt",
          artistName: "The National",
          stationId: "tease-unit",
          commentaryFormat: "standard",
          nextTrack: { title: "Ice Machines", artist: "The National" },
          segmentPlan: triviaPlan("New Order T-Shirt", "The National"),
        },
        "pro",
      );
      expect(first.gate).toBe("pass");
      expect(first.openTease?.songTitle).toBe("Ice Machines");
      expect(first.openTease?.claim).toContain("Aaron Dessner");

      const second = await resolveNewWordsFromBody(
        {
          songTitle: "Ice Machines",
          artistName: "The National",
          stationId: "tease-unit",
          commentaryFormat: "standard",
          openTease: first.openTease,
          segmentPlan: triviaPlan("Ice Machines", "The National"),
        },
        "pro",
      );
      expect(second.script).not.toMatch(/plays guitar/i);
      expect(second.script).toMatch(/Ice Machines/);
      expect(second.openTease).toBeNull();
    } finally {
      clearStationMemory();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});

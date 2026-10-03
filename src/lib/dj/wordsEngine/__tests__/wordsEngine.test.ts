import { describe, expect, it } from "vitest";
import { TEACHING_TRUTH_RULE } from "@/lib/dj/legacyTeachingPrompt";
import type { AlbumContext } from "@/types/station";
import { buildFactPack } from "../factPack";
import { composeNewBreak } from "../compose";
import { scriptPassesGate, wordCount } from "../gate";
import { buildNewWordsPrompt } from "../prompt";
import { resolveNewWordsFromBody } from "../handleRequest";
import type { FactPack } from "../types";

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
    expect(wordCount(spoken.script)).toBeLessThanOrEqual(32);
    expect(scriptPassesGate(spoken.script, pack)).toBe(true);
  });

  it("lets Roots use one nugget and Time Capsule two", () => {
    const roots = composeNewBreak(packFor("roots_branches"), null).script;
    const capsule = composeNewBreak(packFor("time_capsule"), null).script;
    expect(roots).toContain("1977");
    expect(roots).not.toContain("Rumours");
    expect(roots).not.toContain("Lindsey");
    expect(capsule).toContain("1977");
    expect(capsule).toContain("Rumours");
    expect(capsule).not.toContain("Lindsey");
    expect(wordCount(capsule)).toBeGreaterThan(wordCount(roots));
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
    expect(wordCount(spoken)).toBeLessThanOrEqual(32);
    expect(wordCount(spoken)).toBeLessThan(wordCount(rich));
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
    expect(critic).toContain("Worth your ear");
    expect(critic).not.toContain("Quincy");
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
  });
});

describe("resolveNewWordsFromBody", () => {
  it("keeps a free listener on a short true line even if Director's Cut was stored", async () => {
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
  });
});

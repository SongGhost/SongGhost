import { describe, expect, it } from "vitest";
import {
  ALBUM_LORE_ANGLES,
  buildAlbumLoreDirective,
  buildAlbumSegmentBrief,
  buildSegmentUserPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  formatAlbumPersonnel,
  pickAlbumLoreAngle,
} from "../promptBuilder";
import type { DJPromptContext, DjSegmentPlan } from "@/types/dj";
import type { AlbumContext } from "@/types/station";

const album: AlbumContext = {
  albumTitle: "Rumours",
  artist: "Fleetwood Mac",
  releaseYear: 1977,
  recordingStudio: "Record Plant, Sausalito",
  producer: "Ken Caillat",
  label: "Warner Bros.",
  personnel: [
    { name: "Lindsey Buckingham", role: "guitar, vocals" },
    { name: "Stevie Nicks", role: "vocals" },
    { name: "John McVie", role: "bass" },
  ],
  trackList: [
    { position: 1, title: "Second Hand News", side: "A" },
    { position: 2, title: "Dreams", side: "A", note: "Written in ten minutes on a Fender Rhodes." },
    { position: 3, title: "Never Going Back Again", side: "A" },
    { position: 4, title: "Gold Dust Woman", side: "B" },
  ],
};

const dreams = { title: "Dreams", artist: "Fleetwood Mac" };

function plan(overrides: Partial<DjSegmentPlan> = {}): DjSegmentPlan {
  return {
    kind: "song_intro",
    transition: "full_break",
    announceTracks: [dreams],
    maxDurationSeconds: 6,
    styleRotationIndex: 0,
    ...overrides,
  };
}

function context(overrides: Partial<DJPromptContext> = {}): DJPromptContext {
  return {
    track: dreams,
    maxDurationSeconds: 6,
    stationName: "Deep Cuts",
    albumContext: album,
    ...overrides,
  };
}

describe("buildAlbumLoreDirective", () => {
  it("hands the host the record and its confirmed credits", () => {
    const directive = buildAlbumLoreDirective(album);
    expect(directive).toContain("ALBUM DEEP DIVE");
    expect(directive).toContain('"Rumours" by Fleetwood Mac (1977)');
    expect(directive).toContain("recorded at Record Plant, Sausalito");
    expect(directive).toContain("produced by Ken Caillat");
    expect(directive).toContain("released on Warner Bros.");
    expect(directive).toContain("Lindsey Buckingham (guitar, vocals)");
    expect(directive).toContain("all 4 of them");
  });

  it("bans inventing the credits it was not given", () => {
    const directive = buildAlbumLoreDirective(album);
    expect(directive).toContain("ACCURACY IS ABSOLUTE");
    expect(directive).toContain("never invent a producer, engineer, studio, session player");
  });

  it("forbids framing the set as a rotation", () => {
    expect(buildAlbumLoreDirective(album)).toContain("never frame the set as a shuffle");
  });

  it("says nothing at all on a standard station", () => {
    expect(buildAlbumLoreDirective(undefined)).toBe("");
  });

  it("omits credits the sleeve does not carry", () => {
    const bare = buildAlbumLoreDirective({
      ...album,
      recordingStudio: undefined,
      producer: undefined,
      label: undefined,
      personnel: [],
    });
    expect(bare).not.toContain("Confirmed credits");
    expect(bare).not.toContain("Personnel:");
    expect(bare).toContain("ALBUM DEEP DIVE");
  });
});

describe("formatAlbumPersonnel", () => {
  it("counts off the credits it had to trim", () => {
    const crowded = {
      ...album,
      personnel: Array.from({ length: 12 }, (_, i) => ({ name: `Player ${i}`, role: "session" })),
    };
    expect(formatAlbumPersonnel(crowded)).toContain("and 4 more credited");
  });

  it("is empty when nobody is credited", () => {
    expect(formatAlbumPersonnel({ ...album, personnel: [] })).toBe("");
  });
});

describe("album lore rotation", () => {
  it("covers every angle the deep dive is meant to work", () => {
    expect(ALBUM_LORE_ANGLES.map((a) => a.id)).toEqual([
      "band_dynamics",
      "studio_conditions",
      "production_gear",
      "release_significance",
      "sequencing",
    ]);
  });

  it("walks the angles in step with the session's break count", () => {
    const walked = [0, 1, 2, 3, 4, 5].map((i) => pickAlbumLoreAngle(i).id);
    expect(walked).toEqual([
      "band_dynamics",
      "studio_conditions",
      "production_gear",
      "release_significance",
      "sequencing",
      "band_dynamics",
    ]);
  });

  it("has a stable angle for callers with no rotation counter", () => {
    expect(pickAlbumLoreAngle(undefined).id).toBe("band_dynamics");
    expect(pickAlbumLoreAngle(Number.NaN).id).toBe("band_dynamics");
  });
});

describe("buildAlbumSegmentBrief", () => {
  it("places the needle in the running order", () => {
    const brief = buildAlbumSegmentBrief(album, dreams, 0).join(" ");
    expect(brief).toContain("Now cueing track 2 of 4 on side A: \"Dreams\"");
    expect(brief).toContain('It follows "Second Hand News"');
    expect(brief).toContain('Still to come: "Never Going Back Again", "Gold Dust Woman"');
  });

  it("knows the opening track is the needle drop", () => {
    const brief = buildAlbumSegmentBrief(album, { title: "Second Hand News", artist: "" }, 0).join(" ");
    expect(brief).toContain("This is the opening track");
    expect(brief).not.toContain("It follows");
  });

  it("knows the last track closes the record", () => {
    const brief = buildAlbumSegmentBrief(album, { title: "Gold Dust Woman", artist: "" }, 0).join(" ");
    expect(brief).toContain("This is the closing track");
    expect(brief).not.toContain("Still to come");
  });

  it("matches a decorated reissue title back to its position", () => {
    const brief = buildAlbumSegmentBrief(album, { title: "Dreams (2004 Remaster)", artist: "" }, 0);
    expect(brief.join(" ")).toContain("Now cueing track 2 of 4");
  });

  it("passes a verified track note through without asking for it to be read out", () => {
    const brief = buildAlbumSegmentBrief(album, dreams, 0).join(" ");
    expect(brief).toContain("Written in ten minutes on a Fender Rhodes.");
    expect(brief).toContain("do not read it verbatim");
  });

  it("anchors the talk to the release year", () => {
    expect(buildAlbumSegmentBrief(album, dreams, 0).join(" ")).toContain("sits in 1977");
  });

  it("works one angle per break", () => {
    expect(buildAlbumSegmentBrief(album, dreams, 2).join(" ")).toContain(
      'Lore angle for this break — "Production & Gear"',
    );
    expect(buildAlbumSegmentBrief(album, dreams, 2).join(" ")).toContain("One angle only");
  });

  it("still names the record when the track is not on it", () => {
    const brief = buildAlbumSegmentBrief(album, { title: "Tusk", artist: "" }, 0).join(" ");
    expect(brief).toContain('"Rumours" by Fleetwood Mac (1977)');
    expect(brief).not.toContain("Now cueing");
  });
});

describe("deep dive segment prompts", () => {
  it("carries the record into a song intro", () => {
    const prompt = buildSegmentUserPrompt(plan(), context());
    expect(prompt).toContain("ALBUM DEEP DIVE");
    expect(prompt).toContain("Now cueing track 2 of 4");
    expect(prompt).toContain("SONG INTRO");
  });

  it("announces the record on the session-opening break", () => {
    const prompt = buildSegmentUserPrompt(plan({ isSessionOpening: true }), context());
    expect(prompt).toContain("ALBUM SIGN-ON");
    expect(prompt).toContain("end to end");
  });

  it("keeps a stinger a station ID and nothing more", () => {
    const prompt = buildSegmentUserPrompt(
      plan({ kind: "stinger", transition: "stinger", announceTracks: [], maxDurationSeconds: 3 }),
      context(),
    );
    expect(prompt).toContain("STATION STINGER");
    expect(prompt).not.toContain("ALBUM DEEP DIVE");
    expect(prompt).not.toContain("Rumours");
  });

  it("frames a recap as a run through the record", () => {
    const prompt = buildSegmentUserPrompt(
      plan({
        kind: "recap",
        announceTracks: [{ title: "Second Hand News", artist: "Fleetwood Mac" }, dreams],
        recapTracks: [{ title: "Second Hand News", artist: "Fleetwood Mac" }],
      }),
      context(),
    );
    expect(prompt).toContain("ALBUM DEEP DIVE");
    expect(prompt).toContain("RECAP SEGMENT");
  });

  it("does not duplicate the bare album line when the full sleeve is present", () => {
    const prompt = buildSegmentUserPrompt(
      plan({ announceTracks: [{ ...dreams, album: "Rumours" }] }),
      context(),
    );
    expect(prompt).not.toContain('Album context: "Rumours"');
  });

  it("leaves a standard station's prompt untouched", () => {
    const prompt = buildSegmentUserPrompt(
      plan({ announceTracks: [{ ...dreams, album: "Rumours" }] }),
      context({ albumContext: undefined }),
    );
    expect(prompt).not.toContain("ALBUM DEEP DIVE");
    expect(prompt).toContain('Album context: "Rumours"');
  });
});

describe("deep dive system prompt", () => {
  it("folds the lore directive in alongside the persona and station rules", () => {
    const prompt = buildSystemPrompt(context());
    expect(prompt).toContain("ALBUM DEEP DIVE");
    expect(prompt).toContain("STATION IDENTITY");
    expect(prompt).toContain("PUNCTUATION FOR TTS");
  });

  it("stays out of a standard station's system prompt", () => {
    expect(buildSystemPrompt(context({ albumContext: undefined }))).not.toContain(
      "ALBUM DEEP DIVE",
    );
  });

  it("keeps the era lock in force on a deep dive", () => {
    const prompt = buildSystemPrompt(context({ eraLock: "70s" }));
    expect(prompt).toContain("ERA LOCK — ABSOLUTE");
    expect(prompt).toContain("ALBUM DEEP DIVE");
  });
});

describe("deep dive plan-less prompt", () => {
  it("still gets the record on the legacy no-segment path", () => {
    const prompt = buildUserPrompt(context());
    expect(prompt).toContain("ALBUM DEEP DIVE");
    expect(prompt).toContain("Now cueing track 2 of 4");
  });

  it("uses the bare album string when there is no sleeve", () => {
    const prompt = buildUserPrompt(
      context({ albumContext: undefined, track: { ...dreams, album: "Rumours" } }),
    );
    expect(prompt).toContain('Album context: "Rumours"');
  });
});

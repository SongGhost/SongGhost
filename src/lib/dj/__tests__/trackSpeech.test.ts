import { describe, expect, it } from "vitest";
import {
  cleanTrackForSpeech,
  finishSpokenSentence,
  formatTrackByline,
  formatTrackForDj,
} from "../trackSpeech";
import { getSongIntroLine } from "../scriptGenerator";

describe("cleanTrackForSpeech", () => {
  it("cleans the Biggie YouTube dump without duplicating the artist", () => {
    const spoken = cleanTrackForSpeech({
      artist: "The Notorious B.I.G.",
      title: "The Notorious B.I.G. - Notorious B.I.G. [HD Remaster]",
    });

    expect(spoken.artist).toBe("The Notorious B.I.G.");
    expect(spoken.title).toBe("Notorious B.I.G.");
    expect(spoken.title).not.toMatch(/HD Remaster/i);
    expect(formatTrackByline(spoken)).toBe(
      "Notorious B.I.G. by The Notorious B.I.G.",
    );
  });

  it("strips official-video and lyrics tags from a structured title", () => {
    const spoken = formatTrackForDj({
      artist: "Radiohead",
      title: "Karma Police (Official Video) [4K]",
    });

    expect(spoken).toEqual({ artist: "Radiohead", title: "Karma Police" });
  });

  it("strips lyric/audio tags and does not invent a song name", () => {
    const spoken = cleanTrackForSpeech({
      artist: "Fleetwood Mac",
      title: "Dreams (Lyrics) (Audio)",
    });

    expect(spoken).toEqual({ artist: "Fleetwood Mac", title: "Dreams" });
  });

  it("splits a raw Artist - Title dump when no artist field is present", () => {
    const spoken = cleanTrackForSpeech({
      title: "Nirvana - Smells Like Teen Spirit [Official Video]",
    });

    expect(spoken).toEqual({
      artist: "Nirvana",
      title: "Smells Like Teen Spirit",
    });
  });

  it("keeps a clean structured pair unchanged", () => {
    expect(
      cleanTrackForSpeech({ artist: "Eagles", title: "Hotel California" }),
    ).toEqual({ artist: "Eagles", title: "Hotel California" });
  });
});

describe("finishSpokenSentence", () => {
  it("does not leave a double period after an abbreviated artist", () => {
    expect(
      finishSpokenSentence("Up now is Notorious B.I.G. by The Notorious B.I.G."),
    ).toBe("Up now is Notorious B.I.G. by The Notorious B.I.G.");
    expect(
      finishSpokenSentence("Up now is Notorious B.I.G. by The Notorious B.I.G.."),
    ).toBe("Up now is Notorious B.I.G. by The Notorious B.I.G.");
  });
});

describe("getSongIntroLine", () => {
  it("airs the Biggie example as a clean radio line", () => {
    const line = getSongIntroLine(
      "The Notorious B.I.G.",
      "The Notorious B.I.G. - Notorious B.I.G. [HD Remaster]",
    );

    expect(line).toBe("Up now is Notorious B.I.G. by The Notorious B.I.G.");
    expect(line).not.toMatch(/HD Remaster/i);
    expect(line).not.toMatch(/by The Notorious B\.I\.G\.\./);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearMusicBrainzCache,
  lookupMusicBrainzRecording,
  readMusicBrainzRecordingCredits,
} from "@/lib/catalog/musicbrainz";

const comeTogetherRels = {
  tags: [{ name: "rock" }, { name: "classic rock" }],
  relations: [
    {
      type: "producer",
      "target-type": "artist",
      direction: "backward",
      artist: { name: "George Martin" },
    },
    {
      type: "producer",
      "target-type": "artist",
      direction: "backward",
      artist: { name: "Chris Thomas" },
    },
    {
      type: "engineer",
      "target-type": "artist",
      direction: "backward",
      artist: { name: "Geoff Emerick" },
    },
    {
      type: "engineer",
      "target-type": "artist",
      direction: "backward",
      artist: { name: "Phil McDonald" },
    },
    {
      type: "vocal",
      "target-type": "artist",
      direction: "backward",
      artist: { name: "Billy Preston" },
    },
    {
      type: "instrument",
      "target-type": "artist",
      attributes: ["electric guitar"],
      artist: { name: "John Lennon" },
    },
    {
      type: "recorded at",
      "target-type": "place",
      place: { name: "Abbey Road Studios: Studio 3", type: "Studio", disambiguation: "" },
    },
    {
      type: "recorded at",
      "target-type": "place",
      place: { name: "Trident Studios", type: "Studio", disambiguation: "London, UK" },
    },
    {
      type: "edited at",
      "target-type": "place",
      place: { name: "Should Not Use" },
    },
  ],
};

describe("readMusicBrainzRecordingCredits", () => {
  it("maps producer, engineer, and the first recorded-at place", () => {
    const credits = readMusicBrainzRecordingCredits(comeTogetherRels);
    expect(credits.producer).toBe("George Martin, Chris Thomas");
    expect(credits.engineers).toEqual(["Geoff Emerick", "Phil McDonald"]);
    expect(credits.recordingStudio).toBe("Abbey Road Studios: Studio 3");
    const blob = JSON.stringify(credits);
    expect(blob).not.toContain("Billy Preston");
    expect(blob).not.toContain("John Lennon");
    expect(blob).not.toContain("rock");
    expect(blob).not.toContain("Should Not Use");
    expect(blob).not.toContain("Trident");
  });

  it("keeps a place disambiguation that is a place, and drops a year-range note", () => {
    expect(readMusicBrainzRecordingCredits({
      relations: [{
        type: "recorded at",
        place: { name: "Trident Studios", disambiguation: "London, UK" },
      }],
    }).recordingStudio).toBe("Trident Studios, London, UK");

    expect(readMusicBrainzRecordingCredits({
      relations: [{
        type: "recorded at",
        place: { name: "Olympic Studios", disambiguation: "1966–2009" },
      }],
    }).recordingStudio).toBe("Olympic Studios");
  });
});

describe("lookupMusicBrainzRecording relationships", () => {
  afterEach(() => {
    clearMusicBrainzCache();
    vi.unstubAllGlobals();
  });

  it("requests artist-rels and place-rels and returns the fixture credits", async () => {
    clearMusicBrainzCache();
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const href = String(url);
      urls.push(href);
      if (href.includes("/recording/mbid-1")) {
        return {
          ok: true,
          json: async () => ({
            id: "mbid-1",
            title: "Come Together",
            "first-release-date": "1969-09-26",
            releases: [{ title: "Abbey Road", date: "1969-09-26" }],
            ...comeTogetherRels,
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          recordings: [{ id: "mbid-1", title: "Come Together", isrcs: ["GBAYE0900597"] }],
        }),
      };
    }));

    const result = await lookupMusicBrainzRecording("The Beatles", "Come Together", {
      includeRelationships: true,
    });

    const detail = urls.find((url) => url.includes("/recording/mbid-1"));
    expect(detail).toBeTruthy();
    expect(decodeURIComponent(detail ?? "")).toContain(
      "inc=isrcs+releases+artist-rels+place-rels",
    );
    expect(result?.producer).toBe("George Martin, Chris Thomas");
    expect(result?.recordingStudio).toBe("Abbey Road Studios: Studio 3");
    expect(result?.engineers).toEqual(["Geoff Emerick", "Phil McDonald"]);
    expect(JSON.stringify(result)).not.toContain("Billy Preston");
    expect(JSON.stringify(result)).not.toContain("rock");
  }, 15000);

  it("does not ask for relationship includes on the short catalog lookup", async () => {
    clearMusicBrainzCache();
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      return {
        ok: true,
        json: async () => ({
          recordings: [{
            id: "mbid-2",
            title: "Come Together",
            isrcs: ["GBAYE0900597"],
            "first-release-date": "1969-09-26",
          }],
        }),
      };
    }));

    const result = await lookupMusicBrainzRecording("The Beatles", "Come Together");
    expect(result?.releaseYear).toBe(1969);
    expect(result?.producer).toBeUndefined();
    expect(urls).toHaveLength(1);
    expect(decodeURIComponent(urls[0] ?? "")).not.toContain("artist-rels");
  }, 15000);
});

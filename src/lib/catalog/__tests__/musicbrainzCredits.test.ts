import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearMusicBrainzCache,
  lookupMusicBrainzRecording,
  readMusicBrainzRecordingCredits,
  readMusicBrainzWorkCredits,
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

  it("keeps assistant, co-, and additional on the credit", () => {
    const credits = readMusicBrainzRecordingCredits({
      relations: [
        { type: "assistant engineer", artist: { name: "Andy Immernan" } },
        { type: "engineer", artist: { name: "Greg Giorgio" }, attributes: ["co"] },
        {
          type: "recorded at",
          attributes: ["additional"],
          place: { name: "RCA Studio B", type: "Studio" },
        },
        { type: "producer", artist: { name: "Aaron Dessner" } },
        { type: "producer", artist: { name: "Bryce Dessner" } },
      ],
    });
    expect(credits.engineerCredits).toEqual([
      { name: "Andy Immernan", qualifier: "assistant" },
      { name: "Greg Giorgio", qualifier: "co-" },
    ]);
    expect(credits.recordingStudio).toBe("RCA Studio B");
    expect(credits.recordingStudioAdditional).toBe(true);
    expect(credits.producer).toBe("Aaron Dessner, Bryce Dessner");
    expect(credits.producerCredits).toEqual([
      { name: "Aaron Dessner", qualifier: "" },
      { name: "Bryce Dessner", qualifier: "" },
    ]);
  });

  it("keeps composer and lyricist as different roles", () => {
    expect(readMusicBrainzWorkCredits([
      { type: "composer", artist: { name: "Aaron Dessner" } },
      { type: "composer", artist: { name: "Bryce Dessner" } },
      { type: "lyricist", artist: { name: "Matt Berninger" } },
      { type: "lyricist", artist: { name: "Carin Besser" } },
      { type: "writer", artist: { name: "Someone Else" } },
    ])).toEqual([
      { name: "Aaron Dessner", role: "composer", qualifier: "" },
      { name: "Bryce Dessner", role: "composer", qualifier: "" },
      { name: "Matt Berninger", role: "lyricist", qualifier: "" },
      { name: "Carin Besser", role: "lyricist", qualifier: "" },
      { name: "Someone Else", role: "writer", qualifier: "" },
    ]);
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

  it("does not file a concert place as the recording studio", () => {
    const credits = readMusicBrainzRecordingCredits({
      relations: [
        {
          type: "recorded at",
          attributes: [],
          place: { name: "Zénith de Paris", type: "Indoor arena", disambiguation: "" },
        },
        {
          type: "recorded at",
          attributes: ["live"],
          place: { name: "Abbey Road Studios", type: "Studio" },
        },
        {
          type: "recorded at",
          place: { name: "Sound City Studios", type: "Studio" },
        },
      ],
    });
    expect(credits.recordingStudio).toBe("Sound City Studios");
    expect(JSON.stringify(credits)).not.toContain("Zénith");
    expect(JSON.stringify(credits)).not.toContain("Abbey Road");
  });

  it("leaves the studio empty when the only recorded-at place is a venue", () => {
    expect(readMusicBrainzRecordingCredits({
      relations: [{
        type: "recorded at",
        place: { name: "Zénith de Paris", type: "Indoor arena" },
      }],
    }).recordingStudio).toBeUndefined();
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

  it("skips a live venue hit and keeps the studio on the named album", async () => {
    clearMusicBrainzCache();
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const href = String(url);
      urls.push(href);
      if (href.includes("/recording/live-zenith")) {
        return {
          ok: true,
          json: async () => ({
            id: "live-zenith",
            title: "Come as You Are",
            disambiguation: "live, 1992-06-24: Le Zénith, Paris, France",
            relations: [{
              type: "recorded at",
              place: { name: "Zénith de Paris", type: "Indoor arena" },
            }],
            releases: [{
              title: "1992-06-24: Le Zénith, Paris, France",
              status: "Bootleg",
              date: "1992-06-24",
            }],
          }),
        };
      }
      if (href.includes("/recording/studio-nevermind")) {
        return {
          ok: true,
          json: async () => ({
            id: "studio-nevermind",
            title: "Come as You Are",
            "first-release-date": "1991-09-24",
            releases: [{ title: "Nevermind", status: "Official", date: "1991-09-24" }],
            relations: [
              {
                type: "producer",
                artist: { name: "Butch Vig" },
              },
              {
                type: "recorded at",
                place: { name: "Sound City Studios", type: "Studio" },
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          recordings: [
            {
              id: "live-zenith",
              title: "Come as You Are",
              disambiguation: "live, 1992-06-24: Le Zénith, Paris, France",
              releases: [{
                title: "1992-06-24: Le Zénith, Paris, France",
                status: "Bootleg",
              }],
            },
            {
              id: "studio-nevermind",
              title: "Come as You Are",
              releases: [{ title: "Nevermind", status: "Official", date: "1991-09-24" }],
            },
          ],
        }),
      };
    }));

    const result = await lookupMusicBrainzRecording("Nirvana", "Come as You Are", {
      includeRelationships: true,
      studioMaster: true,
      album: "Nevermind",
    });

    const search = decodeURIComponent(urls[0] ?? "").replace(/\+/g, " ");
    expect(search).toContain("status:official");
    expect(search).toContain("NOT comment:live");
    expect(search).toContain('release:"Nevermind"');
    expect(urls.some((url) => url.includes("/recording/live-zenith"))).toBe(false);
    expect(urls.some((url) => url.includes("/recording/studio-nevermind"))).toBe(true);
    expect(result?.recordingStudio).toBe("Sound City Studios");
    expect(result?.producer).toBe("Butch Vig");
    expect(result?.album).toBe("Nevermind");
    expect(JSON.stringify(result)).not.toContain("Zénith");
  }, 15000);

  it("does not attach another album's studio when the named album is missing", async () => {
    clearMusicBrainzCache();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const href = String(url);
      if (href.includes("/recording/other-album")) {
        return {
          ok: true,
          json: async () => ({
            id: "other-album",
            title: "Come as You Are",
            "first-release-date": "1992-01-01",
            releases: [{ title: "Incesticide", status: "Official", date: "1992-01-01" }],
            relations: [{
              type: "recorded at",
              place: { name: "Smart Studios", type: "Studio" },
            }],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          recordings: [{
            id: "other-album",
            title: "Come as You Are",
            "first-release-date": "1992-01-01",
            releases: [{ title: "Incesticide", status: "Official", date: "1992-01-01" }],
          }],
        }),
      };
    }));

    const result = await lookupMusicBrainzRecording("Nirvana", "Come as You Are", {
      includeRelationships: true,
      studioMaster: true,
      album: "Nevermind",
    });
    expect(result?.recordingStudio).toBeUndefined();
    expect(JSON.stringify(result ?? {})).not.toContain("Smart Studios");
    expect(JSON.stringify(result ?? {})).not.toContain("Incesticide");
  }, 15000);
});

import { describe, expect, it } from "vitest";
import {
  preferPlayableCandidates,
  verdictFromYouTubeListing,
} from "@/lib/youtube/playability";

const DEAD_ID = "deadvid0001";
const LIVE_ID = "livevid0001";
const REGION_ID = "regionid001";

describe("queue prefers a playable video", () => {
  it("does not put a dead id in slot 0 when a playable seed alternative exists", () => {
    const queued = preferPlayableCandidates(
      [
        { youtubeId: DEAD_ID, title: "Unavailable upload" },
        { youtubeId: LIVE_ID, title: "Official audio" },
        { youtubeId: REGION_ID, title: "Region locked" },
      ],
      new Map([
        [DEAD_ID, "blocked"],
        [LIVE_ID, "playable"],
        [REGION_ID, "restricted"],
      ] as const),
    );

    expect(queued[0]?.youtubeId).toBe(LIVE_ID);
    expect(queued.map((track) => track.youtubeId)).not.toContain(DEAD_ID);
    expect(queued.map((track) => track.youtubeId)).toEqual([LIVE_ID, REGION_ID]);
  });

  it("drops a session-dead id even when the listing looks playable", () => {
    const queued = preferPlayableCandidates(
      [
        { youtubeId: DEAD_ID, title: "Already failed on air" },
        { youtubeId: LIVE_ID, title: "Backup" },
      ],
      new Map([
        [DEAD_ID, "playable"],
        [LIVE_ID, "playable"],
      ]),
      new Set([DEAD_ID]),
    );

    expect(queued).toHaveLength(1);
    expect(queued[0]?.youtubeId).toBe(LIVE_ID);
  });

  it("still launches the candidate it has when the check does not answer", () => {
    const only = { youtubeId: "onlyvid0001", title: "Unverified" };
    expect(preferPlayableCandidates([only], new Map())).toEqual([only]);
  });
});

describe("YouTube listing verdict", () => {
  it("blocks an embed the owner turned off", () => {
    expect(
      verdictFromYouTubeListing({
        status: { embeddable: false, privacyStatus: "public", uploadStatus: "processed" },
      }),
    ).toBe("blocked");
  });

  it("blocks an age-gated embed and holds a region lock behind a clean one", () => {
    expect(
      verdictFromYouTubeListing({
        status: { embeddable: true, privacyStatus: "public" },
        contentDetails: { contentRating: { ytRating: "ytAgeRestricted" } },
      }),
    ).toBe("blocked");
    expect(
      verdictFromYouTubeListing({
        status: { embeddable: true, privacyStatus: "public" },
        contentDetails: { regionRestriction: { blocked: ["US"] } },
      }),
    ).toBe("restricted");
  });

  it("treats a missing listing as uncertain", () => {
    expect(verdictFromYouTubeListing(undefined)).toBe("uncertain");
    expect(verdictFromYouTubeListing({})).toBe("uncertain");
  });
});

import { describe, expect, it } from "vitest";
import { resolveEarconSrc } from "../earcon";
import { isLoreSegmentKind } from "@/types/dj";

describe("resolveEarconSrc", () => {
  it("wires the teaser earcon for Roots & Branches teasers", () => {
    expect(
      resolveEarconSrc({ kind: "roots_teaser" }),
    ).toBe("/audio/earcons/teaser/open.mp3");
    expect(isLoreSegmentKind("roots_teaser")).toBe(false);
  });

  it("keeps lore / weather / concert cues on lore-type breaks", () => {
    expect(resolveEarconSrc({ kind: "song_intro" })).toBe("/audio/earcons/lore/open.mp3");
    expect(isLoreSegmentKind("song_intro")).toBe(true);
    expect(resolveEarconSrc({ kind: "up_next" })).toBe("/audio/earcons/lore/open.mp3");
    expect(isLoreSegmentKind("up_next")).toBe(true);
    expect(resolveEarconSrc({ kind: "artist_trivia" })).toBe("/audio/earcons/lore/open.mp3");
    expect(
      resolveEarconSrc({ kind: "local_events", localEventSubkind: "weather" }),
    ).toBe("/audio/earcons/weather/open.mp3");
    expect(
      resolveEarconSrc({ kind: "local_events", localEventSubkind: "concert" }),
    ).toBe("/audio/earcons/concert/open.mp3");
  });

  it("returns null for single-clip kinds that are not teasers", () => {
    expect(resolveEarconSrc({ kind: "song_intro", isSessionOpening: true })).toBeNull();
    expect(resolveEarconSrc({ kind: "song_id" })).toBeNull();
    expect(resolveEarconSrc({ kind: "stinger" })).toBeNull();
    expect(resolveEarconSrc({ kind: "recap" })).toBeNull();
  });
});

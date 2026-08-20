import { describe, expect, it } from "vitest";
import {
  getYouTubeThumbnail,
  nextYouTubeThumbnailFallback,
} from "@/lib/youtube/ids";

describe("getYouTubeThumbnail", () => {
  const id = "dQw4w9WgXcQ";

  it("returns a CDN URL for a valid 11-character video id", () => {
    expect(getYouTubeThumbnail(id, "hq")).toBe(
      `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    );
  });

  it("returns an empty string for empty, falsy, or invalid video ids", () => {
    expect(getYouTubeThumbnail("")).toBe("");
    expect(getYouTubeThumbnail("   ")).toBe("");
    expect(getYouTubeThumbnail(undefined)).toBe("");
    expect(getYouTubeThumbnail(null)).toBe("");
    expect(getYouTubeThumbnail("short")).toBe("");
    expect(getYouTubeThumbnail("not a valid id!!")).toBe("");
  });
});

describe("nextYouTubeThumbnailFallback", () => {
  const id = "dQw4w9WgXcQ";

  it("steps hqdefault down to mqdefault, then default", () => {
    const hq = getYouTubeThumbnail(id, "hq");
    const mq = nextYouTubeThumbnailFallback(hq);
    expect(mq).toBe(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`);
    expect(nextYouTubeThumbnailFallback(mq!)).toBe(
      `https://i.ytimg.com/vi/${id}/default.jpg`,
    );
    expect(
      nextYouTubeThumbnailFallback(`https://i.ytimg.com/vi/${id}/default.jpg`),
    ).toBeNull();
  });

  it("enters the ladder at hq when maxres or sd 404s", () => {
    expect(
      nextYouTubeThumbnailFallback(getYouTubeThumbnail(id, "maxres")),
    ).toBe(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
    expect(
      nextYouTubeThumbnailFallback(getYouTubeThumbnail(id, "sd")),
    ).toBe(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
  });

  it("returns null for empty, invalid, or non-YouTube URLs", () => {
    expect(nextYouTubeThumbnailFallback("")).toBeNull();
    expect(nextYouTubeThumbnailFallback("not a url")).toBeNull();
    expect(
      nextYouTubeThumbnailFallback("https://i.scdn.co/image/ab67616d0000"),
    ).toBeNull();
    expect(
      nextYouTubeThumbnailFallback("https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg"),
    ).toBeNull();
    expect(
      nextYouTubeThumbnailFallback("https://i.ytimg.com/vi//hqdefault.jpg"),
    ).toBeNull();
  });
});

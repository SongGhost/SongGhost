import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  orderedPlaylistSnapshot,
  samePlaylistOrder,
  type PlaylistRow,
} from "../sticky-playlist";

const shown: PlaylistRow[] = [
  { title: "Song A", artist: "Artist A", youtubeId: "aaa" },
  { title: "Song B", artist: "Artist B", youtubeId: "bbb" },
  { title: "Song C", artist: "Artist C", youtubeId: "ccc" },
];

describe("sticky playlist", () => {
  it("keeps the displayed order as the playing queue", () => {
    const playing = orderedPlaylistSnapshot(shown);
    expect(playing).toEqual(shown);
    expect(playing).not.toBe(shown);
    expect(samePlaylistOrder(shown, playing)).toBe(true);
  });

  it("treats a reshuffled or replaced set as a different queue", () => {
    const reshuffled = [shown[1]!, shown[0]!, shown[2]!];
    const catalogSwap = [
      shown[0]!,
      { title: "Other", artist: "Other", youtubeId: "zzz" },
    ];
    expect(samePlaylistOrder(shown, reshuffled)).toBe(false);
    expect(samePlaylistOrder(shown, catalogSwap)).toBe(false);
  });

  it("binds Play to the snapshot before any starter draw", () => {
    const queue = readFileSync(
      path.resolve("src/hooks/useStationQueue.ts"),
      "utf8",
    );
    const stickyAt = queue.indexOf(
      "const ordered = orderedPlaylistSnapshot(initialTracksRef.current)",
    );
    const pickAt = queue.indexOf("pickStarter(stationIdRef.current");
    expect(stickyAt).toBeGreaterThan(0);
    expect(pickAt).toBeGreaterThan(stickyAt);
    const stickyBody = queue.slice(stickyAt - 80, stickyAt + 420);
    expect(stickyBody).toContain("if (stickyPlaylistRef.current)");
    expect(stickyBody).toContain("orderedPlaylistSnapshot");
    expect(stickyBody).toContain("return;");
    expect(stickyBody).not.toContain("pickStarter");
    expect(stickyBody).not.toContain("replenishQueue");
  });

  it("does not let a later catalog fill replace the visible list", () => {
    const queue = readFileSync(
      path.resolve("src/hooks/useStationQueue.ts"),
      "utf8",
    );
    const replenishAt = queue.indexOf("const replenishQueue = useCallback");
    const replenishBody = queue.slice(replenishAt, replenishAt + 700);
    expect(replenishBody).toContain("if (stickyPlaylistRef.current) return;");
    const removeAt = queue.indexOf("const removeTrack = useCallback");
    const removeBody = queue.slice(removeAt, removeAt + 1400);
    const stickyGuard = removeBody.indexOf("if (stickyPlaylistRef.current) return;");
    const shuffleAt = removeBody.indexOf("applyQueue(shuffle(");
    expect(stickyGuard).toBeGreaterThan(-1);
    expect(shuffleAt).toBeGreaterThan(stickyGuard);
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { emptyPlaylistNotice, mayStartMusic, type MusicStartReason } from "../playback-gate";

const blocked: MusicStartReason[] = [
  "hydrate",
  "host-release",
  "stall-recovery",
  "load-video",
  "ensure-playback",
  "two-ahead",
];

describe("playback gate", () => {
  it("does not start music on refresh", () => {
    expect(mayStartMusic({
      reason: "hydrate",
      listenerPaused: false,
      userAskedToPlay: false,
    })).toBe(false);
  });

  it("starts music only when the listener hits Play, Next, or a new station", () => {
    for (const reason of ["user-play", "user-next", "new-station"] as const) {
      expect(mayStartMusic({
        reason,
        listenerPaused: true,
        userAskedToPlay: false,
      })).toBe(true);
    }
  });

  it("keeps Pause paused against host handoff, stall recovery, load, and two-ahead", () => {
    for (const reason of blocked) {
      expect(mayStartMusic({
        reason,
        listenerPaused: true,
        userAskedToPlay: true,
      })).toBe(false);
    }
  });

  it("lets a song the listener asked for continue after the host or a dead-id skip", () => {
    expect(mayStartMusic({
      reason: "host-release",
      listenerPaused: false,
      userAskedToPlay: true,
    })).toBe(true);
    expect(mayStartMusic({
      reason: "stall-recovery",
      listenerPaused: false,
      userAskedToPlay: true,
    })).toBe(true);
  });

  it("does not let host release or stall recovery start a session nobody asked for", () => {
    expect(mayStartMusic({
      reason: "host-release",
      listenerPaused: false,
      userAskedToPlay: false,
    })).toBe(false);
    expect(mayStartMusic({
      reason: "stall-recovery",
      listenerPaused: false,
      userAskedToPlay: false,
    })).toBe(false);
  });

  it("says so when the new list cannot start", () => {
    const notice = emptyPlaylistNotice("Alternative Music");
    expect(notice.title).toBe("Couldn't start Alternative Music");
    expect(notice.detail.toLowerCase()).toContain("nothing is playing");
  });
});

describe("playback gate wiring", () => {
  const page = readFileSync(path.resolve("src/app/page.tsx"), "utf8");
  const player = readFileSync(path.resolve("src/components/AudioPlayer.tsx"), "utf8");

  it("restores the last station for display and does not press Play", () => {
    const start = page.indexOf("const restoreSessionFromStorage = useCallback");
    const end = page.indexOf("useLayoutEffect(() => {", start);
    const body = page.slice(start, end);
    expect(body).toContain("requestSessionHydrate");
    expect(body).not.toContain("ensureListening");
    expect(body).not.toContain("setIsPlaying(true)");
  });

  it("arms playback only from the listener gesture, and Pause holds it", () => {
    const ensure = page.slice(
      page.indexOf("const ensureListening = useCallback"),
      page.indexOf("useLayoutEffect(() => {"),
    );
    expect(ensure.indexOf("armPlayback()")).toBeGreaterThan(-1);
    expect(ensure.indexOf("armPlayback()")).toBeLessThan(ensure.indexOf("setIsPlaying(true)"));

    const toggle = page.slice(
      page.indexOf("const togglePlayPause = useCallback"),
      page.indexOf("const handleStandbyResume = useCallback"),
    );
    expect(toggle).toContain("holdPlayback()");
  });

  it("stops the old station when a card opens a playlist", () => {
    for (const name of [
      "const openMixPreview = useCallback",
      "const openInspiredPreview = useCallback",
      "const openStationPreview = useCallback",
    ]) {
      const start = page.indexOf(name);
      const body = page.slice(start, start + 500);
      expect(body).toContain("holdPlayback()");
    }
  });

  it("refuses an empty preset list before it would replace the station", () => {
    const start = page.indexOf("const launchFromPresetPreview = useCallback");
    const end = page.indexOf("useEffect(() => {", start);
    const body = page.slice(start, end);
    expect(body.indexOf("editedTracks.length === 0")).toBeGreaterThan(-1);
    expect(body.indexOf("editedTracks.length === 0")).toBeLessThan(
      body.indexOf("beginStationSession"),
    );
    expect(body).toContain("emptyPlaylistNotice");
    expect(body).toContain("holdPlayback()");
  });

  it("checks the gate before the host or a stall skip can start music", () => {
    expect(player).toContain('reason: "host-release"');
    expect(player).toContain('reason: "stall-recovery"');
    expect(player).toContain('decision === "wait"');
  });
});

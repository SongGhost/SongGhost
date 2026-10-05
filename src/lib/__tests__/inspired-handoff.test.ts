import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { Station, StationTrack } from "@/data/stations";
import {
  inspiredFailureNotice,
  inspiredYieldState,
  performInspiredStationClick,
} from "@/lib/inspired-handoff";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PREVIOUS_TITLE = "Hunting High and Low";

type OnAir = {
  isPlaying: boolean;
  queueTitles: string[];
  title: string;
  artist: string;
};

function liveSession(): OnAir {
  return {
    isPlaying: true,
    queueTitles: [PREVIOUS_TITLE],
    title: PREVIOUS_TITLE,
    artist: "a-ha",
  };
}

function applyYield(session: OnAir, stationName: string) {
  const next = inspiredYieldState(stationName);
  session.isPlaying = next.isPlaying;
  session.queueTitles = [...next.queue];
  session.title = next.nowPlaying.title;
  session.artist = next.nowPlaying.artist;
}

function applyFailure(session: OnAir, notice: { title: string; detail: string }) {
  session.isPlaying = false;
  session.queueTitles = [];
  session.title = notice.title;
  session.artist = notice.detail;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const playableTracks: StationTrack[] = [
  { title: "N.Y. State of Mind", artist: "Nas", youtubeId: "nas1" },
  { title: "It Was a Good Day", artist: "Ice Cube", youtubeId: "cube1" },
];

describe("Inspired station click", () => {
  it("takes the previous song off the air before the playlist returns", async () => {
    const session = liveSession();
    let fetchReturned = false;
    const pending = performInspiredStationClick({
      stationName: "90s Boom Bap",
      body: { genres: ["Hip-Hop"] },
      fetchImpl: () =>
        new Promise((resolve) => {
          expect(session.isPlaying).toBe(false);
          expect(session.queueTitles).toEqual([]);
          expect(session.title).toBe("90s Boom Bap");
          expect(session.title).not.toBe(PREVIOUS_TITLE);
          fetchReturned = true;
          resolve(jsonResponse({ error: "No tracks found" }, 422));
        }),
      onYield: (stationName) => applyYield(session, stationName),
      onLaunch: () => {
        throw new Error("failed lookup must not launch");
      },
    });

    const outcome = await pending;
    expect(fetchReturned).toBe(true);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) applyFailure(session, outcome.notice);

    expect(session.isPlaying).toBe(false);
    expect(session.queueTitles).not.toContain(PREVIOUS_TITLE);
    expect(session.title).toBe("Couldn't start 90s Boom Bap");
    expect(session.artist).not.toBe("a-ha");
    expect(session.artist.toLowerCase()).toContain("nothing is playing");
  });

  it("does not launch an empty queue", async () => {
    const session = liveSession();
    const onLaunch = vi.fn();
    const outcome = await performInspiredStationClick({
      stationName: "Trap Heavy",
      body: { genres: ["Trap"] },
      fetchImpl: async () => jsonResponse({ station: { id: "inspired-trap-heavy-1" }, tracks: [] }),
      onYield: (stationName) => applyYield(session, stationName),
      onLaunch,
    });

    expect(onLaunch).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.notice.title).toBe("Couldn't start Trap Heavy");
      expect(inspiredFailureNotice("Trap Heavy", "No tracks found").detail).toContain(
        "No songs turned up",
      );
    }
    expect(session.title).not.toBe(PREVIOUS_TITLE);
    expect(session.queueTitles).toEqual([]);
  });

  it("launches only when the playlist has songs", async () => {
    const session = liveSession();
    const onLaunch = vi.fn();
    const station = {
      id: "generated",
      name: "Generated",
      tracks: playableTracks,
    } as Station;
    const outcome = await performInspiredStationClick({
      stationName: "Conscious Rhymes",
      body: { genres: ["Hip-Hop"] },
      fetchImpl: async () => jsonResponse({ station, tracks: playableTracks }),
      onYield: (stationName) => applyYield(session, stationName),
      onLaunch,
    });

    expect(outcome.ok).toBe(true);
    expect(onLaunch).toHaveBeenCalledTimes(1);
    const launched = onLaunch.mock.calls[0]?.[0] as { tracks: StationTrack[] };
    expect(launched.tracks.map((track) => track.title)).toEqual([
      "N.Y. State of Mind",
      "It Was a Good Day",
    ]);
    expect(launched.tracks[0]?.title).not.toBe(PREVIOUS_TITLE);
    expect(session.queueTitles).not.toContain(PREVIOUS_TITLE);
  });
});

describe("Inspired launch wiring", () => {
  it("stops the old station before a direct launch and refuses an empty preview queue", () => {
    const page = readFileSync(resolve(root, "src/app/page.tsx"), "utf8");
    const directStart = page.indexOf("const launchInspiredStation = useCallback");
    const directEnd = page.indexOf("const openInspiredPreview = useCallback");
    const directBody = page.slice(directStart, directEnd);
    expect(directBody).toContain("performInspiredStationClick");
    expect(directBody).toContain("onYield: yieldAirForInspired");
    expect(directBody).toContain("showInspiredFailure");
    expect(directBody).toContain("beginStationSession(");

    const previewStart = page.indexOf("const launchFromInspiredPreview = useCallback");
    const previewEnd = page.indexOf("const openStationPreview = useCallback");
    const previewBody = page.slice(previewStart, previewEnd);
    expect(previewBody.indexOf("editedTracks.length === 0")).toBeGreaterThan(-1);
    expect(previewBody.indexOf("editedTracks.length === 0")).toBeLessThan(
      previewBody.indexOf("beginStationSession"),
    );
    expect(previewBody).toContain("showInspiredFailure");
    expect(previewBody).toContain("silenceForArtistRadio()");
    expect(previewBody).toContain("editedTracks");
  });
});

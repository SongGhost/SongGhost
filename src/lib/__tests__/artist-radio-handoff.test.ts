import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { isArtistRadioStationId, type ArtistRadioResult } from "@/lib/artist-radio";
import {
  artistRadioClickStillCurrent,
  artistRadioFailureNotice,
  artistRadioYieldState,
  performArtistRadioClick,
} from "@/lib/artist-radio-handoff";
import { shownDeckArtist, shownDeckTitle } from "@/lib/deck-display";

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

function applyYield(session: OnAir, artistName: string) {
  const next = artistRadioYieldState(artistName);
  session.isPlaying = next.isPlaying;
  session.queueTitles = next.queue.map((track) => track.title);
  session.title = next.nowPlaying.title;
  session.artist = next.nowPlaying.artist;
}

function applyFailure(session: OnAir, notice: { title: string; detail: string }) {
  session.isPlaying = false;
  session.queueTitles = [];
  session.title = notice.title;
  session.artist = notice.detail;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const madonnaStation: ArtistRadioResult = {
  artistName: "Madonna",
  mode: "mixed",
  personaId: "standard-broadcast",
  tracks: [
    { title: "Holiday", artist: "Madonna", youtubeId: "mad1" },
    { title: "1999", artist: "Prince", youtubeId: "pri1" },
  ],
  station: {
    id: "artist-radio-madonna",
    name: "Artist Radio: Madonna",
    frequency: 99.9,
    category: "genres",
    defaultPersonaId: "standard-broadcast",
    accentColor: "#FF0055",
    youtubeVideoId: "mad1",
    description: "Artist Radio: Madonna",
    tracks: [
      { title: "Holiday", artist: "Madonna", youtubeId: "mad1" },
      { title: "1999", artist: "Prince", youtubeId: "pri1" },
    ],
  },
};

describe("Artist Radio click", () => {
  it("takes the previous queue off the air while /api/artist-radio is still in flight", async () => {
    const session = liveSession();
    let launched = false;
    let fetchReturned = false;

    const pending = performArtistRadioClick({
      artistName: "Madonna",
      requestUrl: "/api/artist-radio?artist=Madonna&mode=mixed",
      fetchImpl: () =>
        new Promise<Response>((resolveResponse) => {
          setTimeout(() => {
            fetchReturned = true;
            resolveResponse(jsonResponse(madonnaStation, 200));
          }, 30);
        }),
      onYield: (name) => applyYield(session, name),
      onLaunch: () => {
        launched = true;
      },
    });

    expect(fetchReturned).toBe(false);
    expect(launched).toBe(false);
    expect(session.isPlaying).toBe(false);
    expect(session.queueTitles).toEqual([]);
    expect(session.queueTitles).not.toContain(PREVIOUS_TITLE);
    expect(session.title).toBe("Madonna");
    expect(session.artist).toBe("Artist Radio");

    await pending;
  });

  it("does not launch or restore the old station when the lookup fails, including the two-artist refusal", async () => {
    const session = liveSession();
    const onLaunch = vi.fn();
    const twoArtistError =
      'Could not expand "Madonna" into a multi-artist radio station.';

    const outcome = await performArtistRadioClick({
      artistName: "Madonna",
      requestUrl: "/api/artist-radio?artist=Madonna&mode=mixed",
      fetchImpl: async () => jsonResponse({ error: twoArtistError }, 404),
      onYield: (name) => applyYield(session, name),
      onLaunch,
    });

    expect(onLaunch).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) applyFailure(session, outcome.notice);

    expect(session.isPlaying).toBe(false);
    expect(session.queueTitles).toEqual([]);
    expect(session.title).not.toBe(PREVIOUS_TITLE);
    expect(session.artist).not.toBe("a-ha");
    expect(session.title).toBe("Couldn't start Madonna");
    expect(session.artist).toBe("Artist Radio didn't start. Nothing is playing.");
    expect(artistRadioFailureNotice("Madonna", twoArtistError).detail).not.toMatch(
      /multi-artist/i,
    );
  });

  it("keeps the previous song title off the deck after a failed launch", () => {
    const notice = artistRadioFailureNotice(
      "Prince",
      'Could not expand "Prince" into a multi-artist radio station.',
    );
    const title = shownDeckTitle({
      title: notice.title,
      orchestratorTitle: "REWIND ✨ 80s Nostalgic Synth Pop",
    });
    const artist = shownDeckArtist({
      title: notice.title,
      artist: notice.detail,
      orchestratorArtist: "VynTrix",
    });

    expect(title).toBe("Couldn't start Prince");
    expect(title).not.toContain("REWIND");
    expect(artist).not.toContain("VynTrix");
    expect(artist).toBe("Artist Radio didn't start. Nothing is playing.");
  });

  it("does not treat Tuning in… as the previous track", () => {
    expect(
      shownDeckTitle({
        title: "Tuning in…",
        orchestratorTitle: PREVIOUS_TITLE,
      }),
    ).toBe("Tuning in…");
    expect(
      shownDeckArtist({
        title: "Tuning in…",
        artist: "Artist Radio: Madonna",
        orchestratorArtist: "a-ha",
      }),
    ).toBe("Artist Radio: Madonna");
  });

  it("does not open a mix on a neighbor when the seed song is missing", async () => {
    const session = liveSession();
    const onLaunch = vi.fn();
    const neighborFirst: ArtistRadioResult = {
      ...madonnaStation,
      artistName: "Nirvana",
      tracks: [
        { title: "Plush", artist: "Stone Temple Pilots", youtubeId: "plush111111" },
        { title: "Teen Spirit", artist: "Nirvana", youtubeId: "" },
      ],
    };

    const outcome = await performArtistRadioClick({
      artistName: "Nirvana",
      stationLabel: "Artist Mix",
      requestUrl: "/api/artist-radio?artist=Nirvana&mode=mixed",
      fetchImpl: async () => jsonResponse(neighborFirst, 200),
      onYield: (name) => applyYield(session, name),
      onLaunch,
    });

    expect(onLaunch).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) applyFailure(session, outcome.notice);

    expect(session.isPlaying).toBe(false);
    expect(session.queueTitles).toEqual([]);
    expect(session.title).toBe("Couldn't start Nirvana");
    expect(session.artist).toBe(
      "No playable song by Nirvana to open this mix. Nothing is playing.",
    );
    expect(session.title).not.toBe("Plush");
    expect(session.artist).not.toBe("Stone Temple Pilots");
  });

  it("sends a successful track list into the artist-radio station start", async () => {
    const onLaunch = vi.fn();
    const outcome = await performArtistRadioClick({
      artistName: "Madonna",
      requestUrl: "/api/artist-radio?artist=Madonna&mode=mixed",
      fetchImpl: async () => jsonResponse(madonnaStation, 200),
      onYield: () => {},
      onLaunch,
    });

    expect(outcome.ok).toBe(true);
    expect(onLaunch).toHaveBeenCalledTimes(1);
    const launched = onLaunch.mock.calls[0][0] as ArtistRadioResult;
    expect(launched.tracks.map((track) => track.title)).toEqual(["Holiday", "1999"]);
    expect(isArtistRadioStationId(launched.station.id)).toBe(true);
    expect(launched.tracks[0]?.title).not.toBe(PREVIOUS_TITLE);
  });

  it("a newer station start wins over a lookup that began earlier", () => {
    expect(artistRadioClickStillCurrent(0, 0)).toBe(true);
    expect(artistRadioClickStillCurrent(0, 1)).toBe(false);
  });
});

describe("home playlist chips", () => {
  it("swaps from tracks already in hand and does not wait on /api/artist-radio", () => {
    const page = readFileSync(resolve(root, "src/app/page.tsx"), "utf8");
    const selectStart = page.indexOf("const selectStation = useCallback");
    const selectEnd = page.indexOf("const openShareForStation");
    const selectBody = page.slice(selectStart, selectEnd);
    expect(selectBody).toContain("beginStationSession(station, station.tracks");
    expect(selectBody).not.toContain("/api/artist-radio");
    expect(selectBody).not.toContain("performArtistRadioClick");

    const browser = readFileSync(
      resolve(root, "src/components/studio/StationBrowser.tsx"),
      "utf8",
    );
    expect(browser).toContain("onSelect(station, e)");
    expect(browser).not.toContain("/api/artist-radio");

    const yieldStart = page.indexOf("const yieldAirForArtistRadio = useCallback");
    const yieldEnd = page.indexOf("const showArtistRadioFailure = useCallback");
    const yieldBody = page.slice(yieldStart, yieldEnd);
    expect(yieldBody).not.toContain("beginStationSession");

    const launchStart = page.indexOf("const launchArtistRadio = useCallback");
    const launchEnd = page.indexOf("* Song Radio:");
    const launchBody = page.slice(launchStart, launchEnd);
    expect(launchBody).toContain("beginStationSession(");
    expect(launchBody).toContain("result.tracks");

    const queue = readFileSync(resolve(root, "src/hooks/useStationQueue.ts"), "utf8");
    expect(queue).toContain("if (isArtistRadioStation(stationIdRef.current))");
    expect(queue).toContain("isArtistRadioStationId as isArtistRadioStation");
  });
});

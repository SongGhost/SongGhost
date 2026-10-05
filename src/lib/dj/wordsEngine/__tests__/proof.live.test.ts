/**
 * Real breaks for the New host. Skipped unless NEW_HOST_PROOF=1.
 * Needs OPENAI_API_KEY in .env.local. Does not print the key.
 */
import { config } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveNewWordsFromBody, type NewWordsResult } from "../handleRequest";
import { clearSheetCache, loadBreakSheet } from "../sheet";
import { clearStationMemory } from "../stationMemory";

config({ path: ".env.local" });

const LIVE = process.env.NEW_HOST_PROOF === "1";

type Song = { title: string; artist: string; album?: string };

type Row = {
  title: string;
  artist: string;
  persona: string;
  mode: string;
  script: string;
  gate: string;
  sheetMs: number;
  writeMs: number;
  costUsd: number;
  sources: NewWordsResult["sources"];
  openTease: NewWordsResult["openTease"];
  spokenTopics: string[];
};

const NATIONAL: Song[] = [
  { title: "New Order T-Shirt", artist: "The National", album: "First Two Pages of Frankenstein" },
  { title: "Ice Machines", artist: "The National", album: "First Two Pages of Frankenstein" },
  { title: "So Far So Fast", artist: "The National", album: "First Two Pages of Frankenstein" },
  { title: "Bloodbuzz Ohio", artist: "The National", album: "High Violet" },
  { title: "I Need My Girl", artist: "The National", album: "Trouble Will Find Me" },
];

const ARETHA: Song[] = [
  { title: "Respect", artist: "Aretha Franklin", album: "I Never Loved a Man the Way I Love You" },
  { title: "(You Make Me Feel Like) A Natural Woman", artist: "Aretha Franklin", album: "Lady Soul" },
];

const THIN_CANDIDATES: Song[] = [
  { title: "New Hell", artist: "Greet Death" },
  { title: "Ruby", artist: "Hovvdy" },
  { title: "Around You", artist: "Free Cake For Every Creature" },
];

function plan(song: Song, seconds: number) {
  return {
    kind: "song_intro" as const,
    transition: "full_break" as const,
    announceTracks: [{ title: song.title, artist: song.artist, ...(song.album ? { album: song.album } : {}) }],
    maxDurationSeconds: seconds,
    isSessionOpening: false,
  };
}

async function runStation(
  songs: Song[],
  opts: { stationId: string; format: string; host: string; persona: string; seconds: number },
): Promise<Row[]> {
  clearStationMemory();
  let topics: string[] = [];
  let ids: string[] = [];
  let tease: NewWordsResult["openTease"] = null;
  const rows: Row[] = [];
  for (let index = 0; index < songs.length; index += 1) {
    const song = songs[index]!;
    const next = songs[index + 1];
    const result = await resolveNewWordsFromBody(
      {
        songTitle: song.title,
        artistName: song.artist,
        ...(song.album ? { album: song.album } : {}),
        stationId: opts.stationId,
        stationName: "Proof Radio",
        commentaryFormat: opts.format,
        hostId: opts.host,
        research: "warm",
        spokenTopics: topics,
        stationSpokenIds: ids,
        ...(tease ? { openTease: tease } : {}),
        ...(next ? { nextTrack: { title: next.title, artist: next.artist, ...(next.album ? { album: next.album } : {}) } } : {}),
        segmentPlan: plan(song, opts.seconds),
      },
      "pro",
    );
    topics = result.spokenTopics ?? topics;
    ids = result.stationSpokenIds ?? ids;
    tease = result.openTease ?? null;
    const row: Row = {
      title: song.title,
      artist: song.artist,
      persona: opts.persona,
      mode: opts.format,
      script: result.script ?? "",
      gate: result.gate ?? "fallback",
      sheetMs: result.sheetMs ?? 0,
      writeMs: result.writeMs ?? 0,
      costUsd: result.costUsd ?? 0,
      sources: result.sources ?? [],
      openTease: result.openTease ?? null,
      spokenTopics: [...(result.spokenTopics ?? [])],
    };
    rows.push(row);
    console.log(`\nPROOF ${opts.persona} :: ${song.title}\n${row.script}\nGATE ${row.gate} SHEET ${row.sheetMs}ms WRITE ${row.writeMs}ms COST $${row.costUsd.toFixed(5)}`);
  }
  return rows;
}

describe.skipIf(!LIVE)("New host live proof", () => {
  it("speaks real breaks for The National, Aretha Franklin, and a thin sheet", async () => {
    expect(process.env.OPENAI_API_KEY?.trim()).toBeTruthy();
    clearSheetCache();
    clearStationMemory();

    const guide = await runStation(NATIONAL, {
      stationId: "proof-national-guide",
      format: "roots_branches",
      host: "warm-companion",
      persona: "Guide",
      seconds: 22,
    });
    const archivist = await runStation(NATIONAL, {
      stationId: "proof-national-archivist",
      format: "directors_cut",
      host: "the-musicologist",
      persona: "Archivist",
      seconds: 45,
    });
    const critic = await runStation([ARETHA[0]!], {
      stationId: "proof-aretha-critic",
      format: "roots_branches",
      host: "sarcastic-critic",
      persona: "Critic",
      seconds: 22,
    });
    const broadcast = await runStation([ARETHA[1]!], {
      stationId: "proof-aretha-broadcast",
      format: "roots_branches",
      host: "standard-broadcast",
      persona: "Broadcast",
      seconds: 22,
    });

    let thinSong = THIN_CANDIDATES[0]!;
    let thinClaims = Number.POSITIVE_INFINITY;
    for (const song of THIN_CANDIDATES) {
      const started = Date.now();
      const sheet = await loadBreakSheet({
        artist: song.artist,
        title: song.title,
        ...(song.album ? { album: song.album } : {}),
        waitMs: 25000,
      });
      const mains = sheet.claims.filter((claim) => claim.topic !== "release").length;
      console.log(`THIN PROBE ${song.artist} / ${song.title}: ${mains} story claims in ${Date.now() - started}ms`);
      if (mains < thinClaims) {
        thinClaims = mains;
        thinSong = song;
      }
      if (mains <= 1) break;
    }
    const thin = await runStation([thinSong], {
      stationId: "proof-thin",
      format: "roots_branches",
      host: "standard-broadcast",
      persona: "Broadcast",
      seconds: 22,
    });

    const report = { guide, archivist, critic, broadcast, thin, thinClaims };
    mkdirSync("tmp", { recursive: true });
    writeFileSync("tmp/new-host-proof.json", JSON.stringify(report, null, 2));

    expect(guide.every((row) => row.script.trim().length > 0)).toBe(true);
    expect(archivist.every((row) => row.script.trim().length > 0)).toBe(true);
    const paid = guide.some((row, index) => {
      const promise = guide[index - 1]?.openTease;
      if (!promise) return false;
      const token = promise.claim.toLowerCase().split(/[^a-z0-9']+/).find((word) => word.length > 4);
      return Boolean(token && row.script.toLowerCase().includes(token));
    });
    expect(paid).toBe(true);
    expect(thin[0]?.script.trim().length).toBeGreaterThan(0);
  }, 900000);
});

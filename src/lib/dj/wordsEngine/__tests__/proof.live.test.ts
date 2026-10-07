/**
 * Real breaks for the New host. Skipped unless NEW_HOST_PROOF=1.
 * Needs OPENAI_API_KEY in .env.local. Does not print the key.
 */
import { config } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isCreditRoll, wordCount } from "../gate";
import { spokenSkeleton } from "../prompt";
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
  usedFactIds: string[];
};

const NATIONAL_STEP5: Song[] = [
  { title: "This Isn't Helping (feat. Phoebe Bridgers)", artist: "The National", album: "First Two Pages of Frankenstein" },
  { title: "Tropic Morning News", artist: "The National", album: "First Two Pages of Frankenstein" },
  { title: "Oblivions", artist: "The National", album: "First Two Pages of Frankenstein" },
  { title: "New Order T-Shirt", artist: "The National", album: "First Two Pages of Frankenstein" },
  { title: "Start a War", artist: "The National", album: "Boxer" },
  { title: "Graceless", artist: "The National", album: "Trouble Will Find Me" },
  { title: "Bloodbuzz Ohio", artist: "The National", album: "High Violet" },
  { title: "I Need My Girl", artist: "The National", album: "Trouble Will Find Me" },
  { title: "Fake Empire", artist: "The National", album: "Boxer" },
  { title: "Mr. November", artist: "The National", album: "Alligator" },
];

const OTHER_STEP5: Song[] = [
  { title: "Holocene", artist: "Bon Iver", album: "Bon Iver, Bon Iver" },
  { title: "Re: Stacks", artist: "Bon Iver", album: "For Emma, Forever Ago" },
  { title: "Mystery of Love", artist: "Sufjan Stevens", album: "Call Me by Your Name" },
  { title: "Fourth of July", artist: "Sufjan Stevens", album: "Carrie & Lowell" },
  { title: "Garden Song", artist: "Phoebe Bridgers", album: "Punisher" },
];

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
        segmentPlan: { ...plan(song, opts.seconds), styleRotationIndex: index },
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
      usedFactIds: [...(result.usedFactIds ?? [])],
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

  it("speaks Guide Every Song five times and two Archivist Director's Cut breaks", async () => {
    expect(process.env.OPENAI_API_KEY?.trim()).toBeTruthy();
    clearSheetCache();
    clearStationMemory();
    const filler = /\b(?:unique|resonat\w*|showcas\w*|talents?|depth|discography|dynamic|heritage|intricate|multi-instrumental|collaborative effort|haunting|soundscape|iconic|groundbreaking|timeless|journey|vibes?|distinct character|draws you in|draw you in|sets the tone|set the mood|sets the mood|personal experiences?|really feel|rich sound|signature sound|adds to|adding to|dive into|dive in|stay tuned|stick around|evolution|growth|milestones?|distinctive|unique sound|deep emotions|emotions|emotional|relat(?:e|es|ed|ing) to|capturing|sets? the stage|shap(?:e|es|ed|ing) (?:the|their|its) (?:song|sound|music)|collaboration shap(?:e|es|ed|ing)|personal touch|expertise|(?:his|her|their) style|lyricist|remarkable|prowess|versatility|powerful|captivating|incredible|(?:his|her|their) touch|lends (?:his|her|their) voice)\b/i;
    const skeletonBan = /when the song opens|because that is the part to hear|so listen for\b/i;
    const guideSongs = NATIONAL;
    const cutSongs: Song[] = [
      { title: "I Need My Girl", artist: "The National", album: "Trouble Will Find Me" },
      { title: "Fake Empire", artist: "The National", album: "Boxer" },
    ];
    const welcome = await resolveNewWordsFromBody(
      {
        songTitle: guideSongs[0]!.title,
        artistName: guideSongs[0]!.artist,
        album: guideSongs[0]!.album,
        stationName: "Proof Radio",
        commentaryFormat: "roots_branches",
        hostId: "warm-companion",
        segmentPlan: { ...plan(guideSongs[0]!, 12), isSessionOpening: true },
      },
      "pro",
    );
    console.log(`\nWELCOME\n${welcome.script}\n`);
    expect(welcome.script?.trim().length).toBeGreaterThan(0);
    expect(welcome.fellBack).toBe(false);

    const guide = await runStation(guideSongs, {
      stationId: "proof-national-guide-every",
      format: "roots_branches",
      host: "warm-companion",
      persona: "Guide",
      seconds: 20,
    });
    const cut = await runStation(cutSongs, {
      stationId: "proof-national-archivist",
      format: "directors_cut",
      host: "the-musicologist",
      persona: "Archivist",
      seconds: 30,
    });
    const rows = [...guide, ...cut];
    const rates = {
      pass: rows.filter((row) => row.gate === "pass").length,
      retry: rows.filter((row) => row.gate === "retry").length,
      fallback: rows.filter((row) => row.gate === "fallback").length,
    };
    console.log(`\nGATE RATES pass=${rates.pass} retry=${rates.retry} fallback=${rates.fallback}`);
    mkdirSync("tmp", { recursive: true });
    writeFileSync("tmp/new-host-proof.json", JSON.stringify({
      welcome: welcome.script,
      guide,
      directorsCut: cut,
      rates,
    }, null, 2));
    const guideSkeletons = new Set<string>();
    for (const row of guide) {
      const words = wordCount(row.script);
      expect(row.script.trim().length).toBeGreaterThan(0);
      expect(filler.test(row.script)).toBe(false);
      expect(skeletonBan.test(row.script)).toBe(false);
      expect(isCreditRoll(row.script)).toBe(false);
      expect(words).toBeGreaterThanOrEqual(12);
      expect(words).toBeLessThanOrEqual(50);
      guideSkeletons.add(spokenSkeleton(row.script));
      console.log(`WORDS ${row.title} ${words} FACTS ${row.usedFactIds.join(",")}`);
    }
    expect(guideSkeletons.size).toBe(guide.length);
    const storyBreaks = guide.filter((row) => row.usedFactIds.some((id) =>
      id.startsWith("album_story")
      || id.startsWith("song_story")
      || id.startsWith("connections:")
      || id === "producer"
      || id === "studio"
      || id === "label"
      || /lyric|guest|studio|producer|label/.test(id),
    ));
    expect(storyBreaks.length).toBeGreaterThanOrEqual(3);
    for (const row of cut) {
      const words = wordCount(row.script);
      expect(row.script.trim().length).toBeGreaterThan(0);
      expect(filler.test(row.script)).toBe(false);
      expect(isCreditRoll(row.script)).toBe(false);
      expect(row.script).toMatch(/\b(?:lineage|recorded|produced|formed|credited|album|before|after|member|in \d{4})\b/i);
      expect(words).toBeGreaterThanOrEqual(18);
      expect(words).toBeLessThanOrEqual(90);
      console.log(`WORDS ${row.title} ${words} FACTS ${row.usedFactIds.join(",")}`);
    }
    expect(welcome.script).toContain(guideSongs[0]!.title);
    expect(welcome.script).toContain("The National");
    expect(welcome.script?.endsWith(".") || welcome.script?.endsWith("!")).toBe(true);
  }, 900000);

  it("speaks ten National breaks and five from another artist", async () => {
    expect(process.env.OPENAI_API_KEY?.trim()).toBeTruthy();
    clearSheetCache();
    clearStationMemory();
    const national = await runStation(NATIONAL_STEP5, {
      stationId: "proof-step5-national",
      format: "directors_cut",
      host: "warm-companion",
      persona: "Guide",
      seconds: 30,
    });
    const other = await runStation(OTHER_STEP5, {
      stationId: "proof-step5-other",
      format: "directors_cut",
      host: "warm-companion",
      persona: "Guide",
      seconds: 30,
    });
    const rows = [...national, ...other];
    const rates = {
      pass: rows.filter((row) => row.gate === "pass").length,
      retry: rows.filter((row) => row.gate === "retry").length,
      fallback: rows.filter((row) => row.gate === "fallback").length,
    };
    console.log(`\nSTEP5 RATES pass=${rates.pass} retry=${rates.retry} fallback=${rates.fallback} of ${rows.length}`);
    mkdirSync("tmp", { recursive: true });
    writeFileSync("tmp/new-host-step5.json", JSON.stringify({ national, other, rates }, null, 2));
    const banned = /album number|number of the album|recognized for|known for its|influential roster|acclaimed|After that,|Artist Radio/i;
    for (const row of rows) {
      expect(row.script.trim().length).toBeGreaterThan(0);
      expect(row.script).not.toMatch(banned);
      expect(row.script).not.toMatch(/\(feat\./i);
    }
    const helping = national[0]?.script ?? "";
    expect(helping).toMatch(/Phoebe/i);
    expect(helping).not.toMatch(/Sufjan/i);
  }, 900000);
});

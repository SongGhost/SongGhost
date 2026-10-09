/**
 * Real breaks for the New host. Skipped unless NEW_HOST_PROOF=1.
 * Needs OPENAI_API_KEY in .env.local. Does not print the key.
 */
import { config } from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { claimsFromProse } from "../claims";
import { isCreditRoll, wordCount } from "../gate";
import { spokenSkeleton } from "../prompt";
import { resolveNewWordsFromBody, type NewWordsResult } from "../handleRequest";
import { clearSheetCache, loadBreakSheet } from "../sheet";
import { clearStationMemory, parseStationIds } from "../stationMemory";
import type { FactPack } from "../types";
import {
  cannedSongHandoff,
  connectorKeys,
  hasBareFragment,
  hasStandaloneCue,
  hasStockConnector,
  listenForMisses,
  restatesFact,
  sentenceShapes,
} from "../variety";
import { wikipediaSearchTitle, wikipediaSummary } from "../wiki";

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
  factType: string;
  stationSpokenIds: string[];
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

const NATIONAL_STEP6: Song[] = [
  { title: "Bloodbuzz Ohio", artist: "The National", album: "High Violet" },
  { title: "Fake Empire", artist: "The National", album: "Boxer" },
  { title: "Mr. November", artist: "The National", album: "Alligator" },
  { title: "I Need My Girl", artist: "The National", album: "Trouble Will Find Me" },
  { title: "Graceless", artist: "The National", album: "Trouble Will Find Me" },
  { title: "Start a War", artist: "The National", album: "Boxer" },
  { title: "About Today", artist: "The National", album: "Cherry Tree" },
  { title: "Don't Swallow the Cap", artist: "The National", album: "Trouble Will Find Me" },
  { title: "The System Only Dreams in Total Darkness", artist: "The National", album: "Sleep Well Beast" },
  { title: "Tropic Morning News", artist: "The National", album: "First Two Pages of Frankenstein" },
  { title: "Light Years", artist: "The National", album: "I Am Easy to Find" },
  { title: "Vanderlyle Crybaby Geeks", artist: "The National", album: "High Violet" },
];

const BON_IVER_STEP6: Song[] = [
  { title: "Holocene", artist: "Bon Iver", album: "Bon Iver, Bon Iver" },
  { title: "Re: Stacks", artist: "Bon Iver", album: "For Emma, Forever Ago" },
  { title: "Skinny Love", artist: "Bon Iver", album: "For Emma, Forever Ago" },
  { title: "Perth", artist: "Bon Iver", album: "Bon Iver, Bon Iver" },
  { title: "Hey, Ma", artist: "Bon Iver", album: "i,i" },
  { title: "Flume", artist: "Bon Iver", album: "For Emma, Forever Ago" },
];

const THIN_CANDIDATES: Song[] = [
  { title: "New Hell", artist: "Greet Death" },
  { title: "Ruby", artist: "Hovvdy" },
  { title: "Around You", artist: "Free Cake For Every Creature" },
];

function thinPack(song: Song, sheet: FactPack["sheet"]): FactPack {
  return {
    engine: "new",
    depth: "roots_branches",
    maxNuggets: 1,
    personaId: "warm-companion",
    shape: "lore",
    shapeVariant: 0,
    includeStationId: false,
    now: { title: song.title, artist: song.artist, ...(song.album ? { album: song.album } : {}) },
    songOneExit: false,
    recapLines: [],
    nuggets: [],
    sheet,
    nextSheet: [],
    passages: [],
    allowExplicit: false,
    allowedYears: [],
    length: { minWords: 12, maxWords: 80 },
    sessionOpening: false,
  };
}

async function leadOnlyCount(song: Song): Promise<number> {
  const found = await wikipediaSearchTitle(`"${song.title}" ${song.artist}`);
  if (!found) return 0;
  const page = await wikipediaSummary(found);
  if (!page?.extract) return 0;
  return claimsFromProse({
    text: page.extract,
    subject: song.title,
    kind: "song",
    artistName: song.artist,
    sourceUrl: page.url,
  }).length;
}

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
      factType: result.factType ?? "",
      stationSpokenIds: [...(result.stationSpokenIds ?? [])],
    };
    rows.push(row);
    console.log(`\nPROOF ${opts.persona} :: ${song.title} [${row.factType || "none"}]\n${row.script}\nGATE ${row.gate} SHEET ${row.sheetMs}ms WRITE ${row.writeMs}ms COST $${row.costUsd.toFixed(5)}`);
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
    for (let index = 1; index < guide.length; index += 1) {
      const promise = guide[index - 1]?.openTease;
      if (!promise) continue;
      expect(restatesFact(guide[index]!.script, promise)).toBe(false);
    }
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

  it("speaks twelve National breaks and six from Bon Iver without a repeated fact or connector", async () => {
    expect(process.env.OPENAI_API_KEY?.trim()).toBeTruthy();
    clearSheetCache();
    clearStationMemory();
    const national = await runStation(NATIONAL_STEP6, {
      stationId: "proof-step6-national",
      format: "roots_branches",
      host: "warm-companion",
      persona: "Guide",
      seconds: 22,
    });
    const neighbor = await runStation(BON_IVER_STEP6, {
      stationId: "proof-step6-bon-iver",
      format: "roots_branches",
      host: "warm-companion",
      persona: "Guide",
      seconds: 22,
    });

    const depthSongs = [...NATIONAL_STEP6.slice(0, 5), ...BON_IVER_STEP6.slice(0, 2)];
    const depth: Array<{ title: string; artist: string; leadOnly: number; sheet: number; byTopic: Record<string, number> }> = [];
    for (const song of depthSongs) {
      const sheet = await loadBreakSheet({
        artist: song.artist,
        title: song.title,
        ...(song.album ? { album: song.album } : {}),
        waitMs: 20000,
      });
      const byTopic: Record<string, number> = {};
      for (const claim of sheet.claims) {
        byTopic[claim.topic] = (byTopic[claim.topic] ?? 0) + 1;
      }
      const leadOnly = await leadOnlyCount(song);
      depth.push({ title: song.title, artist: song.artist, leadOnly, sheet: sheet.claims.length, byTopic });
      console.log(`SHEET ${song.artist} / ${song.title}: lead ${leadOnly} full ${sheet.claims.length} ${JSON.stringify(byTopic)}`);
    }

    const rates = {
      pass: [...national, ...neighbor].filter((row) => row.gate === "pass").length,
      retry: [...national, ...neighbor].filter((row) => row.gate === "retry").length,
      fallback: [...national, ...neighbor].filter((row) => row.gate === "fallback").length,
    };
    console.log(`\nSTEP6 RATES pass=${rates.pass} retry=${rates.retry} fallback=${rates.fallback}`);
    mkdirSync("tmp", { recursive: true });
    writeFileSync("tmp/new-host-step6.json", JSON.stringify({ national, neighbor, rates, depth }, null, 2));

    async function assertStation(label: string, rows: Row[], songs: Song[]) {
      const seenFacts = new Set<string>();
      const seenClaims = new Set<string>();
      const seenConnectors = new Set<string>();
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]!;
        const song = songs[index]!;
        const sheet = await loadBreakSheet({
          artist: song.artist,
          title: song.title,
          ...(song.album ? { album: song.album } : {}),
          waitMs: 5000,
        });
        const pack = thinPack(song, sheet.claims);
        expect(row.script.trim().length, `${label} ${song.title}`).toBeGreaterThan(0);
        expect(hasStockConnector(row.script), row.script).toBe(false);
        expect(hasBareFragment(row.script, pack), row.script).toBe(false);
        expect(listenForMisses(row.script, pack), row.script).toBe(false);
        expect(row.script).not.toMatch(/\bfor instruments?\b/i);
        const parsed = parseStationIds(row.stationSpokenIds);
        expect(new Set(parsed.factKeys).size, `${song.title} fact ledger`).toBe(parsed.factKeys.length);
        for (const id of row.usedFactIds) {
          expect(seenClaims.has(id), `${song.title} reused ${id}`).toBe(false);
        }
        const grew = parsed.factKeys.filter((key) => !seenFacts.has(key));
        expect(grew.length, `${song.title} did not add a new fact`).toBeGreaterThan(0);
        for (const key of connectorKeys(row.script, pack)) {
          expect(seenConnectors.has(key), `${song.title} reused connector "${key}"`).toBe(false);
          seenConnectors.add(key);
        }
        if (index > 0) {
          const promise = rows[index - 1]?.openTease;
          if (promise) expect(restatesFact(row.script, promise), row.script).toBe(false);
        }
        for (const id of parsed.claimIds) seenClaims.add(id);
        for (const key of parsed.factKeys) seenFacts.add(key);
      }
    }
    await assertStation("national", national, NATIONAL_STEP6);
    await assertStation("neighbor", neighbor, BON_IVER_STEP6);
  }, 1200000);

  it("step 7: wide station 12 breaks, then National artist radio 6", async () => {
    expect(process.env.OPENAI_API_KEY?.trim()).toBeTruthy();
    clearSheetCache();
    clearStationMemory();
    const wide: Song[] = [
      { title: "Vanderlyle Crybaby Geeks", artist: "The National", album: "High Violet" },
      { title: "Soul Meets Body", artist: "Death Cab for Cutie", album: "Plans" },
      { title: "Skinny Love", artist: "Bon Iver", album: "For Emma, Forever Ago" },
      { title: "I Will Follow You Into the Dark", artist: "Death Cab for Cutie", album: "Plans" },
      { title: "Rosyln", artist: "Bon Iver & St. Vincent", album: "The Twilight Saga: New Moon" },
      { title: "Fake Empire", artist: "The National", album: "Boxer" },
      { title: "Transatlanticism", artist: "Death Cab for Cutie", album: "Transatlanticism" },
      { title: "Holocene", artist: "Bon Iver", album: "Bon Iver, Bon Iver" },
      { title: "Bloodbuzz Ohio", artist: "The National", album: "High Violet" },
      { title: "Crooked Teeth", artist: "Death Cab for Cutie", album: "Plans" },
      { title: "Flume", artist: "Bon Iver", album: "For Emma, Forever Ago" },
      { title: "I Need My Girl", artist: "The National", album: "Trouble Will Find Me" },
    ];
    const artistRadio: Song[] = [
      { title: "About Today", artist: "The National", album: "Cherry Tree" },
      { title: "Mr. November", artist: "The National", album: "Alligator" },
      { title: "Start a War", artist: "The National", album: "Boxer" },
      { title: "Graceless", artist: "The National", album: "Trouble Will Find Me" },
      { title: "Don't Swallow the Cap", artist: "The National", album: "Trouble Will Find Me" },
      { title: "The System Only Dreams in Total Darkness", artist: "The National", album: "Sleep Well Beast" },
    ];
    const dumpTitles = new Set([
      "Soul Meets Body",
      "Skinny Love",
      "Rosyln",
      "I Will Follow You Into the Dark",
    ]);
    for (const song of wide) {
      if (!dumpTitles.has(song.title)) continue;
      const sheet = await loadBreakSheet({
        artist: song.artist,
        title: song.title,
        ...(song.album ? { album: song.album } : {}),
        waitMs: 25000,
      });
      console.log(`\nSHEET ${song.title} / ${song.artist}`);
      for (const claim of sheet.claims) {
        console.log(`  [${claim.topic}] ${claim.claim}`);
      }
    }
    const wideRows = await runStation(wide, {
      stationId: "step7-wide",
      format: "directors_cut",
      host: "warm-companion",
      persona: "Guide",
      seconds: 30,
    });
    const radioRows = await runStation(artistRadio, {
      stationId: "step7-artist-radio",
      format: "directors_cut",
      host: "warm-companion",
      persona: "Guide",
      seconds: 30,
    });
    function checkStation(label: string, rows: Row[], songs: Song[]) {
      const shapes = new Set<string>();
      let retries = 0;
      const teases: string[] = [];
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]!;
        const song = songs[index]!;
        if (row.gate === "retry") retries += 1;
        expect(row.script.trim().length, `${label} ${song.title}`).toBeGreaterThan(0);
        expect(cannedSongHandoff(row.script), row.script).toBe(false);
        expect(hasStandaloneCue(row.script), row.script).toBe(false);
        expect(row.script, row.script).not.toMatch(/\bis credited on\b/i);
        expect(row.script, row.script).not.toMatch(/\bthe song is\b.+\bfrom\b/i);
        const pack = thinPack(song, []);
        for (const shape of sentenceShapes(row.script, pack)) {
          expect(shapes.has(shape), `${label} repeated shape "${shape}" in ${row.script}`).toBe(false);
          shapes.add(shape);
        }
        const promise = index > 0 ? rows[index - 1]?.openTease : null;
        if (promise) {
          teases.push(`${rows[index - 1]!.title} teased: ${promise.claim} → ${song.title}: ${row.script}`);
          expect(restatesFact(row.script, { id: promise.claimId, claim: promise.claim }), row.script).toBe(false);
        }
        console.log(`STEP7 ${label} | ${row.persona} | ${row.factType || "none"} | ${row.gate}\n${row.script}`);
      }
      console.log(`\nSTEP7 ${label} retries=${retries} shapes=${shapes.size}`);
      for (const line of teases) console.log(`TEASE ${line}`);
      return { retries, shapes: shapes.size, teases };
    }
    const wideCheck = checkStation("wide", wideRows, wide);
    const radioCheck = checkStation("artist-radio", radioRows, artistRadio);
    const rates = {
      pass: [...wideRows, ...radioRows].filter((row) => row.gate === "pass").length,
      retry: [...wideRows, ...radioRows].filter((row) => row.gate === "retry").length,
      fallback: [...wideRows, ...radioRows].filter((row) => row.gate === "fallback").length,
    };
    mkdirSync("tmp", { recursive: true });
    writeFileSync("tmp/new-host-step7.json", JSON.stringify({
      wide: wideRows,
      artistRadio: radioRows,
      rates,
      wideCheck,
      radioCheck,
    }, null, 2));
    console.log(`\nSTEP7 RATES pass=${rates.pass} retry=${rates.retry} fallback=${rates.fallback}`);
    expect(rates.pass + rates.retry + rates.fallback).toBe(18);
  }, 1200000);

  it("step 8: wide station 12 breaks, then National artist radio 6", async () => {
    expect(process.env.OPENAI_API_KEY?.trim()).toBeTruthy();
    clearSheetCache();
    clearStationMemory();
    const wide: Song[] = [
      { title: "Vanderlyle Crybaby Geeks", artist: "The National", album: "High Violet" },
      { title: "Soul Meets Body", artist: "Death Cab for Cutie", album: "Plans" },
      { title: "Skinny Love", artist: "Bon Iver", album: "For Emma, Forever Ago" },
      { title: "I Will Follow You Into the Dark", artist: "Death Cab for Cutie", album: "Plans" },
      { title: "Rosyln", artist: "Bon Iver & St. Vincent", album: "The Twilight Saga: New Moon" },
      { title: "Fake Empire", artist: "The National", album: "Boxer" },
      { title: "Transatlanticism", artist: "Death Cab for Cutie", album: "Transatlanticism" },
      { title: "Holocene", artist: "Bon Iver", album: "Bon Iver, Bon Iver" },
      { title: "Bloodbuzz Ohio", artist: "The National", album: "High Violet" },
      { title: "Crooked Teeth", artist: "Death Cab for Cutie", album: "Plans" },
      { title: "Flume", artist: "Bon Iver", album: "For Emma, Forever Ago" },
      { title: "I Need My Girl", artist: "The National", album: "Trouble Will Find Me" },
    ];
    const artistRadio: Song[] = [
      { title: "About Today", artist: "The National", album: "Cherry Tree" },
      { title: "Mr. November", artist: "The National", album: "Alligator" },
      { title: "Start a War", artist: "The National", album: "Boxer" },
      { title: "Graceless", artist: "The National", album: "Trouble Will Find Me" },
      { title: "Don't Swallow the Cap", artist: "The National", album: "Trouble Will Find Me" },
      { title: "The System Only Dreams in Total Darkness", artist: "The National", album: "Sleep Well Beast" },
    ];
    const wideRows = await runStation(wide, {
      stationId: "step8-wide",
      format: "directors_cut",
      host: "warm-companion",
      persona: "Guide",
      seconds: 30,
    });
    const radioRows = await runStation(artistRadio, {
      stationId: "step8-artist-radio",
      format: "directors_cut",
      host: "warm-companion",
      persona: "Guide",
      seconds: 30,
    });
    function checkStation(label: string, rows: Row[], songs: Song[]) {
      const shapes = new Set<string>();
      let retries = 0;
      let fallbacks = 0;
      const teases: string[] = [];
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]!;
        const song = songs[index]!;
        if (row.gate === "retry") retries += 1;
        if (row.gate === "fallback") fallbacks += 1;
        expect(row.script.trim().length, `${label} ${song.title}`).toBeGreaterThan(0);
        expect(cannedSongHandoff(row.script), row.script).toBe(false);
        expect(hasStandaloneCue(row.script), row.script).toBe(false);
        expect(row.script, row.script).not.toMatch(/\bis credited on\b/i);
        expect(row.script, row.script).not.toMatch(/\bthe song is\b.+\bfrom\b/i);
        const pack = thinPack(song, []);
        for (const shape of sentenceShapes(row.script, pack)) {
          expect(shapes.has(shape), `${label} repeated shape "${shape}" in ${row.script}`).toBe(false);
          shapes.add(shape);
        }
        const promise = index > 0 ? rows[index - 1]?.openTease : null;
        if (promise) {
          teases.push(`${rows[index - 1]!.title} teased: ${promise.claim} → ${song.title}: ${row.script}`);
          expect(restatesFact(row.script, { id: promise.claimId, claim: promise.claim }), row.script).toBe(false);
        }
        console.log(`STEP8 ${label} | ${row.persona} | ${row.factType || "none"} | ${row.gate}\n${row.script}`);
      }
      console.log(`\nSTEP8 ${label} retries=${retries} fallbacks=${fallbacks} shapes=${shapes.size}`);
      for (const line of teases) console.log(`TEASE ${line}`);
      return { retries, fallbacks, shapes: shapes.size, teases };
    }
    const wideCheck = checkStation("wide", wideRows, wide);
    const radioCheck = checkStation("artist-radio", radioRows, artistRadio);
    const rates = {
      pass: [...wideRows, ...radioRows].filter((row) => row.gate === "pass").length,
      retry: [...wideRows, ...radioRows].filter((row) => row.gate === "retry").length,
      fallback: [...wideRows, ...radioRows].filter((row) => row.gate === "fallback").length,
    };
    mkdirSync("tmp", { recursive: true });
    writeFileSync("tmp/new-host-step8.json", JSON.stringify({
      wide: wideRows,
      artistRadio: radioRows,
      rates,
      wideCheck,
      radioCheck,
    }, null, 2));
    console.log(`\nSTEP8 RATES pass=${rates.pass} retry=${rates.retry} fallback=${rates.fallback}`);
    expect(rates.pass + rates.retry + rates.fallback).toBe(18);
    expect(rates.pass).toBeGreaterThanOrEqual(14);
    expect(rates.fallback).toBeLessThanOrEqual(1);
  }, 1200000);

  it("October 9 sample at Standard, one station, with the source url", async () => {
    expect(process.env.OPENAI_API_KEY?.trim()).toBeTruthy();
    clearSheetCache();
    clearStationMemory();
    const songs = readFileSync("tmp/dj-genre-sample-oct9.jsonl", "utf8")
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { n: number; title: string; artist: string; genre: string });
    const rows: Array<Row & { n: number; genre: string; words: number; passageUrls: string[] }> = [];
    for (let index = 0; index < songs.length; index += 1) {
      const song = songs[index]!;
      const next = songs[index + 1];
      const sheet = await loadBreakSheet({
        artist: song.artist,
        title: song.title,
        waitMs: 120000,
        ...(next ? { next: { artist: next.artist, title: next.title } } : {}),
      });
      const result = await resolveNewWordsFromBody(
        {
          songTitle: song.title,
          artistName: song.artist,
          stationId: "proof-oct9-standard",
          stationName: "Proof Radio",
          commentaryFormat: "standard",
          hostId: "standard-broadcast",
          research: "warm",
          ...(next ? { nextTrack: { title: next.title, artist: next.artist } } : {}),
          segmentPlan: { ...plan(song, 20), styleRotationIndex: index },
        },
        "free",
      );
      const row = {
        n: song.n,
        genre: song.genre,
        title: song.title,
        artist: song.artist,
        persona: "Broadcast",
        mode: "standard",
        script: result.script ?? "",
        gate: result.gate ?? "fallback",
        sheetMs: result.sheetMs ?? 0,
        writeMs: result.writeMs ?? 0,
        costUsd: result.costUsd ?? 0,
        sources: result.sources ?? [],
        openTease: result.openTease ?? null,
        spokenTopics: [...(result.spokenTopics ?? [])],
        usedFactIds: [...(result.usedFactIds ?? [])],
        factType: result.factType ?? "",
        stationSpokenIds: [...(result.stationSpokenIds ?? [])],
        words: wordCount(result.script ?? ""),
        passageUrls: (sheet.passages ?? []).map((passage) => passage.url),
      };
      rows.push(row);
      const url = row.sources?.[0]?.url || row.passageUrls[0] || "(no url)";
      console.log(`\nOCT9 ${row.n} ${song.title} [${row.gate} ${row.words}w]\n${row.script}\n${url}`);
    }
    mkdirSync("tmp", { recursive: true });
    writeFileSync("tmp/dj-genre-proof-oct9.jsonl", rows.map((row) => JSON.stringify(row)).join("\n"));

    const find = (title: string) => rows.find((row) => row.title === title);
    const problems: string[] = [];
    const need = (title: string, ok: boolean, why: string) => {
      if (!ok) problems.push(`${title}: ${why}`);
    };
    const gyow = find("Go Your Own Way");
    need("Go Your Own Way", Boolean(gyow?.script.match(/Rumours/i)), gyow?.script ?? "missing");
    need("Go Your Own Way", Boolean(gyow?.script.includes("1977")), `year missing in: ${gyow?.script ?? ""}`);
    need("Go Your Own Way", !/2019/.test(gyow?.script ?? ""), `2019 still spoken: ${gyow?.script ?? ""}`);
    need("Go Your Own Way", (gyow?.words ?? 0) >= 40 && (gyow?.words ?? 0) <= 90, `${gyow?.words ?? 0} words`);
    need("Go Your Own Way", !/^Lindsey Buckingham composed/i.test(gyow?.script ?? ""), gyow?.script ?? "");

    const folsom = find("Folsom Prison Blues");
    need("Folsom Prison Blues", Boolean(folsom?.script.match(/Sun Studio|Sam Phillips/i)), folsom?.script ?? "missing");
    need("Folsom Prison Blues", !/^Johnny Cash composed/i.test(folsom?.script ?? ""), folsom?.script ?? "");

    const jolene = find("Jolene");
    need("Jolene", Boolean(jolene?.script.match(/RCA Studio B|album Jolene|Jolene album|her album|the Jolene album/i)), jolene?.script ?? "missing");
    need("Jolene", !/Kygo/i.test(jolene?.script ?? ""), jolene?.script ?? "");

    const soWhat = find("So What");
    const takeFive = find("Take Five");
    need("So What", Boolean(soWhat?.script.match(/Kind of Blue/i)), soWhat?.script ?? "missing");
    need("So What", !/Paul Desmond|Take Five/i.test(soWhat?.script ?? ""), `spent the next fact: ${soWhat?.script ?? ""}`);
    need("Take Five", Boolean(takeFive?.script.match(/Paul Desmond/i)), takeFive?.script ?? "missing");

    const bohemian = find("Bohemian Rhapsody");
    need("Bohemian Rhapsody", (bohemian?.words ?? 0) >= 40, `${bohemian?.words ?? 0} words: ${bohemian?.script ?? ""}`);
    need("Bohemian Rhapsody", !/^Bohemian Rhapsody was the lead single/i.test(bohemian?.script ?? ""), bohemian?.script ?? "");

    const paranoid = find("Paranoid");
    need("Paranoid", !/left in 1969/i.test(paranoid?.script ?? ""), paranoid?.script ?? "missing");

    for (const row of rows) {
      const url = row.sources?.find((source) => source.url)?.url || row.passageUrls[0];
      if ((row.words ?? 0) >= 40) need(row.title, Boolean(url), "no source url");
    }
    const taught = rows.filter((row) => (row.words ?? 0) >= 40 && row.gate !== "fallback");
    need("Standard", taught.length >= 8, `only ${taught.length} breaks taught a sourced story`);

    const welcomeStarted = Date.now();
    const welcome = await resolveNewWordsFromBody(
      {
        songTitle: "Go Your Own Way",
        artistName: "Fleetwood Mac",
        stationId: "proof-oct9-opener",
        stationName: "Proof Radio",
        commentaryFormat: "standard",
        hostId: "standard-broadcast",
        research: "warm",
        segmentPlan: { ...plan({ title: "Go Your Own Way", artist: "Fleetwood Mac" }, 12), isSessionOpening: true },
      },
      "free",
    );
    console.log(`\nOCT9 SONG 1 (${Date.now() - welcomeStarted}ms)\n${welcome.script}`);
    need("Song 1", Boolean(welcome.script?.match(/Proof Radio/i)), welcome.script ?? "");
    need("Song 1", Boolean(welcome.script?.match(/Rumours|1977|Fleetwood/i)), welcome.script ?? "");

    clearSheetCache();
    const replayStarted = Date.now();
    const replay = await loadBreakSheet({ artist: "Fleetwood Mac", title: "Go Your Own Way", waitMs: 3000 });
    const replayMs = Date.now() - replayStarted;
    console.log(`\nOCT9 REPLAY ${replayMs}ms passages=${replay.passages?.length ?? 0}`);
    need("Replay", replayMs < 2000 && (replay.passages?.length ?? 0) > 0, `${replayMs}ms passages=${replay.passages?.length ?? 0}`);

    expect(problems, problems.join("\n")).toEqual([]);
  }, 50 * 60 * 1000);
});

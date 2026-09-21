/**
 * Render the Custom welcome + fallback banks on the local GPU sidecar.
 *
 * Prerequisite: sidecar window shows `[local-tts] Ready`.
 *
 * Copy-paste from the SongHost folder:
 *
 *   npx tsx tools/local-tts-sidecar/generate-prerecorded.ts
 *
 * Writes WAVs to public/audio/prerecorded/slot-{1-4}/ (Harris/Piper/Quinn/Bea).
 * Commit those binaries so Vercel can serve them — do not run this at Vercel build
 * (no GPU there). Re-run with --force to replace existing files.
 */

import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FALLBACK_SCRIPTS,
  LOCAL_PRERECORDED_SLOT_LABELS,
  LOCAL_PRERECORDED_SLOTS,
  WELCOME_SCRIPTS,
  type PrerecordedKind,
  type PrerecordedScript,
} from "../../src/lib/audio/prerecorded/scripts";

const SIDECAR_URL = (process.env.LOCAL_TTS_URL || "http://127.0.0.1:7860").replace(/\/$/, "");
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_ROOT = path.join(REPO_ROOT, "public", "audio", "prerecorded");
const FORCE = process.argv.includes("--force");

type ManifestSlot = {
  label: string;
  welcome: string[];
  fallback: string[];
};

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function assertSidecarReady(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${SIDECAR_URL}/health`);
  } catch {
    throw new Error(
      `Sidecar is not reachable at ${SIDECAR_URL}. Start it first:\n` +
        "  powershell -ExecutionPolicy Bypass -File tools\\local-tts-sidecar\\start.ps1",
    );
  }
  const body = (await response.json()) as { ok?: boolean; error?: string };
  if (!response.ok || !body.ok) {
    throw new Error(
      `Sidecar is not Ready (${SIDECAR_URL}/health). ${body.error ?? ""}`.trim(),
    );
  }
}

async function synthesize(text: string, slot: number): Promise<Buffer> {
  const response = await fetch(`${SIDECAR_URL}/v1/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voiceSlot: String(slot) }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`slot ${slot} synth failed (${response.status}): ${err}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function renderBank(
  kind: PrerecordedKind,
  scripts: readonly PrerecordedScript[],
  slot: (typeof LOCAL_PRERECORDED_SLOTS)[number],
): Promise<string[]> {
  const written: string[] = [];
  const slotDir = path.join(OUT_ROOT, `slot-${slot}`);
  await mkdir(slotDir, { recursive: true });
  for (const row of scripts) {
    const dest = path.join(slotDir, `${row.id}.wav`);
    if (!FORCE && (await fileExists(dest))) {
      console.log(`skip existing ${path.relative(REPO_ROOT, dest)}`);
      written.push(row.id);
      continue;
    }
    console.log(`synth ${LOCAL_PRERECORDED_SLOT_LABELS[slot]} slot-${slot} ${row.id}`);
    const wav = await synthesize(row.text, slot);
    await writeFile(dest, wav);
    written.push(row.id);
  }
  return written;
}

async function main(): Promise<void> {
  await assertSidecarReady();
  const manifest: { generatedAt: string; slots: Record<string, ManifestSlot> } = {
    generatedAt: new Date().toISOString(),
    slots: {},
  };

  for (const slot of LOCAL_PRERECORDED_SLOTS) {
    const welcome = await renderBank("welcome", WELCOME_SCRIPTS, slot);
    const fallback = await renderBank("fallback", FALLBACK_SCRIPTS, slot);
    manifest.slots[String(slot)] = {
      label: LOCAL_PRERECORDED_SLOT_LABELS[slot],
      welcome,
      fallback,
    };
  }

  await writeFile(
    path.join(OUT_ROOT, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  console.log(`Wrote ${path.join(OUT_ROOT, "manifest.json")}`);
  console.log("Done. Restart or refresh SongHost so new files are served.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

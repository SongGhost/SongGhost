import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__") continue;
      out.push(...walk(full));
      continue;
    }
    if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("Classic words stay untouched by the New engine", () => {
  it("does not import the teaching prompt or playDjIntro", () => {
    const root = path.resolve("src/lib/dj/wordsEngine");
    const sources = walk(root).map((file) => readFileSync(file, "utf8")).join("\n");
    expect(sources).not.toContain("legacyTeachingPrompt");
    expect(sources).not.toContain("assembleLegacySystemPrompt");
    expect(sources).not.toContain('from "@/lib/dj-intro"');
    expect(sources).not.toContain("generatePavlovianDjBreak");
  });

  it("leaves playDjIntro on the Classic module", () => {
    const intro = readFileSync(path.resolve("src/lib/dj-intro.ts"), "utf8");
    expect(intro).toContain("generatePavlovianDjBreak");
    expect(intro).not.toContain("wordsEngine");
    expect(intro).not.toContain("playNewBreak");
    expect(intro).not.toContain("djEngine");
  });

  it("keeps a Classic generate-script request out of composeNewBreak", () => {
    const route = readFileSync(path.resolve("src/app/api/generate-script/route.ts"), "utf8");
    const legacyFn = route.slice(
      route.indexOf("async function handleLegacyScriptGeneration"),
      route.indexOf("export async function POST"),
    );
    const post = route.slice(route.indexOf("export async function POST"));
    const branch = post.indexOf('resolveDjEngine(rawBody.djEngine) === "new"');
    const legacyCall = post.indexOf("handleLegacyScriptGeneration(");
    expect(branch).toBeGreaterThan(-1);
    expect(legacyCall).toBeGreaterThan(branch);
    expect(post.slice(branch, legacyCall)).toContain("resolveNewWordsFromBody");
    expect(legacyFn).not.toContain("composeNewBreak");
    expect(legacyFn).not.toContain("resolveNewWordsFromBody");
    expect(route).not.toContain("composeNewBreak");
  });

  it("keeps the Classic deep model picker on gpt-4o with a 220 token cap", () => {
    const route = readFileSync(path.resolve("src/app/api/generate-script/route.ts"), "utf8");
    expect(route).toContain("const SCRIPT_MAX_TOKENS_IN_DEPTH = 220;");
    expect(route).toContain(
      'return isDeepDiveLoreFormat(lore) ? "gpt-4o" : "gpt-4o-mini";',
    );
  });

  it("keeps both Song 1 playDjIntro calls and adds one New branch", () => {
    const player = readFileSync(path.resolve("src/components/AudioPlayer.tsx"), "utf8");
    const classicCalls = player.split("await playDjIntro(").length - 1;
    expect(classicCalls).toBe(3);
    expect(player).toContain("await playNewBreak(");
    expect(player).not.toContain("legacyTeachingPrompt");
  });
});

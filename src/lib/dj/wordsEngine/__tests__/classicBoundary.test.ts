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

  it("keeps both Song 1 playDjIntro calls and adds one New branch", () => {
    const player = readFileSync(path.resolve("src/components/AudioPlayer.tsx"), "utf8");
    const classicCalls = player.split("await playDjIntro(").length - 1;
    expect(classicCalls).toBe(3);
    expect(player).toContain("await playNewBreak(");
    expect(player).not.toContain("legacyTeachingPrompt");
  });
});

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  inspiredRowMode,
  visibleTopPills,
} from "../stationBrowserFilters";
import { INSPIRED_STATION_COUNT, shouldShowInspiredPill } from "@/lib/inspired-stations";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const INSPIRED_SET = [
  { id: "inspired-90s-boom-bap-0" },
  { id: "inspired-trap-heavy-1" },
  { id: "inspired-conscious-rhymes-2" },
];

describe("StationBrowser Inspired pill", () => {
  it("hides the Inspired pill when no set exists and nothing is loading", () => {
    expect(shouldShowInspiredPill([], false)).toBe(false);
    expect(visibleTopPills([], false).map((pill) => pill.id)).toEqual([
      "all",
      "decades",
      "genres",
      "mixes",
      "stations",
    ]);
  });

  it("shows the Inspired pill after My Stations once a set exists or is loading", () => {
    expect(shouldShowInspiredPill(INSPIRED_SET, false)).toBe(true);
    expect(visibleTopPills(INSPIRED_SET, false).map((pill) => pill.id)).toEqual([
      "all",
      "decades",
      "genres",
      "mixes",
      "stations",
      "inspired",
    ]);
    expect(visibleTopPills([], true).at(-1)?.label).toBe("Inspired");
  });

  it("renders a skeleton while loading, then one card per real inspired station", () => {
    expect(inspiredRowMode([], true)).toBe("skeleton");
    expect(inspiredRowMode(INSPIRED_SET, false)).toBe("cards");
    expect(INSPIRED_SET).toHaveLength(INSPIRED_STATION_COUNT);
    expect(inspiredRowMode([], false)).toBe("hidden");
    const browser = readFileSync(resolve(root, "src/components/studio/StationBrowser.tsx"), "utf8");
    expect(browser).toContain("Array.from({ length: INSPIRED_STATION_COUNT }");
    expect(browser).not.toContain("[0, 1, 2, 3, 4]");
  });
});

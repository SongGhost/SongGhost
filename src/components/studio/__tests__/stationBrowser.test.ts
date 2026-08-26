import { describe, expect, it } from "vitest";
import {
  inspiredRowMode,
  visibleTopPills,
} from "../stationBrowserFilters";
import { shouldShowInspiredPill } from "@/lib/inspired-stations";

const FIVE = [{ id: "inspired-a-0" }, { id: "inspired-b-1" }, { id: "inspired-c-2" }, { id: "inspired-d-3" }, { id: "inspired-e-4" }];

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
    expect(shouldShowInspiredPill(FIVE, false)).toBe(true);
    expect(visibleTopPills(FIVE, false).map((pill) => pill.id)).toEqual([
      "all",
      "decades",
      "genres",
      "mixes",
      "stations",
      "inspired",
    ]);
    expect(visibleTopPills([], true).at(-1)?.label).toBe("Inspired");
  });

  it("renders skeleton while loading with an empty set, then cards for the 5", () => {
    expect(inspiredRowMode([], true)).toBe("skeleton");
    expect(inspiredRowMode(FIVE, false)).toBe("cards");
    expect(inspiredRowMode(FIVE, false) === "cards" ? FIVE.length : 0).toBe(5);
    expect(inspiredRowMode([], false)).toBe("hidden");
  });
});

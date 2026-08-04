import { describe, expect, it } from "vitest";
import { PERSONAS } from "@/data/personas";
import {
  DEFAULT_PALETTE,
  getPaletteForGenre,
  getPaletteForPersona,
  getPaletteForStation,
  hexToRgb,
  VISUAL_PALETTES,
  withAlpha,
} from "../theme-palette";

describe("roster coverage", () => {
  it("themes every host on the roster", () => {
    for (const persona of PERSONAS) {
      expect(VISUAL_PALETTES[persona.id]).toBeDefined();
      expect(VISUAL_PALETTES[persona.id].personaId).toBe(persona.id);
    }
  });

  it("gives every palette three distinct hues over the shared base", () => {
    const bases = new Set<string>();

    for (const palette of Object.values(VISUAL_PALETTES)) {
      const hues = new Set([palette.primary, palette.secondary, palette.accent]);
      expect(hues.size).toBe(3);
      for (const hue of hues) expect(hexToRgb(hue)).not.toBeNull();
      bases.add(palette.background);
    }

    // One canvas base across the roster: only the light changes per station.
    expect(bases.size).toBe(1);
  });
});

describe("assigned palettes", () => {
  it("holds the specified hues for each host", () => {
    expect(VISUAL_PALETTES["johnny-static"]).toMatchObject({
      primary: "#FFBF00",
      secondary: "#D4AF37",
      accent: "#990000",
    });
    expect(VISUAL_PALETTES["sloane-vance"]).toMatchObject({
      primary: "#4B0082",
      secondary: "#4682B4",
      accent: "#50C878",
    });
    expect(VISUAL_PALETTES["devon-pulse"]).toMatchObject({
      primary: "#00FFFF",
      secondary: "#8A2BE2",
      accent: "#FF00FF",
    });
    expect(VISUAL_PALETTES["kira-nova"]).toMatchObject({
      primary: "#FF69B4",
      secondary: "#FF4500",
      accent: "#0047AB",
    });
    expect(VISUAL_PALETTES["jasper-reed"]).toMatchObject({
      primary: "#B87333",
      secondary: "#2E8B57",
      accent: "#FFFDD0",
    });
  });
});

describe("getPaletteForPersona", () => {
  it("resolves a live host id", () => {
    expect(getPaletteForPersona("kira-nova").personaId).toBe("kira-nova");
  });

  it("remaps a retired host id instead of falling back", () => {
    expect(getPaletteForPersona("wolfman").personaId).toBe("johnny-static");
    expect(getPaletteForPersona("cyber_anya").personaId).toBe("kira-nova");
  });

  it("falls back to the default host for a missing or unknown id", () => {
    expect(getPaletteForPersona(null)).toBe(DEFAULT_PALETTE);
    expect(getPaletteForPersona(undefined)).toBe(DEFAULT_PALETTE);
    expect(getPaletteForPersona("")).toBe(DEFAULT_PALETTE);
    expect(getPaletteForPersona("nobody")).toBe(DEFAULT_PALETTE);
  });
});

describe("getPaletteForGenre", () => {
  it("themes free text through the same resolution that picks the host", () => {
    expect(getPaletteForGenre("classic rock").personaId).toBe("johnny-static");
    expect(getPaletteForGenre("seattle grunge").personaId).toBe("sloane-vance");
    expect(getPaletteForGenre("90s hip hop").personaId).toBe("devon-pulse");
    expect(getPaletteForGenre("synthwave").personaId).toBe("kira-nova");
    expect(getPaletteForGenre("bluegrass").personaId).toBe("jasper-reed");
  });

  it("falls back rather than leaving the canvas unthemed", () => {
    expect(getPaletteForGenre("   ")).toBe(DEFAULT_PALETTE);
    expect(getPaletteForGenre("something unclassifiable")).toBe(DEFAULT_PALETTE);
  });
});

describe("getPaletteForStation", () => {
  it("prefers the station's assigned host", () => {
    const palette = getPaletteForStation({
      name: "Neon Overdrive",
      description: "synthwave and retrowave",
      defaultPersonaId: "jasper-reed",
    });

    expect(palette.personaId).toBe("jasper-reed");
  });

  it("resolves from name and description for a station built at runtime", () => {
    const palette = getPaletteForStation({
      name: "Late Night Boom Bap",
      description: "golden age hip hop",
    });

    expect(palette.personaId).toBe("devon-pulse");
  });
});

describe("withAlpha", () => {
  it("converts hex to rgba at the requested alpha", () => {
    expect(withAlpha("#FFBF00", 0.5)).toBe("rgba(255, 191, 0, 0.5)");
    expect(withAlpha("00FFFF", 1)).toBe("rgba(0, 255, 255, 1)");
  });

  it("expands shorthand hex", () => {
    expect(withAlpha("#0AF", 0.25)).toBe("rgba(0, 170, 255, 0.25)");
  });

  it("clamps alpha into range", () => {
    expect(withAlpha("#FFFFFF", 4)).toBe("rgba(255, 255, 255, 1)");
    expect(withAlpha("#FFFFFF", -2)).toBe("rgba(255, 255, 255, 0)");
    expect(withAlpha("#FFFFFF", Number.NaN)).toBe("rgba(255, 255, 255, 0)");
  });

  it("yields transparent for a colour it cannot parse", () => {
    // A malformed stop must not throw inside an animation frame.
    expect(withAlpha("not-a-colour", 0.5)).toBe("rgba(0, 0, 0, 0)");
    expect(withAlpha("#FFFF", 0.5)).toBe("rgba(0, 0, 0, 0)");
  });
});

describe("hexToRgb", () => {
  it("parses six-digit and three-digit hex", () => {
    expect(hexToRgb("#50C878")).toEqual({ r: 80, g: 200, b: 120 });
    expect(hexToRgb("fff")).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("reports an unparseable value rather than guessing", () => {
    expect(hexToRgb("#12345")).toBeNull();
    expect(hexToRgb("rgb(1,2,3)")).toBeNull();
  });
});

/**
 * Genre-adaptive palettes for the audio visualizer.
 *
 * Colour is keyed to the host rather than to the station, because the host is
 * already the resolved answer to "what is this music". Every launch path —
 * preset station, artist radio, AI Curator, saved mix — lands on a `PersonaId`
 * through `dj-resolver`, so keying here means a station added later inherits a
 * palette without anyone remembering to assign one.
 *
 * Palettes are three hues over a fixed slate base, ordered by how much of the
 * canvas they cover: `primary` leads, `secondary` is the gradient waypoint, and
 * `accent` marks the edges (outer glow falloff, peak-hold caps). The base is
 * shared across the roster so the deck's chassis reads the same on every
 * station and only the light coming off it changes.
 */

import { resolvePersonaId, type PersonaId } from "@/data/personas";
import { resolveDjForStation, resolveDjIdForQuery } from "@/lib/dj-resolver";

export type VisualPalette = {
  personaId: PersonaId;
  /** Human-readable name for the theme, for a settings row or a tooltip. */
  label: string;
  /** Leading hue: bar bodies, the oscilloscope trace, the hot core of the glow. */
  primary: string;
  /** Mid hue: gradient waypoint and the midpoint of a bar's fill. */
  secondary: string;
  /** Trailing hue: outer glow falloff and peak-hold caps. */
  accent: string;
  /** What the canvas clears to — the deep slate the whole chassis sits on. */
  background: string;
};

/**
 * Shared canvas base. Near-black rather than black: the deck is `zinc-950`, and
 * a pure-black canvas behind it reads as a hole rather than as depth.
 */
const CANVAS_BASE = "#0A0A0B";

export const VISUAL_PALETTES: Readonly<Record<PersonaId, VisualPalette>> = Object.freeze({
  miles: {
    personaId: "miles",
    label: "Tube Warmth",
    primary: "#FFBF00",
    secondary: "#D4AF37",
    accent: "#990000",
    background: CANVAS_BASE,
  },
  "sloane-vance": {
    personaId: "sloane-vance",
    label: "Basement Show",
    primary: "#4B0082",
    secondary: "#4682B4",
    accent: "#50C878",
    background: CANVAS_BASE,
  },
  "devon-pulse": {
    personaId: "devon-pulse",
    label: "Late Night Neon",
    primary: "#00FFFF",
    secondary: "#8A2BE2",
    accent: "#FF00FF",
    background: CANVAS_BASE,
  },
  "kira-nova": {
    personaId: "kira-nova",
    label: "Sunset Grid",
    primary: "#FF69B4",
    secondary: "#FF4500",
    accent: "#0047AB",
    background: CANVAS_BASE,
  },
  "jasper-reed": {
    personaId: "jasper-reed",
    label: "Porch Light",
    primary: "#B87333",
    secondary: "#2E8B57",
    accent: "#FFFDD0",
    background: CANVAS_BASE,
  },
});

/** Matches `DEFAULT_PERSONA`, so an unresolved station is lit, not blank. */
export const DEFAULT_PALETTE = VISUAL_PALETTES.miles;

/**
 * Palette for a host id. Runs through `resolvePersonaId`, so an id persisted by
 * an older build themes to that host's successor instead of falling back.
 */
export function getPaletteForPersona(personaId: string | null | undefined): VisualPalette {
  if (!personaId) return DEFAULT_PALETTE;
  return VISUAL_PALETTES[resolvePersonaId(personaId)];
}

/**
 * Palette for free text — a genre name, a decade, a curator prompt. Resolution
 * is the DJ resolver's, so "90s hip hop" themes as Devon Pulse's show for the
 * same reason he hosts it.
 */
export function getPaletteForGenre(query: string): VisualPalette {
  if (!query.trim()) return DEFAULT_PALETTE;
  return getPaletteForPersona(resolveDjIdForQuery(query));
}

/**
 * Palette for a station record. An explicitly assigned host wins; stations built
 * at runtime fall through to text resolution on name and description.
 */
export function getPaletteForStation(station: {
  name?: string;
  description?: string;
  defaultPersonaId?: string;
}): VisualPalette {
  return getPaletteForPersona(resolveDjForStation(station).id);
}

/**
 * `#RRGGBB` to `rgba()` at a given alpha.
 *
 * Canvas gradients need per-stop alpha, which hex cannot express, and the whole
 * overlay is built out of translucent stops so the text above it keeps its
 * contrast. Alpha is clamped; a malformed hex yields transparent rather than
 * throwing, since a bad colour must not take the animation frame down.
 */
export function withAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  const safeAlpha = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0;
  if (!rgb) return "rgba(0, 0, 0, 0)";
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${round(safeAlpha)})`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const value = hex.trim().replace(/^#/, "");
  const expanded =
    value.length === 3
      ? value
          .split("")
          .map((char) => char + char)
          .join("")
      : value;

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null;

  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

/** Trims float noise so gradient stop strings stay short and stable. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

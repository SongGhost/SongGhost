/** Visualizer contracts shared by the canvas, the deck, and stored preferences. */

export type VisualizerMode = "ambient" | "oscilloscope" | "spectrum";

/** Cycle order for the deck's mode button. */
export const VISUALIZER_MODES: readonly VisualizerMode[] = [
  "ambient",
  "oscilloscope",
  "spectrum",
] as const;

/**
 * Ambient is the default because it is the only mode that reads as chassis
 * lighting rather than as instrumentation: it carries no detail a listener could
 * mistake for a control, so it can sit behind text at full width.
 */
export const DEFAULT_VISUALIZER_MODE: VisualizerMode = "ambient";

export const VISUALIZER_MODE_LABELS: Readonly<Record<VisualizerMode, string>> = Object.freeze({
  ambient: "Ambient Glow",
  oscilloscope: "Oscilloscope",
  spectrum: "Spectrum",
});

export function isVisualizerMode(value: unknown): value is VisualizerMode {
  return typeof value === "string" && VISUALIZER_MODES.includes(value as VisualizerMode);
}

/** Next mode in the cycle. An unknown value restarts at the default. */
export function nextVisualizerMode(mode: VisualizerMode): VisualizerMode {
  const index = VISUALIZER_MODES.indexOf(mode);
  if (index < 0) return DEFAULT_VISUALIZER_MODE;
  return VISUALIZER_MODES[(index + 1) % VISUALIZER_MODES.length];
}

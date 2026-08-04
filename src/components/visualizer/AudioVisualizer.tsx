"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getMasterAnalyser } from "@/lib/audio/mix-bus";
import { getPaletteForPersona, withAlpha, type VisualPalette } from "@/lib/visuals/theme-palette";
import {
  decayPeaks,
  foldToBands,
  frequencyBinHz,
  hasSignal,
  OSCILLOSCOPE_SAMPLE_COUNT,
  SPECTRUM_BAND_COUNT,
  smoothTowards,
  subBassEnergy,
  syntheticSpectrum,
  syntheticSubBass,
  syntheticWaveform,
  waveformFromBytes,
} from "@/lib/visuals/spectrum";
import type { VisualizerMode } from "@/types/visuals";

/**
 * Audio-reactive backdrop for the player deck.
 *
 * Draws from the master analyser whenever a source the audio graph can observe
 * is on air — currently DJ breaks and same-origin preview clips — and from
 * `spectrum.ts`'s synthetic drive otherwise, because the music channel plays
 * inside a cross-origin YouTube IFrame that Web Audio has no access to. The
 * handover is decided per frame, so the canvas never has a dead state while
 * something is playing.
 *
 * The loop is parked rather than throttled whenever there is nothing to show:
 * audio paused, tab hidden, or reduced motion requested. A parked loop holds no
 * `requestAnimationFrame` at all, so a backgrounded tab costs nothing.
 *
 * The palette is derived from the host id rather than passed in, which keeps
 * every dependency array here to primitives — no object prop can restart the
 * animation on an unrelated parent render.
 */

type AudioVisualizerProps = {
  mode: VisualizerMode;
  /** Host on air. Themes the canvas; falls back to the default palette. */
  personaId?: string | null;
  /** Audio is on air. When false the canvas parks on a resting frame. */
  active: boolean;
  /**
   * Overlay opacity, clamped into the legibility budget: the deck's text and
   * controls sit directly on top of this, and anything denser eats their
   * contrast.
   */
  opacity?: number;
  className?: string;
};

const MIN_OPACITY = 0.3;
const MAX_OPACITY = 0.5;
const DEFAULT_OPACITY = 0.4;

/** Ceiling on backing-store scale. Past 2x the cost is real and the gain is not. */
const MAX_PIXEL_RATIO = 2;

/** Asymmetric envelope for the ambient glow: percussive lift, musical tail. */
const GLOW_RISE = 0.32;
const GLOW_FALL = 0.06;

/** Per-frame fall of a bar's peak-hold cap, as a fraction of full scale. */
const PEAK_DECAY_PER_FRAME = 0.012;

/** Per-frame fall of the oscilloscope's peak rails. */
const TRACE_PEAK_DECAY_PER_FRAME = 0.008;

/** Resting level a parked frame draws, so a paused deck stays lit but still. */
const IDLE_LEVEL = 0.06;

/**
 * Byte level a time-domain frame has to exceed to count as sound. Digital
 * silence sits flat at 128, and any real waveform clears this within a frame.
 */
const WAVEFORM_SILENCE_FLOOR = 130;

/** Assumed rate when the graph has not reported one — every mainstream default. */
const FALLBACK_SAMPLE_RATE = 48000;

type FrameConfig = {
  mode: VisualizerMode;
  palette: VisualPalette;
  /** False for a parked repaint: levels snap to rest instead of easing there. */
  animate: boolean;
};

type VisualizerState = {
  bands: number[];
  peaks: number[];
  points: number[];
  glow: number;
  tracePeak: number;
};

function createState(): VisualizerState {
  return {
    bands: new Array<number>(SPECTRUM_BAND_COUNT).fill(IDLE_LEVEL),
    peaks: new Array<number>(SPECTRUM_BAND_COUNT).fill(IDLE_LEVEL),
    points: new Array<number>(OSCILLOSCOPE_SAMPLE_COUNT).fill(0),
    glow: IDLE_LEVEL,
    tracePeak: IDLE_LEVEL,
  };
}

export default function AudioVisualizer({
  mode,
  personaId,
  active,
  opacity = DEFAULT_OPACITY,
  className = "",
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<VisualizerState>(createState());
  const sizeRef = useRef({ width: 0, height: 0 });
  const analyserRef = useRef(getMasterAnalyser());

  const [documentVisible, setDocumentVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);

  /**
   * Renders one frame. Dependency-free on purpose: the render config arrives as
   * an argument and the rolling levels live in a ref, so the loop effect below
   * owns a callback that never changes identity.
   */
  const drawFrame = useCallback((timeMs: number, config: FrameConfig) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const { width, height } = sizeRef.current;
    if (width <= 0 || height <= 0) return;

    const state = stateRef.current;
    const { mode: activeMode, palette, animate } = config;
    const analyser = analyserRef.current;
    /** Drive for the synthetic fallback: full while playing, resting when parked. */
    const drive = animate ? 1 : IDLE_LEVEL;

    if (activeMode === "oscilloscope") {
      const bytes = animate ? analyser.getByteTimeDomainData() : null;
      state.points =
        bytes && hasSignal(bytes, WAVEFORM_SILENCE_FLOOR)
          ? waveformFromBytes(bytes, OSCILLOSCOPE_SAMPLE_COUNT)
          : syntheticWaveform(OSCILLOSCOPE_SAMPLE_COUNT, timeMs, animate ? 1 : 0);

      let amplitude = 0;
      for (const point of state.points) amplitude = Math.max(amplitude, Math.abs(point));
      state.tracePeak = animate
        ? Math.max(amplitude, state.tracePeak - TRACE_PEAK_DECAY_PER_FRAME)
        : amplitude;
    } else if (activeMode === "spectrum") {
      const bytes = animate ? analyser.getFrequencyData() : null;
      state.bands =
        bytes && hasSignal(bytes)
          ? foldToBands(bytes, SPECTRUM_BAND_COUNT)
          : syntheticSpectrum(SPECTRUM_BAND_COUNT, timeMs, drive);
      // A parked frame has no history to hold, so its caps sit on the bars.
      if (animate) decayPeaks(state.peaks, state.bands, PEAK_DECAY_PER_FRAME);
      else decayPeaks(state.peaks, state.bands, 1);
    } else {
      const bytes = animate ? analyser.getFrequencyData() : null;
      const target =
        bytes && hasSignal(bytes)
          ? subBassEnergy(
              bytes,
              frequencyBinHz(analyser.getSampleRate() ?? FALLBACK_SAMPLE_RATE, bytes.length),
            )
          : syntheticSubBass(timeMs, drive);
      state.glow = animate ? smoothTowards(state.glow, target, GLOW_RISE, GLOW_FALL) : target;
    }

    context.clearRect(0, 0, width, height);
    context.fillStyle = palette.background;
    context.fillRect(0, 0, width, height);

    if (activeMode === "spectrum") renderSpectrum(context, width, height, palette, state);
    else if (activeMode === "oscilloscope") {
      renderOscilloscope(context, width, height, palette, state);
    } else renderAmbient(context, width, height, palette, state.glow);
  }, []);

  // Backing store follows the element's box and the device pixel ratio, so the
  // trace stays a hairline on a retina panel instead of a blurred smear.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const config: FrameConfig = {
      mode,
      palette: getPaletteForPersona(personaId),
      animate: false,
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const ratio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);

      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      sizeRef.current = { width, height };

      // Everything below draws in CSS pixels; the transform absorbs the ratio.
      canvas.getContext("2d")?.setTransform(ratio, 0, 0, ratio, 0, 0);
      // Resizing a canvas clears it, so a repaint here is what keeps the deck
      // from flashing empty while the loop is parked.
      drawFrame(performance.now(), config);
    };

    resize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [mode, personaId, drawFrame]);

  useEffect(() => {
    const sync = () => setDocumentVisible(document.visibilityState !== "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const animating = active && documentVisible && !reducedMotion;

  useEffect(() => {
    const config: FrameConfig = {
      mode,
      palette: getPaletteForPersona(personaId),
      animate: animating,
    };

    if (!animating) {
      // One resting frame, then nothing: a paused or hidden deck holds no
      // animation frame rather than looping over data that cannot change.
      drawFrame(performance.now(), config);
      return;
    }

    let frame = 0;
    const tick = (timeMs: number) => {
      drawFrame(timeMs, config);
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animating, mode, personaId, drawFrame]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none ${className}`}
      style={{ opacity: Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, opacity)) }}
    />
  );
}

// ---- Renderers --------------------------------------------------------------

/**
 * Ambient Glow: offset radial washes over the slate base, breathing with the
 * sub-bass. No edges and no detail, which is what lets it run the full width of
 * the deck behind live text.
 */
function renderAmbient(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: VisualPalette,
  glow: number,
): void {
  const lift = 0.25 + glow * 0.75;
  const span = Math.max(width, height);

  const wash = (x: number, y: number, radius: number, colour: string, alpha: number) => {
    const gradient = context.createRadialGradient(x, y, 0, x, y, Math.max(1, radius));
    gradient.addColorStop(0, withAlpha(colour, alpha));
    gradient.addColorStop(0.55, withAlpha(colour, alpha * 0.35));
    gradient.addColorStop(1, withAlpha(colour, 0));
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  };

  wash(width * 0.22, height * 1.05, span * 0.55 * lift, palette.primary, 0.85 * lift);
  wash(width * 0.78, height * 1.1, span * 0.5 * lift, palette.secondary, 0.7 * lift);
  wash(width * 0.5, height * -0.15, span * 0.45 * lift, palette.accent, 0.45 * lift);

  // Grounds the wash against the deck's lower border, so the glow reads as light
  // spilling out of the chassis rather than as a floating blob.
  const floor = context.createLinearGradient(0, height, 0, height * 0.55);
  floor.addColorStop(0, withAlpha(palette.primary, 0.5 * lift));
  floor.addColorStop(1, withAlpha(palette.primary, 0));
  context.fillStyle = floor;
  context.fillRect(0, height * 0.55, width, height * 0.45);
}

/**
 * Analog Oscilloscope: one smoothed trace between peak rails that fall back
 * slowly, so a loud passage leaves a mark the eye can follow after it ends.
 */
function renderOscilloscope(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: VisualPalette,
  state: VisualizerState,
): void {
  const points = state.points;
  if (points.length < 2) return;

  const centre = height / 2;
  const scale = height * 0.38;

  context.save();

  // Rails first, so the live trace draws over them.
  const railOffset = state.tracePeak * scale;
  context.strokeStyle = withAlpha(palette.accent, 0.45);
  context.lineWidth = 1;
  context.setLineDash([4, 6]);
  for (const offset of [-railOffset, railOffset]) {
    context.beginPath();
    context.moveTo(0, centre + offset);
    context.lineTo(width, centre + offset);
    context.stroke();
  }
  context.setLineDash([]);

  const gradient = context.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, withAlpha(palette.secondary, 0.9));
  gradient.addColorStop(0.5, withAlpha(palette.primary, 1));
  gradient.addColorStop(1, withAlpha(palette.secondary, 0.9));

  context.strokeStyle = gradient;
  context.lineWidth = 2;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.shadowColor = withAlpha(palette.primary, 0.8);
  context.shadowBlur = 12;

  context.beginPath();
  const step = width / (points.length - 1);
  context.moveTo(0, centre - points[0] * scale);

  // Midpoint quadratics: at this point count a straight polyline shows its
  // corners, and this rounds them off without a second pass over the data.
  for (let i = 1; i < points.length; i += 1) {
    const x = i * step;
    const y = centre - points[i] * scale;
    const previousX = (i - 1) * step;
    const previousY = centre - points[i - 1] * scale;
    context.quadraticCurveTo(previousX, previousY, (previousX + x) / 2, (previousY + y) / 2);
  }

  context.stroke();
  context.restore();
}

/**
 * 32-Band Spectrum: rounded bars under peak-hold caps. Levels are folded from
 * the analyser's bins by `foldToBands`, which spends the bars on the low end.
 */
function renderSpectrum(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  palette: VisualPalette,
  state: VisualizerState,
): void {
  const bands = state.bands;
  if (bands.length === 0) return;

  const slot = width / bands.length;
  const barWidth = Math.max(1, slot * 0.62);
  const inset = (slot - barWidth) / 2;
  const floor = height * 0.94;
  const span = height * 0.8;
  const radius = Math.min(barWidth / 2, 3);

  const fill = context.createLinearGradient(0, floor - span, 0, floor);
  fill.addColorStop(0, withAlpha(palette.primary, 0.95));
  fill.addColorStop(0.55, withAlpha(palette.secondary, 0.85));
  fill.addColorStop(1, withAlpha(palette.accent, 0.6));

  context.save();
  context.shadowColor = withAlpha(palette.primary, 0.5);
  context.shadowBlur = 8;
  context.fillStyle = fill;

  for (let i = 0; i < bands.length; i += 1) {
    const barHeight = Math.max(2, bands[i] * span);
    context.beginPath();
    context.roundRect(i * slot + inset, floor - barHeight, barWidth, barHeight, radius);
    context.fill();
  }

  context.shadowBlur = 0;
  context.fillStyle = withAlpha(palette.accent, 0.9);

  for (let i = 0; i < bands.length; i += 1) {
    const peak = state.peaks[i] ?? 0;
    // A cap sitting on its bar is just a thicker bar; it only means something
    // once the bar has fallen away from it.
    if (peak <= bands[i] + 0.02) continue;
    context.fillRect(i * slot + inset, floor - Math.max(2, peak * span) - 2, barWidth, 2);
  }

  context.restore();
}

/**
 * Signal math for the visualizer, kept free of both the audio graph and the
 * canvas.
 *
 * Everything here takes plain arrays and returns plain arrays, so the render
 * loop stays a thin layer of drawing calls over functions that can be reasoned
 * about — and tested — on their own.
 *
 * Two of these functions synthesize a signal rather than measure one. That is
 * not decoration for its own sake: the music channel plays inside a cross-origin
 * YouTube IFrame, which Web Audio cannot observe at all, so on a normal station
 * the analyser reports nothing between DJ breaks. The synthetic drive keeps the
 * canvas moving with the music it cannot hear, and real data takes over the
 * moment a source the graph *can* see is on air.
 */

/**
 * Sub-bass window used by the ambient mode.
 *
 * With a 256-point FFT the bins are ~187Hz wide, so this whole window lands in
 * the first bin. That is the intended trade: the ambient glow wants "how much
 * low end is there right now", not a reading, and a larger FFT would buy
 * resolution nothing on the canvas can show.
 */
export const SUB_BASS_MIN_HZ = 20;
export const SUB_BASS_MAX_HZ = 150;

/** Bars in the equalizer mode. */
export const SPECTRUM_BAND_COUNT = 32;

/** Points traced by the oscilloscope. Enough to read as a curve, cheap to draw. */
export const OSCILLOSCOPE_SAMPLE_COUNT = 96;

/**
 * Share of the spectrum the equalizer spends bars on.
 *
 * The top quarter of a music spectrum is air and cymbal wash that never moves a
 * bar far off the floor, so bars spent there are bars wasted.
 */
const USABLE_SPECTRUM_FRACTION = 0.75;

/**
 * Curvature of the bar-to-bin mapping. Mild: at 128 bins across 32 bars a true
 * log layout collapses the low bars onto a single shared bin, so this bends the
 * layout toward the low end only as far as the resolution supports.
 */
const SPECTRUM_CURVE = 1.4;

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  return value > 1 ? 1 : value;
}

/** Width of one frequency bin in hertz. */
export function frequencyBinHz(sampleRate: number, binCount: number): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || binCount <= 0) return 0;
  return sampleRate / 2 / binCount;
}

/**
 * Mean magnitude across a hertz window, normalized to 0–1.
 *
 * Bin edges are taken inclusively — `floor` the low end, `ceil` the high — so a
 * window narrower than one bin still reads the bin it falls inside rather than
 * returning an empty range.
 */
export function bandEnergy(
  data: ArrayLike<number>,
  binHz: number,
  lowHz: number,
  highHz: number,
): number {
  if (data.length === 0 || binHz <= 0) return 0;

  const first = Math.max(0, Math.floor(lowHz / binHz));
  const last = Math.min(data.length - 1, Math.max(first, Math.ceil(highHz / binHz) - 1));

  let sum = 0;
  for (let i = first; i <= last; i += 1) sum += data[i];

  return clamp01(sum / (last - first + 1) / 255);
}

/** Ambient mode's drive signal: how much low end is on air, 0–1. */
export function subBassEnergy(data: ArrayLike<number>, binHz: number): number {
  return bandEnergy(data, binHz, SUB_BASS_MIN_HZ, SUB_BASS_MAX_HZ);
}

/**
 * Bin index boundaries for the equalizer's bars, `bandCount + 1` entries long.
 *
 * Strictly increasing by construction, so no two bars ever average the same
 * bins and no bin range comes out empty.
 */
export function spectrumBandEdges(binCount: number, bandCount: number): number[] {
  if (binCount <= 0 || bandCount <= 0) return [];

  const usable = Math.max(bandCount + 1, Math.floor(binCount * USABLE_SPECTRUM_FRACTION));
  const span = Math.min(binCount, usable) - 1;
  const denominator = Math.exp(SPECTRUM_CURVE) - 1;

  const edges: number[] = [];
  for (let band = 0; band <= bandCount; band += 1) {
    const curved = (Math.exp((SPECTRUM_CURVE * band) / bandCount) - 1) / denominator;
    // The running floor is what guarantees monotonicity once rounding is applied
    // near the bottom of the curve, where consecutive edges land close together.
    const previous = edges[band - 1] ?? -1;
    edges.push(Math.max(previous + 1, Math.round(curved * span)));
  }

  return edges;
}

/** Folds raw bins down to `bandCount` bar levels, each 0–1. */
export function foldToBands(
  data: ArrayLike<number>,
  bandCount: number = SPECTRUM_BAND_COUNT,
): number[] {
  if (bandCount <= 0) return [];
  if (data.length === 0) return new Array<number>(bandCount).fill(0);

  const edges = spectrumBandEdges(data.length, bandCount);
  const bands: number[] = [];

  for (let band = 0; band < bandCount; band += 1) {
    const start = Math.min(edges[band], data.length - 1);
    const end = Math.min(Math.max(edges[band + 1], start + 1), data.length);

    let sum = 0;
    for (let i = start; i < end; i += 1) sum += data[i];
    bands.push(clamp01(sum / (end - start) / 255));
  }

  return bands;
}

/**
 * Peak-hold indicators: a peak jumps to a new maximum instantly and falls back
 * at a fixed rate per frame. Mutates and returns `peaks`, which the render loop
 * owns across frames so nothing is allocated per frame.
 */
export function decayPeaks(
  peaks: number[],
  levels: readonly number[],
  decayPerFrame: number,
): number[] {
  for (let i = 0; i < levels.length; i += 1) {
    const held = (peaks[i] ?? 0) - decayPerFrame;
    peaks[i] = Math.max(levels[i], held > 0 ? held : 0);
  }
  peaks.length = levels.length;
  return peaks;
}

/**
 * Byte waveform (centred on 128) to `sampleCount` points in -1–1.
 *
 * Buckets are averaged rather than sampled: dropping points from a waveform
 * aliases it into a jagged mess at exactly the moments the trace should look
 * calmest.
 */
export function waveformFromBytes(
  data: ArrayLike<number>,
  sampleCount: number = OSCILLOSCOPE_SAMPLE_COUNT,
): number[] {
  if (sampleCount <= 0) return [];
  if (data.length === 0) return new Array<number>(sampleCount).fill(0);

  const points: number[] = [];
  const bucket = data.length / sampleCount;

  for (let i = 0; i < sampleCount; i += 1) {
    const start = Math.floor(i * bucket);
    const end = Math.max(start + 1, Math.floor((i + 1) * bucket));

    let sum = 0;
    for (let j = start; j < end && j < data.length; j += 1) sum += data[j] - 128;

    points.push(Math.max(-1, Math.min(1, sum / (end - start) / 128)));
  }

  return points;
}

/**
 * Whether a frame carries anything worth drawing.
 *
 * A graph with no reachable source hands back a buffer of zeros rather than
 * failing, and so does one whose only source is a cross-origin element the
 * browser has muted into the graph. Both look identical from here, which is
 * exactly what the caller needs to know before falling back.
 */
export function hasSignal(data: ArrayLike<number> | null, floor = 2): boolean {
  if (!data) return false;
  for (let i = 0; i < data.length; i += 1) {
    if (data[i] > floor) return true;
  }
  return false;
}

/**
 * Asymmetric smoothing: rises quickly, falls slowly.
 *
 * A symmetric filter either lags the attack or lets the release flicker. Split
 * rates give the glow a percussive lift and a musical tail from one line.
 */
export function smoothTowards(
  current: number,
  target: number,
  riseRate: number,
  fallRate: number,
): number {
  const rate = target > current ? riseRate : fallRate;
  return current + (target - current) * clamp01(rate);
}

/** Beats per minute the synthetic drive pulses at — a mid-tempo four-on-the-floor. */
const SYNTHETIC_BPM = 114;

/** Pulse shared by both synthetic sources, so glow and trace stay in step. */
function syntheticPulse(timeMs: number): number {
  const beats = (timeMs / 60000) * SYNTHETIC_BPM;
  // Squared sine: a sharper attack per beat than a plain sine's slow swell.
  return Math.sin(Math.PI * beats) ** 2;
}

/**
 * Stand-in spectrum for a source the graph cannot observe.
 *
 * Deterministic in `timeMs` so it never jitters between frames, tilted toward
 * the low end the way a mastered mix is, and driven by one shared pulse so the
 * bars move together instead of shimmering independently.
 */
export function syntheticSpectrum(
  bandCount: number = SPECTRUM_BAND_COUNT,
  timeMs: number = 0,
  intensity = 1,
): number[] {
  if (bandCount <= 0) return [];

  const seconds = timeMs / 1000;
  const pulse = syntheticPulse(timeMs);
  const drive = clamp01(intensity);
  const bands: number[] = [];

  for (let band = 0; band < bandCount; band += 1) {
    const position = band / bandCount;
    const tilt = (1 - position) ** 1.35;
    // Incommensurate rates per band: no two bars ever lock into the same cycle,
    // which is what keeps the row from reading as a single moving wave.
    const shimmer = Math.sin(seconds * (2.1 + band * 0.37) + band * 1.7) * 0.5 + 0.5;
    // Low bars follow the beat, high bars follow their own shimmer.
    const weighted = pulse * (1 - position * 0.65) + shimmer * (0.25 + position * 0.5);

    bands.push(clamp01(drive * tilt * (0.18 + 0.9 * weighted)));
  }

  return bands;
}

/**
 * Stand-in sub-bass level, in step with `syntheticSpectrum`'s low bars. The
 * ambient mode needs one number, so this saves it folding a whole spectrum to
 * read the bottom of it.
 */
export function syntheticSubBass(timeMs: number = 0, intensity = 1): number {
  return clamp01(clamp01(intensity) * (0.18 + 0.82 * syntheticPulse(timeMs)));
}

/** Stand-in waveform, pulsing in step with `syntheticSpectrum`. */
export function syntheticWaveform(
  sampleCount: number = OSCILLOSCOPE_SAMPLE_COUNT,
  timeMs: number = 0,
  intensity = 1,
): number[] {
  if (sampleCount <= 0) return [];

  const seconds = timeMs / 1000;
  const amplitude = clamp01(intensity) * (0.34 + 0.42 * syntheticPulse(timeMs));
  const points: number[] = [];

  for (let i = 0; i < sampleCount; i += 1) {
    const phase = (i / sampleCount) * Math.PI * 4 + seconds * 2.4;
    // Fundamental plus two drifting partials: reads as a musical trace rather
    // than the test tone a single sine would draw.
    const value =
      Math.sin(phase) + Math.sin(phase * 2.5 + seconds) * 0.3 + Math.sin(phase * 4.3) * 0.14;

    points.push(Math.max(-1, Math.min(1, value * amplitude * 0.7)));
  }

  return points;
}

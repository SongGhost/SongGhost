import { describe, expect, it } from "vitest";
import {
  bandEnergy,
  clamp01,
  decayPeaks,
  foldToBands,
  frequencyBinHz,
  hasSignal,
  OSCILLOSCOPE_SAMPLE_COUNT,
  SPECTRUM_BAND_COUNT,
  smoothTowards,
  spectrumBandEdges,
  subBassEnergy,
  SUB_BASS_MAX_HZ,
  SUB_BASS_MIN_HZ,
  syntheticSpectrum,
  syntheticSubBass,
  syntheticWaveform,
  waveformFromBytes,
} from "../spectrum";

/** A 48kHz context at the analyser's 256-point FFT. */
const BIN_COUNT = 128;
const SAMPLE_RATE = 48000;
const BIN_HZ = frequencyBinHz(SAMPLE_RATE, BIN_COUNT);

function bins(fill: (index: number) => number): Uint8Array {
  return Uint8Array.from({ length: BIN_COUNT }, (_, i) => fill(i));
}

describe("clamp01", () => {
  it("keeps levels inside 0–1 and treats a non-finite level as silence", () => {
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe("frequencyBinHz", () => {
  it("splits the nyquist range across the bins", () => {
    expect(frequencyBinHz(SAMPLE_RATE, BIN_COUNT)).toBe(187.5);
    expect(frequencyBinHz(44100, BIN_COUNT)).toBeCloseTo(172.27, 2);
  });

  it("reports zero for an unusable graph rather than dividing by it", () => {
    expect(frequencyBinHz(0, BIN_COUNT)).toBe(0);
    expect(frequencyBinHz(SAMPLE_RATE, 0)).toBe(0);
    expect(frequencyBinHz(Number.NaN, BIN_COUNT)).toBe(0);
  });
});

describe("bandEnergy", () => {
  it("normalizes byte magnitudes to 0–1", () => {
    expect(bandEnergy(bins(() => 255), BIN_HZ, 0, SAMPLE_RATE / 2)).toBe(1);
    expect(bandEnergy(bins(() => 0), BIN_HZ, 0, SAMPLE_RATE / 2)).toBe(0);
  });

  it("reads only the requested window", () => {
    // Energy parked well above the window must not leak into it.
    const highOnly = bins((i) => (i > 60 ? 255 : 0));
    expect(bandEnergy(highOnly, BIN_HZ, 0, 400)).toBe(0);
    expect(bandEnergy(highOnly, BIN_HZ, 12000, 20000)).toBeGreaterThan(0.9);
  });

  it("still reads the containing bin for a window narrower than one", () => {
    // 20–150Hz is inside the first bin at this resolution; an exclusive range
    // would come back empty instead of reporting the low end.
    const lowOnly = bins((i) => (i === 0 ? 200 : 0));
    expect(bandEnergy(lowOnly, BIN_HZ, SUB_BASS_MIN_HZ, SUB_BASS_MAX_HZ)).toBeCloseTo(200 / 255);
  });

  it("survives an empty frame or a dead bin width", () => {
    expect(bandEnergy(new Uint8Array(0), BIN_HZ, 20, 150)).toBe(0);
    expect(bandEnergy(bins(() => 255), 0, 20, 150)).toBe(0);
  });
});

describe("subBassEnergy", () => {
  it("tracks the low end and ignores the top", () => {
    const lowOnly = bins((i) => (i === 0 ? 255 : 0));
    const highOnly = bins((i) => (i > 40 ? 255 : 0));

    expect(subBassEnergy(lowOnly, BIN_HZ)).toBe(1);
    expect(subBassEnergy(highOnly, BIN_HZ)).toBe(0);
  });
});

describe("spectrumBandEdges", () => {
  it("hands every bar its own bins", () => {
    const edges = spectrumBandEdges(BIN_COUNT, SPECTRUM_BAND_COUNT);

    expect(edges).toHaveLength(SPECTRUM_BAND_COUNT + 1);
    for (let i = 1; i < edges.length; i += 1) {
      expect(edges[i]).toBeGreaterThan(edges[i - 1]);
    }
  });

  it("weights the low end without running past the bins it has", () => {
    const edges = spectrumBandEdges(BIN_COUNT, SPECTRUM_BAND_COUNT);
    const midpoint = edges[SPECTRUM_BAND_COUNT / 2];

    expect(edges[0]).toBe(0);
    expect(edges[edges.length - 1]).toBeLessThan(BIN_COUNT);
    // Half the bars cover well under half the spectrum.
    expect(midpoint).toBeLessThan(BIN_COUNT / 2);
  });

  it("stays monotonic when bars outnumber the bins available", () => {
    const edges = spectrumBandEdges(8, SPECTRUM_BAND_COUNT);
    for (let i = 1; i < edges.length; i += 1) {
      expect(edges[i]).toBeGreaterThan(edges[i - 1]);
    }
  });

  it("has nothing to lay out without bins or bars", () => {
    expect(spectrumBandEdges(0, 32)).toEqual([]);
    expect(spectrumBandEdges(128, 0)).toEqual([]);
  });
});

describe("foldToBands", () => {
  it("folds bins down to the requested bar count", () => {
    const bands = foldToBands(bins(() => 255), SPECTRUM_BAND_COUNT);

    expect(bands).toHaveLength(SPECTRUM_BAND_COUNT);
    for (const level of bands) expect(level).toBe(1);
  });

  it("places energy in the bars that cover it", () => {
    const bands = foldToBands(bins((i) => (i < 4 ? 255 : 0)), SPECTRUM_BAND_COUNT);

    expect(bands[0]).toBeGreaterThan(0);
    expect(bands[bands.length - 1]).toBe(0);
  });

  it("returns a silent row rather than nothing for an empty frame", () => {
    const bands = foldToBands(new Uint8Array(0), SPECTRUM_BAND_COUNT);

    expect(bands).toHaveLength(SPECTRUM_BAND_COUNT);
    expect(bands.every((level) => level === 0)).toBe(true);
  });
});

describe("decayPeaks", () => {
  it("jumps to a new maximum immediately", () => {
    const peaks = decayPeaks([0.1, 0.1], [0.9, 0.2], 0.01);
    expect(peaks).toEqual([0.9, 0.2]);
  });

  it("falls back at a fixed rate once the bar drops away", () => {
    const peaks = [0.9, 0.9];
    decayPeaks(peaks, [0, 0], 0.1);
    expect(peaks[0]).toBeCloseTo(0.8);

    decayPeaks(peaks, [0, 0], 0.1);
    expect(peaks[0]).toBeCloseTo(0.7);
  });

  it("never falls below silence", () => {
    const peaks = decayPeaks([0.05], [0], 1);
    expect(peaks[0]).toBe(0);
  });

  it("follows a change in bar count", () => {
    const peaks = decayPeaks([0.5, 0.5, 0.5], [0.2], 0.01);
    expect(peaks).toHaveLength(1);
  });
});

describe("waveformFromBytes", () => {
  it("centres a silent frame on zero", () => {
    const points = waveformFromBytes(new Uint8Array(256).fill(128));
    expect(points).toHaveLength(OSCILLOSCOPE_SAMPLE_COUNT);
    for (const point of points) expect(point).toBe(0);
  });

  it("maps the byte range onto -1–1", () => {
    expect(waveformFromBytes(new Uint8Array(256).fill(0), 4).every((p) => p === -1)).toBe(true);
    expect(waveformFromBytes(new Uint8Array(256).fill(255), 4)[0]).toBeCloseTo(127 / 128);
  });

  it("averages each bucket instead of dropping samples", () => {
    // Alternating extremes average out; a sampled downsample would alias them
    // into a full-scale square wave.
    const alternating = Uint8Array.from({ length: 256 }, (_, i) => (i % 2 === 0 ? 0 : 255));
    const points = waveformFromBytes(alternating, 8);
    for (const point of points) expect(Math.abs(point)).toBeLessThan(0.01);
  });

  it("returns a flat trace for an empty frame", () => {
    expect(waveformFromBytes(new Uint8Array(0), 4)).toEqual([0, 0, 0, 0]);
  });
});

describe("hasSignal", () => {
  it("reads a graph with no reachable source as silent", () => {
    expect(hasSignal(null)).toBe(false);
    expect(hasSignal(new Uint8Array(64))).toBe(false);
  });

  it("finds energy anywhere in the frame", () => {
    const sparse = new Uint8Array(64);
    sparse[63] = 40;
    expect(hasSignal(sparse)).toBe(true);
  });

  it("honours a caller's floor, so a flat waveform reads as silence", () => {
    // Digital silence in the time domain sits at 128, not 0.
    expect(hasSignal(new Uint8Array(64).fill(128), 130)).toBe(false);
    expect(hasSignal(new Uint8Array(64).fill(200), 130)).toBe(true);
  });
});

describe("smoothTowards", () => {
  it("rises faster than it falls", () => {
    const rise = smoothTowards(0, 1, 0.4, 0.05);
    const fall = 1 - smoothTowards(1, 0, 0.4, 0.05);

    expect(rise).toBeCloseTo(0.4);
    expect(fall).toBeCloseTo(0.05);
    expect(rise).toBeGreaterThan(fall);
  });

  it("converges on the target", () => {
    let level = 0;
    for (let i = 0; i < 200; i += 1) level = smoothTowards(level, 1, 0.4, 0.05);
    expect(level).toBeCloseTo(1, 5);
  });
});

describe("synthetic drive", () => {
  it("is deterministic in time, so frames never jitter", () => {
    expect(syntheticSpectrum(SPECTRUM_BAND_COUNT, 1234)).toEqual(
      syntheticSpectrum(SPECTRUM_BAND_COUNT, 1234),
    );
    expect(syntheticWaveform(OSCILLOSCOPE_SAMPLE_COUNT, 1234)).toEqual(
      syntheticWaveform(OSCILLOSCOPE_SAMPLE_COUNT, 1234),
    );
    expect(syntheticSubBass(1234)).toBe(syntheticSubBass(1234));
  });

  it("stays inside the ranges the renderers assume", () => {
    for (let timeMs = 0; timeMs < 4000; timeMs += 37) {
      for (const level of syntheticSpectrum(SPECTRUM_BAND_COUNT, timeMs)) {
        expect(level).toBeGreaterThanOrEqual(0);
        expect(level).toBeLessThanOrEqual(1);
      }
      for (const point of syntheticWaveform(OSCILLOSCOPE_SAMPLE_COUNT, timeMs)) {
        expect(Math.abs(point)).toBeLessThanOrEqual(1);
      }
      const glow = syntheticSubBass(timeMs);
      expect(glow).toBeGreaterThanOrEqual(0);
      expect(glow).toBeLessThanOrEqual(1);
    }
  });

  it("tilts toward the low end the way a mastered mix does", () => {
    const bands = syntheticSpectrum(SPECTRUM_BAND_COUNT, 900);
    const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

    expect(average(bands.slice(0, 8))).toBeGreaterThan(average(bands.slice(-8)));
  });

  it("goes still at zero intensity, which is what a parked frame draws", () => {
    expect(syntheticSpectrum(SPECTRUM_BAND_COUNT, 500, 0).every((l) => l === 0)).toBe(true);
    expect(syntheticWaveform(OSCILLOSCOPE_SAMPLE_COUNT, 500, 0).every((p) => p === 0)).toBe(true);
    expect(syntheticSubBass(500, 0)).toBe(0);
  });

  it("moves over time rather than holding one pose", () => {
    const first = syntheticSpectrum(SPECTRUM_BAND_COUNT, 0);
    const later = syntheticSpectrum(SPECTRUM_BAND_COUNT, 600);
    expect(later).not.toEqual(first);
  });

  it("has nothing to produce for an empty request", () => {
    expect(syntheticSpectrum(0, 100)).toEqual([]);
    expect(syntheticWaveform(0, 100)).toEqual([]);
  });
});

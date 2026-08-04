/**
 * Station idents and transition effects for the broadcast mix.
 *
 * Every effect is synthesized in JavaScript into an `AudioBuffer` at first use,
 * so the station ships a full SFX kit with no `.wav` payload to host, cache-bust,
 * or 404 on. Buffers are rendered once and replayed from that cache: a
 * transition allocates a source node and nothing else, which is what keeps a
 * skip's sweep at the head of the audio callback instead of behind a decode.
 *
 * The SFX bus hangs off master through `sfxGain` and is deliberately not routed
 * through the sidechain duck. The effect that matters most fires exactly as a DJ
 * break ends, so a ducked SFX channel would bury it under the break it closes.
 *
 * The whole kit is currently bypassed — see `SFX_ENABLED`.
 */

import type { StingerId, StingerPlayer } from "@/types/audio";
import { clampGain, sfxGain } from "./mix-bus";

/**
 * Master bypass for the synthesized SFX kit.
 *
 * While this is `false` the three playback methods return before touching the
 * audio graph, so no context is opened and nothing sounds. Everything else —
 * synthesis, the buffer cache, the bus, and the voice lifecycle — is left whole,
 * which makes bringing the scratch, sweep, and chime back a one-line change and
 * keeps the kit available to retune.
 *
 * Annotated `boolean` rather than inferred as the literal `false` so the guarded
 * bodies below do not read as unreachable code while the kit is off.
 */
export const SFX_ENABLED: boolean = false;

export const STINGER_IDS: readonly StingerId[] = [
  "vinyl_scratch",
  "frequency_sweep",
  "station_chime",
];

const VINYL_SCRATCH_SECONDS = 0.42;
const FREQUENCY_SWEEP_SECONDS = 0.6;
const STATION_CHIME_SECONDS = 1.1;

/** Render ceiling, leaving the bus trim room to work below full scale. */
const RENDER_PEAK = 0.9;

// ---- Procedural synthesis ---------------------------------------------------

/**
 * Deterministic noise source (mulberry32). A fixed seed keeps the scratch
 * identical on every render, so the kit has a fixed character instead of
 * re-rolling its grain each session — and it keeps the renderers testable.
 */
function createNoise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = Math.imul(state ^ (state >>> 15), 1 | state);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return (((x ^ (x >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/** Back-and-forth hand strokes across one scratch. */
const SCRATCH_STROKES = 2;

/**
 * Filtered noise shaped by platter velocity. Level and brightness both track
 * |velocity|, which is what reads as a record being pushed rather than a burst
 * of hiss, and the low sine under it supplies the body of the platter itself.
 */
function renderVinylScratch(samples: Float32Array, sampleRate: number): void {
  const noise = createNoise(0x5c8a7c11);
  const strokeSeconds = samples.length / sampleRate / SCRATCH_STROKES;
  let lowpass = 0;
  let platterPhase = 0;

  for (let i = 0; i < samples.length; i += 1) {
    const stroke = ((i / sampleRate) % strokeSeconds) / strokeSeconds;
    // Accelerates off the hand, stalls at the turn, accelerates back.
    const velocity = 1 - Math.abs(2 * stroke - 1);
    // Each successive stroke lands lighter, so the gesture resolves.
    const envelope = velocity * (1 - i / samples.length);

    lowpass += (noise() - lowpass) * (0.04 + 0.55 * velocity);
    const platterHz = 45 + 240 * velocity;
    const platter = Math.sin(platterPhase) * 0.35;
    platterPhase += (2 * Math.PI * platterHz) / sampleRate;

    samples[i] = (lowpass * 1.6 + platter) * envelope;
  }
}

const SWEEP_START_HZ = 180;
const SWEEP_END_HZ = 2600;
/** Modulator sits a fifth above the carrier, which is what gives the edge. */
const SWEEP_FM_RATIO = 1.5;
const SWEEP_FM_INDEX = 2.4;

/**
 * FM riser. The carrier glides exponentially so the sweep reads as musical
 * rather than linear-in-hertz, and the modulation index falls as it climbs so
 * the tail lands on a clean tone instead of a clang.
 */
function renderFrequencySweep(samples: Float32Array, sampleRate: number): void {
  const glide = SWEEP_END_HZ / SWEEP_START_HZ;
  let carrierPhase = 0;
  let modulatorPhase = 0;

  for (let i = 0; i < samples.length; i += 1) {
    const progress = i / samples.length;
    const carrierHz = SWEEP_START_HZ * glide ** progress;
    const modulation = Math.sin(modulatorPhase) * SWEEP_FM_INDEX * (1 - progress);
    // Hann window: no click at either edge of the whoosh.
    const envelope = 0.5 - 0.5 * Math.cos(2 * Math.PI * progress);

    samples[i] = Math.sin(carrierPhase + modulation) * envelope;

    carrierPhase += (2 * Math.PI * carrierHz) / sampleRate;
    modulatorPhase += (2 * Math.PI * carrierHz * SWEEP_FM_RATIO) / sampleRate;
  }
}

/** G5 — high enough to cut through a fade, low enough not to be shrill. */
const CHIME_ROOT_HZ = 784;

/** Inharmonic-ish partials with faster decay up the series: a bell, not an organ. */
const CHIME_PARTIALS: readonly { ratio: number; gain: number; decay: number }[] = [
  { ratio: 1, gain: 1, decay: 3.2 },
  { ratio: 1.5, gain: 0.55, decay: 4.4 },
  { ratio: 2, gain: 0.32, decay: 6 },
  { ratio: 2.5, gain: 0.16, decay: 8.5 },
];

const CHIME_ATTACK_SECONDS = 0.006;
/** Seconds of fade at the buffer edge, so a truncated decay cannot click. */
const CHIME_TAIL_SECONDS = 0.025;

function renderStationChime(samples: Float32Array, sampleRate: number): void {
  const duration = samples.length / sampleRate;

  for (let i = 0; i < samples.length; i += 1) {
    const t = i / sampleRate;
    const attack = Math.min(1, t / CHIME_ATTACK_SECONDS);
    const tail = Math.min(1, (duration - t) / CHIME_TAIL_SECONDS);

    let value = 0;
    for (const partial of CHIME_PARTIALS) {
      value +=
        Math.sin(2 * Math.PI * CHIME_ROOT_HZ * partial.ratio * t) *
        partial.gain *
        Math.exp(-t * partial.decay);
    }

    samples[i] = value * attack * tail;
  }
}

const RENDERERS: Record<
  StingerId,
  { seconds: number; render: (samples: Float32Array, sampleRate: number) => void }
> = {
  vinyl_scratch: { seconds: VINYL_SCRATCH_SECONDS, render: renderVinylScratch },
  frequency_sweep: { seconds: FREQUENCY_SWEEP_SECONDS, render: renderFrequencySweep },
  station_chime: { seconds: STATION_CHIME_SECONDS, render: renderStationChime },
};

/**
 * Scales a rendered effect to a fixed peak. Each renderer sums an arbitrary
 * number of partials, so without this the kit's effects would arrive at wildly
 * different levels and the bus trim would mean something different for each.
 */
function normalizePeak(samples: Float32Array, peak: number): void {
  let loudest = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const magnitude = Math.abs(samples[i]);
    if (magnitude > loudest) loudest = magnitude;
  }

  if (loudest === 0) return;

  const scale = peak / loudest;
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] *= scale;
  }
}

/** Synthesizes one effect into a mono buffer at the context's sample rate. */
export function renderStinger(context: BaseAudioContext, id: StingerId): AudioBuffer {
  const spec = RENDERERS[id];
  const length = Math.max(1, Math.round(spec.seconds * context.sampleRate));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const samples = buffer.getChannelData(0);

  spec.render(samples, context.sampleRate);
  normalizePeak(samples, RENDER_PEAK);

  return buffer;
}

// ---- Engine -----------------------------------------------------------------

export type StingerEngineOptions = {
  /** Injection seam for tests and non-DOM runtimes. */
  createContext?: () => AudioContext | null;
};

function defaultAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;

  const Constructor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  return Constructor ? new Constructor() : null;
}

type SfxBus = { context: AudioContext; output: GainNode };

export class StingerEngine implements StingerPlayer {
  private readonly createContext: () => AudioContext | null;
  private readonly buffers = new Map<StingerId, AudioBuffer>();
  /** One live source per effect — see `trigger` for why it can't be more. */
  private readonly voices = new Map<StingerId, Set<AudioBufferSourceNode>>();

  private bus: SfxBus | null = null;
  /**
   * Set once a context factory has failed. Without it every trigger would retry
   * construction, and a runtime with no Web Audio would pay that cost forever.
   */
  private contextUnavailable = false;
  private unlocked = false;
  private masterVolume = 1;
  private destroyed = false;

  constructor(options: StingerEngineOptions = {}) {
    this.createContext = options.createContext ?? defaultAudioContext;
  }

  // ---- Levels -------------------------------------------------------------

  getMasterVolume(): number {
    return this.masterVolume;
  }

  /**
   * Takes master, not a mixed level: the SFX bus rides the fader directly, so
   * ducking has no way in and a fader move lands on effects already ringing.
   */
  setMasterVolume(normalized: number): void {
    this.masterVolume = clampGain(normalized);
    if (this.bus) this.bus.output.gain.value = sfxGain(this.masterVolume);
  }

  // ---- Lifecycle ----------------------------------------------------------

  /**
   * Renders the whole kit up front. Called from `unlock` so the first
   * transition of a session plays from cache like every later one.
   */
  prepare(): void {
    const bus = this.ensureBus();
    if (!bus) return;
    STINGER_IDS.forEach((id) => this.getBuffer(bus.context, id));
  }

  /**
   * Gesture hook. A context built outside a user gesture starts suspended, so
   * the session's first click is where the bus is opened and the kit rendered.
   */
  unlock(): void {
    const bus = this.ensureBus();
    if (!bus) return;

    this.unlocked = true;
    this.prepare();
    this.resumeIfSuspended(bus.context);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    STINGER_IDS.forEach((id) => this.stopVoices(id));
    this.buffers.clear();

    const bus = this.bus;
    this.bus = null;
    if (!bus) return;

    attempt(() => bus.output.disconnect());
    attempt(() => bus.context.close?.()?.catch(() => {}));
  }

  // ---- Playback -----------------------------------------------------------

  playVinylScratch(): void {
    if (!SFX_ENABLED) return;
    this.trigger("vinyl_scratch");
  }

  playFrequencySweep(): void {
    if (!SFX_ENABLED) return;
    this.trigger("frequency_sweep");
  }

  playStationChime(): void {
    if (!SFX_ENABLED) return;
    this.trigger("station_chime");
  }

  private trigger(id: StingerId): void {
    if (this.destroyed) return;

    const bus = this.ensureBus();
    if (!bus) return;

    const { context, output } = bus;
    if (context.state === "closed") return;

    if (context.state === "suspended") {
      this.resumeIfSuspended(context);
      // Before the first gesture there is nothing to resume into: a source
      // started on a sleeping context would fire whenever it eventually wakes,
      // stranding a launch sweep in the middle of an unrelated track.
      if (!this.unlocked) return;
    }

    const buffer = this.getBuffer(context, id);
    if (!buffer) return;

    // An identical effect still ringing would only build level and comb against
    // itself, so the newer trigger takes the slot: a spammed skip stays one
    // sweep rather than five stacked ones.
    this.stopVoices(id);

    const source = safely(() => context.createBufferSource());
    if (!source) return;

    source.buffer = buffer;
    source.connect(output);

    const voices = this.voices.get(id) ?? new Set<AudioBufferSourceNode>();
    voices.add(source);
    this.voices.set(id, voices);

    source.onended = () => {
      voices.delete(source);
      attempt(() => source.disconnect());
    };

    if (!attempt(() => source.start())) {
      voices.delete(source);
      attempt(() => source.disconnect());
    }
  }

  private stopVoices(id: StingerId): void {
    const voices = this.voices.get(id);
    if (!voices) return;

    voices.forEach((source) => {
      // Cleared first: the stop below fires `ended`, and letting it run would
      // mutate the set being iterated.
      source.onended = null;
      attempt(() => source.stop());
      attempt(() => source.disconnect());
    });

    voices.clear();
  }

  // ---- Wiring -------------------------------------------------------------

  private ensureBus(): SfxBus | null {
    if (this.destroyed || this.contextUnavailable) return null;
    if (this.bus) return this.bus;

    const context = safely(() => this.createContext());
    if (!context) {
      this.contextUnavailable = true;
      return null;
    }

    const output = safely(() => context.createGain());
    if (!output) {
      this.contextUnavailable = true;
      return null;
    }

    output.gain.value = sfxGain(this.masterVolume);
    if (!attempt(() => output.connect(context.destination))) {
      this.contextUnavailable = true;
      return null;
    }

    this.bus = { context, output };
    return this.bus;
  }

  /**
   * Cached for the life of the engine: re-rendering per transition would churn
   * a few hundred kilobytes through the GC on every skip, for a buffer whose
   * contents never change.
   */
  private getBuffer(context: BaseAudioContext, id: StingerId): AudioBuffer | null {
    const cached = this.buffers.get(id);
    if (cached) return cached;

    const buffer = safely(() => renderStinger(context, id));
    if (!buffer) return null;

    this.buffers.set(id, buffer);
    return buffer;
  }

  private resumeIfSuspended(context: AudioContext): void {
    if (context.state !== "suspended") return;
    attempt(() => context.resume?.()?.catch(() => {}));
  }
}

/**
 * Runs a Web Audio call that may throw on an unusable graph, reporting failure
 * as `null`. Effects are garnish: a browser that refuses one must not take the
 * broadcast down with it.
 */
function safely<T>(operation: () => T | null): T | null {
  try {
    return operation();
  } catch {
    return null;
  }
}

/** `safely` for calls made for their effect rather than their result. */
function attempt(operation: () => unknown): boolean {
  try {
    operation();
    return true;
  } catch {
    return false;
  }
}

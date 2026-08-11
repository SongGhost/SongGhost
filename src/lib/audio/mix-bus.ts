/**
 * Gain staging for the three broadcast channels: music, DJ voice, and SFX, plus
 * the master analyser tap the visualizer reads.
 *
 * All three channels derive their level from the same master fader (0–1), but
 * only the music channel is routed through the sidechain duck gain. Keeping the
 * derivations in one module is what makes "never duck the voice" a structural
 * guarantee rather than a convention each call site has to remember.
 *
 * The analyser lives here for the same reason: it hangs off the master output
 * node, so the one module that already owns "what master means" is also the one
 * that hands out the metering. See the analyser section for what it can and
 * cannot observe.
 */

/**
 * Music level while the DJ is speaking, as a fraction of master.
 * Calibrated below the prior 25% so loudness-maximized music clearly yields
 * to the host without disappearing entirely.
 */
export const DUCK_RATIO = 0.18;
export const DUCK_RAMP_MS = 300;
export const RESTORE_RAMP_MS = 1500;

/** Duck gain when no break is on air — music sits at full master. */
export const UNDUCKED_GAIN = 1;

/**
 * TTS clips arrive with far more headroom than loudness-maximized music
 * masters, so a voice riding raw master drops under the room noise floor long
 * before the music does. This floor keeps a break intelligible at low master
 * without letting the DJ outrun a deliberately quiet fader.
 */
export const MIN_VOICE_GAIN = 0.1;

/**
 * Extra gain applied to DJ speech so ElevenLabs / OpenAI TTS matches commercial
 * music loudness. Clamped by `clampGain` / HTMLAudioElement (max 1.0).
 */
export const VOICE_HEADROOM_BOOST = 1.35;

export function clampGain(gain: number): number {
  if (!Number.isFinite(gain)) return 0;
  if (gain <= 0) return 0;
  return Math.min(1, gain);
}

/**
 * Music channel level. `duckGain` is relative to master, so the ducked music
 * keeps tracking the fader while a break is on air instead of being pinned to
 * whatever master happened to be when the duck started.
 */
export function musicGain(masterVolume: number, duckGain: number = UNDUCKED_GAIN): number {
  return clampGain(clampGain(masterVolume) * clampGain(duckGain));
}

/** Music channel level as 0–100, the scale the YouTube IFrame API expects. */
export function musicVolumePercent(
  masterVolume: number,
  duckGain: number = UNDUCKED_GAIN,
): number {
  return Math.round(musicGain(masterVolume, duckGain) * 100);
}

/**
 * Voice channel level. Deliberately takes no duck gain: ducking exists to
 * clear room for this channel, so attenuating it here would cancel the effect
 * out. A muted master still mutes the voice.
 *
 * `djVolumeNormalized` is the Host Settings DJ Voice Volume slider (0–100%)
 * already normalized to 0–1. Effective gain:
 *   masterGain * (djVolume / 100) * VOICE_HEADROOM_BOOST
 * ≡ masterGain * djVolumeNormalized * VOICE_HEADROOM_BOOST
 */
export function voiceGain(
  masterVolume: number,
  djVolumeNormalized: number = 1,
): number {
  const master = clampGain(masterVolume);
  if (master === 0) return 0;
  const dj = clampGain(djVolumeNormalized);
  if (dj === 0) return 0;
  return clampGain(master * dj * VOICE_HEADROOM_BOOST);
}

/**
 * Station stingers and scratches are punctuation, not program material, so the
 * SFX bus sits under unity: an effect should mark a transition without jumping
 * out of the mix the way a full-scale synthesized burst would.
 */
export const SFX_TRIM = 0.7;

/**
 * SFX channel level. Like the voice channel it takes no duck gain — the effect
 * that matters most fires as a break *ends*, and routing it through the duck
 * would bury it under the break it is there to close.
 */
export function sfxGain(masterVolume: number): number {
  return clampGain(clampGain(masterVolume) * SFX_TRIM);
}

// ---- Master analyser tap ----------------------------------------------------

/**
 * 256-point FFT: 128 bins, ~187Hz apart on a 48kHz context. Coarse enough that
 * a read costs nothing on an animation frame, fine enough to separate sub-bass
 * from the rest of the spectrum, which is the only band the ambient mode needs.
 */
export const ANALYSER_FFT_SIZE = 256;

/**
 * Inter-frame averaging applied by the analyser itself. High, because the
 * visualizer is a mood light rather than a measurement tool: unsmoothed bins
 * strobe at 60fps behind text that has to stay readable.
 */
export const ANALYSER_SMOOTHING = 0.75;

/**
 * Master bypass for the analyser tap.
 *
 * While this is `false` nothing opens a context and no media element is ever
 * rerouted, so playback runs exactly as it did before the visualizer existed
 * and the canvas falls back to its synthetic drive. Kept as an escape hatch
 * because capturing an element moves its output into the audio graph for the
 * rest of that element's life — an irreversible step for a purely decorative
 * feature.
 *
 * Annotated `boolean` rather than inferred as the literal `true` so the guarded
 * branches below do not read as unreachable while the tap is on.
 */
export const ANALYSER_TAP_ENABLED: boolean = true;

/**
 * Read-only metering surface. UI components take this rather than the bus so a
 * canvas can never reach the audio graph it is drawing.
 */
export type AudioAnalyserTap = {
  /** Byte magnitude per frequency bin (0–255), or `null` with no live graph. */
  getFrequencyData(): Uint8Array | null;
  /** Byte waveform centred on 128 (0–255), or `null` with no live graph. */
  getByteTimeDomainData(): Uint8Array | null;
  /** Context sample rate, needed to turn a bin index into hertz. */
  getSampleRate(): number | null;
  /** Whether a graph is open and at least one source is routed through it. */
  isLive(): boolean;
};

/**
 * The routing half of the tap, as the channels that own media elements see it.
 * Narrow on purpose: a channel should be able to offer its element for metering
 * without gaining the ability to read the mix back.
 */
export type MediaAnalyserTap = {
  /** Routes an element through the master output. `false` if it was declined. */
  captureMediaElement(element: HTMLMediaElement): boolean;
  releaseMediaElement(element: HTMLMediaElement): void;
};

export type MasterAnalyserOptions = {
  /** Injection seam for tests and non-DOM runtimes. */
  createContext?: () => AudioContext | null;
};

function defaultAnalyserContext(): AudioContext | null {
  if (typeof window === "undefined") return null;

  const Constructor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  return Constructor ? new Constructor() : null;
}

type AnalyserGraph = {
  context: AudioContext;
  /** Master output node. Everything metered passes through here. */
  output: GainNode;
  analyser: AnalyserNode;
};

/**
 * The master output node and the analyser hanging off it.
 *
 * What this can observe is decided by the source, not by this class: an
 * `HTMLMediaElement` can be captured (DJ voice clips, and — via
 * `Html5TrackProvider` — direct/native music playback such as iTunes preview
 * clips) and an `AudioNode` can be connected (the synthesized SFX kit), but a
 * station whose music plays inside a cross-origin YouTube IFrame gives Web
 * Audio no access at all. So a station on the embed reports no signal here,
 * and the visualizer's synthetic drive covers that case.
 *
 * Every Web Audio call is guarded: metering is decoration, so a browser that
 * refuses part of the graph must not take the broadcast down with it.
 */
export class MasterAnalyser implements AudioAnalyserTap, MediaAnalyserTap {
  private readonly createContext: () => AudioContext | null;
  private graph: AnalyserGraph | null = null;
  /**
   * `createMediaElementSource` throws on an element that already has a source
   * node, and the node has to outlive the capture to keep routing audio.
   */
  private readonly captures = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
  private sourceCount = 0;
  /**
   * Set once a context factory has failed. Without it every capture would retry
   * construction, and a runtime with no Web Audio would pay that cost forever.
   */
  private contextUnavailable = false;
  private destroyed = false;

  // Reused across frames: allocating two arrays per frame at 60fps is the one
  // way a byte read of 128 bins becomes expensive.
  private readonly frequencyBuffer = new Uint8Array(ANALYSER_FFT_SIZE / 2);
  private readonly timeDomainBuffer = new Uint8Array(ANALYSER_FFT_SIZE);

  constructor(options: MasterAnalyserOptions = {}) {
    this.createContext = options.createContext ?? defaultAnalyserContext;
  }

  // ---- Wiring -------------------------------------------------------------

  /**
   * Master output node, for callers that own an `AudioNode` and want to route
   * it through the metering themselves. `null` when no graph could be opened.
   */
  getMasterOutput(): GainNode | null {
    return this.ensureGraph()?.output ?? null;
  }

  /** Routes an existing Web Audio source through the master output. */
  connect(node: AudioNode): boolean {
    if (!ANALYSER_TAP_ENABLED || this.destroyed) return false;

    const graph = this.ensureGraph();
    if (!graph) return false;
    if (!attempt(() => node.connect(graph.output))) return false;

    this.sourceCount += 1;
    return true;
  }

  /**
   * Routes a media element's audio through the master output so its spectrum
   * can be read.
   *
   * Deliberately refuses unless the context is already running. Capturing an
   * element moves its output into the graph permanently, and a graph that is
   * suspended — which is every graph built outside a user gesture — plays
   * nothing. Declining here leaves the element on native playback, which costs
   * a visualization and protects the audio.
   */
  captureMediaElement(element: HTMLMediaElement): boolean {
    if (!ANALYSER_TAP_ENABLED || this.destroyed) return false;
    if (this.captures.has(element)) return true;

    const graph = this.ensureGraph();
    if (!graph || graph.context.state !== "running") return false;

    const source = safely(() => graph.context.createMediaElementSource(element));
    if (!source) return false;

    if (!attempt(() => source.connect(graph.output))) {
      attempt(() => source.disconnect());
      return false;
    }

    this.captures.set(element, source);
    this.sourceCount += 1;
    return true;
  }

  /**
   * Drops a captured element's source node when its clip is torn down.
   *
   * This releases the node, not the capture: an element whose output has been
   * moved into the graph keeps it there for the rest of its life, which is why
   * `captureMediaElement` is careful about when it agrees to do so.
   */
  releaseMediaElement(element: HTMLMediaElement): void {
    const source = this.captures.get(element);
    if (!source) return;

    this.captures.delete(element);
    this.sourceCount = Math.max(0, this.sourceCount - 1);
    attempt(() => source.disconnect());
  }

  /**
   * Gesture hook. A context built outside a user gesture starts suspended, and
   * `captureMediaElement` refuses to reroute audio into a suspended graph — so
   * without this the tap would never take a source in a browser that enforces
   * the autoplay policy.
   */
  unlock(): void {
    if (!ANALYSER_TAP_ENABLED) return;

    const graph = this.ensureGraph();
    if (!graph || graph.context.state !== "suspended") return;
    attempt(() => graph.context.resume?.()?.catch(() => {}));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    const graph = this.graph;
    this.graph = null;
    this.sourceCount = 0;
    if (!graph) return;

    attempt(() => graph.analyser.disconnect());
    attempt(() => graph.output.disconnect());
    attempt(() => graph.context.close?.()?.catch(() => {}));
  }

  // ---- Metering -----------------------------------------------------------

  isLive(): boolean {
    return Boolean(this.graph) && this.sourceCount > 0;
  }

  getSampleRate(): number | null {
    return this.graph?.context.sampleRate ?? null;
  }

  /** AudioContext lifecycle state for launch-path diagnostics. */
  getAudioContextState(): AudioContextState | "unavailable" {
    return this.ensureGraph()?.context.state ?? "unavailable";
  }

  /**
   * Byte magnitudes for the current frame. The returned view is reused on every
   * call, so a caller that needs to keep a frame must copy it.
   */
  getFrequencyData(): Uint8Array | null {
    const graph = this.graph;
    if (!graph || this.sourceCount === 0) return null;
    if (!attempt(() => graph.analyser.getByteFrequencyData(this.frequencyBuffer))) return null;
    return this.frequencyBuffer;
  }

  /** Byte waveform for the current frame. Same reused-view contract. */
  getByteTimeDomainData(): Uint8Array | null {
    const graph = this.graph;
    if (!graph || this.sourceCount === 0) return null;
    if (!attempt(() => graph.analyser.getByteTimeDomainData(this.timeDomainBuffer))) return null;
    return this.timeDomainBuffer;
  }

  // ---- Graph construction -------------------------------------------------

  private ensureGraph(): AnalyserGraph | null {
    if (!ANALYSER_TAP_ENABLED || this.destroyed || this.contextUnavailable) return null;
    if (this.graph) return this.graph;

    const context = safely(() => this.createContext());
    if (!context) {
      this.contextUnavailable = true;
      return null;
    }

    const output = safely(() => context.createGain());
    const analyser = safely(() => context.createAnalyser());
    if (!output || !analyser) {
      this.contextUnavailable = true;
      return null;
    }

    // Unity: the per-channel gains upstream already carry the fader, so trimming
    // again here would both change the mix and misreport what is on air.
    output.gain.value = UNDUCKED_GAIN;
    attempt(() => {
      analyser.fftSize = ANALYSER_FFT_SIZE;
      analyser.smoothingTimeConstant = ANALYSER_SMOOTHING;
    });

    // Flat music path: source → unity GainNode → destination. The analyser is a
    // side-tap only — never insert BiquadFilter, DynamicsCompressor, or other EQ
    // on this bus. Voice-only coloration (telephone bandpass, etc.) belongs on
    // dedicated call-in chains, not the shared music/voice meter bus.
    const wired =
      attempt(() => output.connect(context.destination)) &&
      attempt(() => output.connect(analyser));

    if (!wired) {
      this.contextUnavailable = true;
      return null;
    }

    this.graph = { context, output, analyser };
    return this.graph;
  }
}

let sharedAnalyser: MasterAnalyser | null = null;

/**
 * The session's analyser. Lazy so importing this module on the server — or in a
 * test runner — never reaches for an `AudioContext`.
 */
export function getMasterAnalyser(): MasterAnalyser {
  if (!sharedAnalyser) sharedAnalyser = new MasterAnalyser();
  return sharedAnalyser;
}

/** Test seam: drops the shared analyser so the next call builds a fresh one. */
export function resetMasterAnalyser(): void {
  sharedAnalyser?.destroy();
  sharedAnalyser = null;
}

/**
 * Runs a Web Audio call that may throw on an unusable graph, reporting failure
 * as `null`.
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

/**
 * DJ speech playback, decoupled from music playback.
 *
 * The node owns one clip at a time: buffer, object URL, element, and the
 * sidechain duck it holds on the music bus. Because the duck is released from
 * the same place the clip is torn down, a skip mid-break can't strand the music
 * channel at the ducked ratio — every exit path (ended, error, abort,
 * superseded) runs the same release.
 *
 * One further clip may be held warm: `preload` decodes the next break while the
 * outgoing track still has audio left, so `play` on that same blob starts from
 * an element that is already buffered instead of one that has to fetch and
 * decode at the transition.
 *
 * Synthesis happens upstream, so the node plays a buffer from any TTS backend
 * without knowing which one produced it.
 *
 * Each clip is also offered to the master analyser for the life of that clip.
 * The tap is decoration and may decline, so nothing about playback depends on
 * it being taken.
 */

import type {
  VoiceDeliveryMode,
  VoiceNode,
  VoicePlaybackOptions,
  VoiceProviderId,
  VolumeController,
} from "@/types/audio";
import { waitForAudioEnd, waitForAudioReady } from "../volume-ramp";
import {
  clampGain,
  DUCK_RAMP_MS,
  DUCK_RATIO,
  getMasterAnalyser,
  RESTORE_RAMP_MS,
  UNDUCKED_GAIN,
  voiceGain,
  type MediaAnalyserTap,
} from "./mix-bus";
import { createVolumeController } from "./volume-controller";

export type VoiceNodeEventHandlers = {
  onStarted?: () => void;
  onEnded?: () => void;
  onError?: (error: Error) => void;
};

export type BufferedVoicePlayOptions = VoicePlaybackOptions & {
  /** Raw TTS payload. The node owns the object URL for the life of the clip. */
  audioBlob?: Blob;
  /**
   * Fired on the break's exit boundary: speech is over and the music bus has
   * just been handed its restore ramp. This is where a transition effect belongs
   * — waiting for `play` to settle would put it a full ramp-out late, with the
   * music already back at full level.
   *
   * Skipped for a break that was aborted or superseded, since neither reached an
   * exit worth marking.
   */
  onRestore?: () => void;
};

/**
 * The slice of a voice node a DJ break needs. Keeps callers such as
 * `playDjIntro` off the concrete class.
 */
export type VoiceSpeaker = {
  play(options: BufferedVoicePlayOptions): Promise<void>;
  stop(): void;
};

export type BufferedVoiceNodeOptions = {
  providerId?: VoiceProviderId;
  /** Injection seams for tests and non-DOM runtimes. */
  createAudio?: (src: string) => HTMLAudioElement;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  /** Metering tap for the voice channel. Defaults to the session analyser. */
  analyser?: MediaAnalyserTap;
};

/** A break warmed ahead of the transition it belongs to. */
type PreloadedClip = {
  blob: Blob;
  url: string;
  audio: HTMLAudioElement;
};

/**
 * Ceiling on how long a warm-up may block. The lookahead starts well ahead of
 * the transition, so this only bounds a decode that has effectively stalled.
 */
const PRELOAD_DECODE_TIMEOUT_MS = 8000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class BufferedVoiceNode implements VoiceNode, VoiceSpeaker {
  /**
   * Mutable so the UI's TTS picker is reflected without rebuilding the node
   * mid-session; it is metadata only, since the clip arrives pre-synthesized.
   */
  providerId: VoiceProviderId;
  readonly deliveryMode: VoiceDeliveryMode = "buffered";

  private handlers: VoiceNodeEventHandlers = {};
  private masterVolume = 1;
  private audio: HTMLAudioElement | null = null;
  private activeAbort: AbortController | null = null;
  private volumeController: VolumeController | null = null;
  /** Bumped per clip so a superseded break never releases the new one's duck. */
  private playbackGeneration = 0;
  /** At most one warmed clip; a second `preload` replaces the first. */
  private preloaded: PreloadedClip | null = null;

  private readonly createAudio: (src: string) => HTMLAudioElement;
  private readonly createObjectUrl: (blob: Blob) => string;
  private readonly revokeObjectUrl: (url: string) => void;
  private readonly analyser: MediaAnalyserTap;

  constructor(options: BufferedVoiceNodeOptions = {}) {
    this.providerId = options.providerId ?? "openai";
    this.createAudio = options.createAudio ?? ((src) => new Audio(src));
    this.createObjectUrl = options.createObjectUrl ?? ((blob) => URL.createObjectURL(blob));
    this.revokeObjectUrl = options.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url));
    this.analyser = options.analyser ?? getMasterAnalyser();
  }

  setEventHandlers(handlers: VoiceNodeEventHandlers): void {
    this.handlers = handlers;
  }

  isSpeaking(): boolean {
    return this.audio !== null;
  }

  // ---- Levels -------------------------------------------------------------

  getVolume(): number {
    return this.masterVolume;
  }

  /**
   * Takes master, not a mixed level: the voice rides the fader directly so a
   * move mid-break lands on the live clip, and ducking never reaches here.
   */
  setVolume(normalized: number): void {
    this.masterVolume = clampGain(normalized);
    if (this.audio) this.audio.volume = voiceGain(this.masterVolume);
  }

  getVolumeController(): VolumeController {
    if (!this.volumeController) {
      this.volumeController = createVolumeController({
        getVolume: () => this.getVolume(),
        setVolume: (normalized) => this.setVolume(normalized),
      });
    }
    return this.volumeController;
  }

  // ---- Lookahead warming --------------------------------------------------

  /**
   * Decodes a synthesized break ahead of the transition it belongs to. A later
   * `play` on the same blob adopts this element, which is what lets the break
   * open the moment the outgoing track ends.
   */
  async preload(blob: Blob): Promise<void> {
    this.discardPreload();

    const url = this.createObjectUrl(blob);
    const audio = this.createAudio(url);
    audio.preload = "auto";
    audio.volume = voiceGain(this.masterVolume);

    const clip: PreloadedClip = { blob, url, audio };
    this.preloaded = clip;

    try {
      await waitForAudioReady(audio, PRELOAD_DECODE_TIMEOUT_MS);
    } catch (error) {
      // A clip that will not decode is worse than no head start: drop it so
      // the transition falls back to a fresh element.
      if (this.preloaded === clip) this.discardPreload();
      throw error;
    }
  }

  /** Whether `blob` is the clip currently held warm. */
  isWarmedFor(blob: Blob): boolean {
    return this.preloaded?.blob === blob;
  }

  /** Releases a warmed clip that will not be played. */
  discardPreload(): void {
    const clip = this.preloaded;
    if (!clip) return;

    this.preloaded = null;
    clip.audio.pause();
    this.releaseElement(clip.audio);
    this.revokeObjectUrl(clip.url);
  }

  // ---- Playback -----------------------------------------------------------

  async play(options: BufferedVoicePlayOptions): Promise<void> {
    const { audioBlob, audioUrl, signal, duckingTarget, ducking, onRestore } = options;

    const warmed = audioBlob && this.preloaded?.blob === audioBlob ? this.preloaded : null;

    let src: string;
    let ownedUrl: string | null;

    if (warmed) {
      this.preloaded = null;
      src = warmed.url;
      ownedUrl = warmed.url;
    } else if (audioBlob) {
      src = this.createObjectUrl(audioBlob);
      ownedUrl = src;
    } else if (audioUrl) {
      src = audioUrl;
      ownedUrl = null;
    } else {
      throw new Error("VoiceNode.play requires an audio blob or url");
    }

    // Anything still warm was queued for a transition this clip has overtaken.
    if (!warmed) this.discardPreload();

    const duckRatio = ducking?.duckRatio ?? DUCK_RATIO;
    const rampInMs = ducking?.rampInMs ?? DUCK_RAMP_MS;
    const rampOutMs = ducking?.rampOutMs ?? RESTORE_RAMP_MS;

    // Only one break holds the voice channel; whatever is on air yields now.
    this.stop();

    const generation = ++this.playbackGeneration;
    const controller = this.linkAbort(signal);

    const audio = warmed ? warmed.audio : this.createAudio(src);
    audio.volume = voiceGain(this.masterVolume);
    this.audio = audio;

    // Offers the break to the master analyser so the visualizer moves with the
    // host's voice. Element volume is applied ahead of the tap, so the clip
    // still rides `voiceGain`; a refusal leaves it on native playback.
    this.analyser.captureMediaElement(audio);

    const onAbort = () => audio.pause();
    controller.signal.addEventListener("abort", onAbort, { once: true });

    /** Distinguishes a break that reached its exit from one that was cut short. */
    let playedThrough = false;

    try {
      if (!controller.signal.aborted) {
        duckingTarget?.rampVolume(UNDUCKED_GAIN, duckRatio, rampInMs);
        this.handlers.onStarted?.();
      }

      await audio.play();
      await waitForAudioEnd(audio, controller.signal);

      if (!controller.signal.aborted) {
        playedThrough = true;
        this.handlers.onEnded?.();
      }
    } catch (error) {
      const failure = error as Error;
      if (!controller.signal.aborted && failure.name !== "AbortError") {
        this.handlers.onError?.(failure);
      }
      throw failure;
    } finally {
      controller.signal.removeEventListener("abort", onAbort);

      if (this.audio === audio) this.audio = null;
      if (this.activeAbort === controller) this.activeAbort = null;
      this.analyser.releaseMediaElement(audio);
      // Drops the element's own hold on the resource before the URL behind it
      // is invalidated — belt-and-suspenders alongside the revoke below for a
      // session that skips through hundreds of breaks without a reload.
      this.releaseElement(audio);
      if (ownedUrl) this.revokeObjectUrl(ownedUrl);

      // A replacement break may already be ducking. Releasing here would
      // unduck the music underneath it.
      const superseded = this.playbackGeneration !== generation;

      // Ahead of the ramp below, and independent of whether this break ducked
      // anything: the cue marks the end of the speech, not the end of a duck.
      if (playedThrough && !superseded) onRestore?.();

      if (duckingTarget && !superseded) {
        if (controller.signal.aborted) {
          duckingTarget.setVolume(UNDUCKED_GAIN);
        } else {
          duckingTarget.rampVolume(duckRatio, UNDUCKED_GAIN, rampOutMs);
          await delay(rampOutMs);
          duckingTarget.setVolume(UNDUCKED_GAIN);
        }
      }
    }
  }

  /**
   * Aborts the clip on air. Pausing an element fires neither `ended` nor
   * `error`, so the abort — not the pause — is what lets the awaiting `play`
   * settle and run its release.
   */
  stop(): void {
    this.activeAbort?.abort();
    this.activeAbort = null;
    this.audio?.pause();
    this.audio = null;
  }

  destroy(): void {
    this.stop();
    this.discardPreload();
    this.handlers = {};
  }

  /**
   * Best-effort teardown for an element this node is done with for good.
   *
   * Pausing stops playback but leaves the element holding its resource, which
   * on some engines keeps a decoder or network buffer alive until the element
   * itself is garbage collected — usually well after the clip's object URL is
   * revoked. Clearing the source releases that hold immediately instead of
   * leaving it to a GC pass a long session may not run for a while.
   *
   * Wrapped defensively — the same spirit as `mix-bus.ts`'s Web Audio guards —
   * so a runtime (or test double) missing `removeAttribute`/`load` on a media
   * element can't take a routine cleanup down with it.
   */
  private releaseElement(audio: HTMLAudioElement): void {
    try {
      audio.removeAttribute("src");
      audio.load();
    } catch {
      // Best-effort — nothing downstream depends on this succeeding.
    }
  }

  private linkAbort(signal?: AbortSignal): AbortController {
    const controller = new AbortController();

    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    this.activeAbort = controller;
    return controller;
  }
}

import type { PersonaId } from "@/data/personas";
import type { VolumeController } from "@/types/audio";
import type { DjSegmentPlan } from "@/types/dj";
import type { TtsProvider } from "@/types/voice";
import type { VoiceSpeaker } from "./audio/VoiceNode";

type DjBreakRequest = {
  songTitle: string;
  artistName: string;
  maxDurationInSeconds?: number;
  personaId?: PersonaId;
  provider?: TtsProvider;
  stationId?: string;
  stationName?: string;
  /** Dial position the DJ may announce — the only frequency it is allowed to say. */
  stationFrequency?: number;
  segmentPlan?: DjSegmentPlan;
  signal?: AbortSignal;
};

type PlayDjIntroOptions = DjBreakRequest & {
  /** Speech playback, gain, and duck lifecycle for the generated clip. */
  voiceNode: VoiceSpeaker;
  /**
   * Music channel's duck bus, where 1 is full level and `DUCK_RATIO` is fully
   * ducked. The voice node ramps it; nothing here touches the speech channel.
   */
  duckBus?: VolumeController;
  /**
   * Clip synthesized ahead of time by the lookahead pre-fetcher. When present
   * the break goes straight to the speakers, skipping script and TTS.
   */
  audioBlob?: Blob;
  /** When false, the DJ speaks without ducking (the music is already paused). */
  duckMusic?: boolean;
  /**
   * Fired as the break hands the music bus back — the boundary a station
   * stinger punctuates. Kept as a bare callback so the SFX kit stays a caller's
   * concern rather than something this module has to know how to build.
   */
  onBreakExit?: () => void;
};

/**
 * Writes and synthesizes a DJ break, returning the raw speech clip.
 *
 * Split out from playback so the lookahead pre-fetcher can run both network
 * legs during the previous track and hand the finished blob to the node at the
 * transition.
 */
export async function generateDjBreak({
  songTitle,
  artistName,
  maxDurationInSeconds = 5,
  personaId,
  provider = "openai",
  stationId,
  stationName,
  stationFrequency,
  segmentPlan,
  signal,
}: DjBreakRequest): Promise<Blob> {
  const scriptResponse = await fetch("/api/generate-script", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      songTitle,
      artistName,
      maxDurationInSeconds: segmentPlan?.maxDurationSeconds ?? maxDurationInSeconds,
      personaId,
      stationId,
      stationName,
      stationFrequency,
      segmentPlan,
      listenerCity: segmentPlan?.listenerCity,
      localEvent: segmentPlan?.localEvent,
    }),
    signal,
  });

  if (!scriptResponse.ok) {
    throw new Error("Failed to generate DJ script");
  }

  const { script } = (await scriptResponse.json()) as { script: string };

  const voiceResponse = await fetch("/api/generate-voice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: script, personaId, provider }),
    signal,
  });

  if (!voiceResponse.ok) {
    throw new Error("Failed to generate DJ voice");
  }

  return voiceResponse.blob();
}

/**
 * Generates a DJ break and hands it to the voice node.
 *
 * Script and speech synthesis are the only concerns here; everything about
 * getting the clip to the speakers — buffer, gain, ducking, teardown — belongs
 * to the node, so a different TTS backend or delivery mode is a node swap.
 */
export async function playDjIntro({
  voiceNode,
  duckBus,
  audioBlob,
  duckMusic = true,
  onBreakExit,
  ...request
}: PlayDjIntroOptions): Promise<void> {
  const clip = audioBlob ?? (await generateDjBreak(request));

  await voiceNode.play({
    audioBlob: clip,
    signal: request.signal,
    duckingTarget: duckMusic ? duckBus : undefined,
    onRestore: onBreakExit,
  });
}

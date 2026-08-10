import type { PersonaId } from "@/data/personas";
import type { VolumeController } from "@/types/audio";
import type { CommentaryFormat, DjSegmentPlan } from "@/types/dj";
import type { AlbumContext, EraLock, VoiceProfileOverride } from "@/types/station";
import type { TtsProvider } from "@/types/voice";
import type { VoiceSpeaker } from "./audio/VoiceNode";

type DjBreakRequest = {
  songTitle: string;
  artistName: string;
  maxDurationInSeconds?: number;
  personaId?: PersonaId;
  provider?: TtsProvider;
  /** Free-tier OpenAI STANDARD voice override (onyx / echo / alloy). */
  voice?: string;
  /** Subscription tier hint for the voice-engine guard (`free` | `pro`). */
  tier?: "free" | "pro";
  stationId?: string;
  stationName?: string;
  /** Dial position the DJ may announce — the only frequency it is allowed to say. */
  stationFrequency?: number;
  /** Decade the station is locked to — constrains what the host may treat as current. */
  eraLock?: EraLock;
  /** Listener-authored direction for this station's tone */
  vibePrompt?: string;
  /** Sleeve metadata for an `album_deep_dive` station — liner notes the host can cite */
  albumContext?: AlbumContext | null;
  /** Listener-tuned delivery knobs layered on the assigned host */
  voiceProfile?: VoiceProfileOverride | null;
  /** Lore / commentary depth from Host Settings. */
  commentaryFormat?: CommentaryFormat;
  segmentPlan?: DjSegmentPlan;
  signal?: AbortSignal;
  /**
   * Reports the script as written, before it is spoken.
   *
   * The teleprompter and the transcript log both need the text, and this is the
   * only point it exists in the pipeline — the voice API is handed the script
   * and returns opaque audio.
   */
  onScript?: (script: string) => void;
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
  /**
   * Script behind `audioBlob`, carried from the lookahead that wrote it. Without
   * it a warmed break would reach the speakers with no text to put on screen.
   */
  script?: string;
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
  voice,
  tier,
  stationId,
  stationName,
  stationFrequency,
  eraLock,
  vibePrompt,
  albumContext,
  voiceProfile,
  commentaryFormat,
  segmentPlan,
  signal,
  onScript,
}: DjBreakRequest): Promise<Blob | null> {
  console.log("[LinerLore TRACE 3] Requesting DJ script/TTS...");
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
      eraLock,
      vibePrompt,
      albumContext,
      voiceProfile: voiceProfile ?? undefined,
      commentaryFormat,
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
  onScript?.(script);

  const voiceResponse = await fetch("/api/generate-voice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: script, personaId, provider, voice, tier }),
    signal,
  });

  if (!voiceResponse.ok) {
    const errorText = await voiceResponse.text();
    console.warn("[Voice Generator Failure]", voiceResponse.status, errorText);
    // Skip the break so music keeps playing instead of stalling the engine.
    return null;
  }

  const buffer = await voiceResponse.arrayBuffer();
  console.log(
    "[LinerLore TRACE 4] DJ Voice buffer ready, byte length:",
    buffer?.byteLength,
  );
  return new Blob([buffer], {
    type: voiceResponse.headers.get("content-type") || "audio/mpeg",
  });
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
  script,
  duckMusic = true,
  onBreakExit,
  ...request
}: PlayDjIntroOptions): Promise<void> {
  try {
    // A warmed clip skips generation entirely, so its script has to be reported
    // here for the caller to see the same callback on both paths.
    if (audioBlob && script) request.onScript?.(script);

    if (audioBlob) {
      console.log(
        "[LinerLore TRACE 4] DJ Voice buffer ready, byte length:",
        audioBlob.size,
      );
    }

    const clip = audioBlob ?? (await generateDjBreak(request));
    if (!clip) {
      console.warn("[dj-intro] Skipping DJ break — voice generation unavailable");
      return;
    }

    await voiceNode.play({
      audioBlob: clip,
      signal: request.signal,
      duckingTarget: duckMusic ? duckBus : undefined,
      onRestore: onBreakExit,
    });
  } catch (err) {
    console.error("[LinerLore TRACE ERROR]", err);
    throw err;
  }
}

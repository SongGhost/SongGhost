import {
  DUCK_RAMP_MS,
  DUCK_RATIO,
  RESTORE_RAMP_MS,
  UNDUCKED_GAIN,
  voiceGain,
} from "./audio/mix-bus";
import { rampVolume, waitForAudioEnd } from "./volume-ramp";
import type { PersonaId } from "@/data/personas";
import type { DjSegmentPlan } from "@/types/dj";
import type { TtsProvider } from "@/types/voice";

type PlayDjIntroOptions = {
  songTitle: string;
  artistName: string;
  maxDurationInSeconds?: number;
  personaId?: PersonaId;
  provider?: TtsProvider;
  stationId?: string;
  stationName?: string;
  segmentPlan?: DjSegmentPlan;
  getMasterVolume: () => number;
  /**
   * Sets the music channel's duck gain relative to master: `UNDUCKED_GAIN` for
   * full level, `DUCK_RATIO` for fully ducked. Never applied to the voice.
   */
  setDuckGain: (gain: number) => void;
  /**
   * Publishes the live voice element so the caller can retrack it when the
   * master fader moves mid-break. Called with `null` once the break is over.
   */
  onVoiceElementChange?: (audio: HTMLAudioElement | null) => void;
  signal?: AbortSignal;
  /** When false, DJ speaks without ducking the music bus (music is paused). */
  duckMusic?: boolean;
};

export async function playDjIntro({
  songTitle,
  artistName,
  maxDurationInSeconds = 5,
  personaId,
  provider = "openai",
  stationId,
  stationName,
  segmentPlan,
  getMasterVolume,
  setDuckGain,
  onVoiceElementChange,
  signal,
  duckMusic = true,
}: PlayDjIntroOptions): Promise<void> {
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

  const audioBlob = await voiceResponse.blob();
  const audioUrl = URL.createObjectURL(audioBlob);
  const voiceAudio = new Audio(audioUrl);
  voiceAudio.volume = voiceGain(getMasterVolume());

  let cancelRamp: (() => void) | null = null;

  const abortHandler = () => {
    cancelRamp?.();
    voiceAudio.pause();
  };

  signal?.addEventListener("abort", abortHandler, { once: true });

  try {
    if (duckMusic) {
      cancelRamp = rampVolume(setDuckGain, UNDUCKED_GAIN, DUCK_RATIO, DUCK_RAMP_MS);
    }

    onVoiceElementChange?.(voiceAudio);
    await voiceAudio.play();
    await waitForAudioEnd(voiceAudio, signal);
  } finally {
    signal?.removeEventListener("abort", abortHandler);
    onVoiceElementChange?.(null);
    cancelRamp?.();
    URL.revokeObjectURL(audioUrl);

    if (duckMusic) {
      if (signal?.aborted) {
        setDuckGain(UNDUCKED_GAIN);
      } else {
        cancelRamp = rampVolume(setDuckGain, DUCK_RATIO, UNDUCKED_GAIN, RESTORE_RAMP_MS);
        await new Promise<void>((resolve) => {
          setTimeout(resolve, RESTORE_RAMP_MS);
        });
        setDuckGain(UNDUCKED_GAIN);
      }
    }
  }
}

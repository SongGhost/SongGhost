import { rampVolume, waitForAudioEnd } from "./volume-ramp";
import type { PersonaId } from "@/data/personas";
import type { DjSegmentPlan } from "@/types/dj";
import type { TtsProvider } from "@/types/voice";

const DUCK_RATIO = 0.25;
const DUCK_RAMP_MS = 300;

type PlayDjIntroOptions = {
  songTitle: string;
  artistName: string;
  maxDurationInSeconds?: number;
  personaId?: PersonaId;
  provider?: TtsProvider;
  stationName?: string;
  segmentPlan?: DjSegmentPlan;
  getMasterVolume: () => number;
  setPlayerVolume: (percent: number) => void;
  signal?: AbortSignal;
};

export async function playDjIntro({
  songTitle,
  artistName,
  maxDurationInSeconds = 5,
  personaId,
  provider = "openai",
  stationName,
  segmentPlan,
  getMasterVolume,
  setPlayerVolume,
  signal,
}: PlayDjIntroOptions): Promise<void> {
  const scriptResponse = await fetch("/api/generate-script", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      songTitle,
      artistName,
      maxDurationInSeconds: segmentPlan?.maxDurationSeconds ?? maxDurationInSeconds,
      personaId,
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

  const masterPercent = getMasterVolume() * 100;
  const duckedPercent = masterPercent * DUCK_RATIO;

  let cancelRamp: (() => void) | null = null;
  let didDuck = false;

  const abortHandler = () => {
    cancelRamp?.();
    voiceAudio.pause();
    URL.revokeObjectURL(audioUrl);
  };

  signal?.addEventListener("abort", abortHandler, { once: true });

  try {
    cancelRamp = rampVolume(setPlayerVolume, masterPercent, duckedPercent, DUCK_RAMP_MS);
    didDuck = true;

    await voiceAudio.play();
    await waitForAudioEnd(voiceAudio);
  } finally {
    signal?.removeEventListener("abort", abortHandler);
    URL.revokeObjectURL(audioUrl);
    cancelRamp?.();

    if (signal?.aborted || !didDuck) {
      setPlayerVolume(masterPercent);
      return;
    }

    cancelRamp = rampVolume(setPlayerVolume, duckedPercent, masterPercent, DUCK_RAMP_MS);

    await new Promise<void>((resolve) => {
      setTimeout(resolve, DUCK_RAMP_MS);
    });
  }
}

import type { PersonaId } from "@/data/personas";
import type { VolumeController } from "@/types/audio";
import { isLoreSegmentKind, type CommentaryFormat, type DjSegmentPlan } from "@/types/dj";
import type { AlbumContext, EraLock, VoiceProfileOverride } from "@/types/station";
import type { TtsProvider } from "@/types/voice";
import { DUCK_RAMP_MS, DUCK_RATIO, RESTORE_RAMP_MS } from "@/lib/audio/mix-bus";
import {
  playEarconFailClosed,
  resolveEarconSrc,
  waitCommentaryGap,
} from "@/lib/dj/earcon";
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
  /** Broadcast City preference — VPN-safe weather location for atmosphere prompts. */
  homeCity?: string;
  /** Blueprint seed genres — used when the station is not in the house catalog. */
  seedGenres?: string[];
  segmentPlan?: DjSegmentPlan;
  signal?: AbortSignal;
  /**
   * Live on-air predecessor (Track N) when warming Track N+1. Recap cues
   * ("That was…") must name this track, not an older history entry.
   */
  previousTrack?: { title: string; artist: string };
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
  /**
   * Warmed lore clip for Pavlovian breaks. When present with
   * {@link announcementBlob}, skips live generation.
   */
  loreBlob?: Blob;
  loreScript?: string;
  announcementBlob?: Blob;
  announcementScript?: string;
  /** When false, the DJ speaks without ducking (the music is already paused). */
  duckMusic?: boolean;
  /**
   * Optional duck curve overrides (e.g. 800ms intro-ramp restore). Forwarded to
   * the voice node when `duckMusic` is enabled.
   */
  ducking?: {
    duckRatio?: number;
    rampInMs?: number;
    rampOutMs?: number;
  };
  /**
   * Fired as the break hands the music bus back — the boundary a station
   * stinger punctuates. Kept as a bare callback so the SFX kit stays a caller's
   * concern rather than something this module has to know how to build.
   */
  onBreakExit?: () => void;
  /**
   * Fired after the lore clip (and before the ducked announcement) so the
   * caller can start Track B. Pavlovian lore-type breaks only.
   */
  onLoreComplete?: () => void | Promise<void>;
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
  homeCity,
  seedGenres,
  segmentPlan,
  previousTrack,
  signal,
  onScript,
}: DjBreakRequest): Promise<Blob | null> {
  console.log("[SongHost TRACE 3] Requesting DJ script/TTS...");
  const clientTimeZone =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : undefined;
  const scriptResponse = await fetch("/api/generate-script", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(clientTimeZone ? { "x-client-timezone": clientTimeZone } : {}),
    },
    body: JSON.stringify({
      songTitle,
      artistName,
      maxDurationInSeconds: segmentPlan?.maxDurationSeconds ?? maxDurationInSeconds,
      // Explicit host override — generate-script prefers hostId over station defaults.
      hostId: personaId,
      personaId,
      stationId,
      stationName,
      stationFrequency,
      eraLock,
      vibePrompt,
      albumContext,
      voiceProfile: voiceProfile ?? undefined,
      commentaryFormat,
      homeCity: homeCity?.trim() || undefined,
      seedGenres,
      segmentPlan,
      listenerCity: homeCity?.trim() || segmentPlan?.listenerCity,
      localEvent: segmentPlan?.localEvent,
      previousTrack: previousTrack?.title?.trim() && previousTrack?.artist?.trim()
        ? {
            title: previousTrack.title.trim(),
            artist: previousTrack.artist.trim(),
          }
        : undefined,
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
  return new Blob([buffer], {
    type: voiceResponse.headers.get("content-type") || "audio/mpeg",
  });
}

export type PavlovianDjBreak = {
  loreBlob: Blob | null;
  loreScript: string;
  announcementBlob: Blob | null;
  announcementScript: string;
};

async function fetchDjScript(
  request: DjBreakRequest,
  scriptPhase: "lore" | "announcement",
): Promise<string> {
  const clientTimeZone =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : undefined;
  const scriptResponse = await fetch("/api/generate-script", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(clientTimeZone ? { "x-client-timezone": clientTimeZone } : {}),
    },
    body: JSON.stringify({
      songTitle: request.songTitle,
      artistName: request.artistName,
      maxDurationInSeconds:
        request.segmentPlan?.maxDurationSeconds ?? request.maxDurationInSeconds ?? 5,
      hostId: request.personaId,
      personaId: request.personaId,
      stationId: request.stationId,
      stationName: request.stationName,
      stationFrequency: request.stationFrequency,
      eraLock: request.eraLock,
      vibePrompt: request.vibePrompt,
      albumContext: request.albumContext,
      voiceProfile: request.voiceProfile ?? undefined,
      commentaryFormat: request.commentaryFormat,
      homeCity: request.homeCity?.trim() || undefined,
      seedGenres: request.seedGenres,
      segmentPlan: request.segmentPlan,
      listenerCity: request.homeCity?.trim() || request.segmentPlan?.listenerCity,
      localEvent: request.segmentPlan?.localEvent,
      scriptPhase,
      previousTrack:
        request.previousTrack?.title?.trim() && request.previousTrack?.artist?.trim()
          ? {
              title: request.previousTrack.title.trim(),
              artist: request.previousTrack.artist.trim(),
            }
          : undefined,
    }),
    signal: request.signal,
  });
  if (!scriptResponse.ok) {
    throw new Error("Failed to generate DJ script");
  }
  const payload = (await scriptResponse.json()) as { script?: string };
  return payload.script?.trim() || "";
}

async function synthesizeDjVoice(
  text: string,
  request: DjBreakRequest,
): Promise<Blob | null> {
  const voiceResponse = await fetch("/api/generate-voice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      personaId: request.personaId,
      provider: request.provider ?? "openai",
      voice: request.voice,
      tier: request.tier,
    }),
    signal: request.signal,
  });
  if (!voiceResponse.ok) {
    const errorText = await voiceResponse.text();
    console.warn("[Voice Generator Failure]", voiceResponse.status, errorText);
    return null;
  }
  const buffer = await voiceResponse.arrayBuffer();
  return new Blob([buffer], {
    type: voiceResponse.headers.get("content-type") || "audio/mpeg",
  });
}

/**
 * Two TTS clips for a lore-type break: commentary, then track announcement.
 * Announcement failure still returns the lore clip.
 */
export async function generatePavlovianDjBreak(
  request: DjBreakRequest,
): Promise<PavlovianDjBreak | null> {
  console.log("[SongHost TRACE 3] Requesting Pavlovian lore + announcement TTS...");
  const loreScript = await fetchDjScript(request, "lore");
  if (!loreScript) return null;

  let announcementScript = "";
  try {
    announcementScript = await fetchDjScript(request, "announcement");
  } catch (err) {
    console.warn("[dj-intro] Announcement script failed — lore clip will still air", err);
  }

  request.onScript?.([loreScript, announcementScript].filter(Boolean).join(" "));

  const loreBlob = await synthesizeDjVoice(loreScript, request);
  if (!loreBlob) return null;

  let announcementBlob: Blob | null = null;
  if (announcementScript) {
    announcementBlob = await synthesizeDjVoice(announcementScript, request);
  }

  return {
    loreBlob,
    loreScript,
    announcementBlob,
    announcementScript,
  };
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
  loreBlob,
  loreScript,
  announcementBlob,
  announcementScript,
  duckMusic = true,
  ducking,
  onBreakExit,
  onLoreComplete,
  ...request
}: PlayDjIntroOptions): Promise<void> {
  try {
    const plan = request.segmentPlan;
    const pavlovian = Boolean(plan && isLoreSegmentKind(plan.kind));

    if (pavlovian && plan) {
      const warmedLore = loreBlob ?? null;
      const warmedAnnounce = announcementBlob ?? null;
      const generated = warmedLore
        ? {
            loreBlob: warmedLore,
            loreScript: loreScript ?? script ?? "",
            announcementBlob: warmedAnnounce,
            announcementScript: announcementScript ?? "",
          }
        : await generatePavlovianDjBreak(request);

      if (!generated?.loreBlob) {
        console.warn("[dj-intro] Skipping Pavlovian break — lore clip unavailable");
        return;
      }

      if (generated.loreScript || generated.announcementScript) {
        request.onScript?.(
          [generated.loreScript, generated.announcementScript].filter(Boolean).join(" "),
        );
      }

      await playEarconFailClosed(resolveEarconSrc(plan), { signal: request.signal });
      try {
        await waitCommentaryGap(undefined, request.signal);
      } catch {
        return;
      }

      await voiceNode.play({
        audioBlob: generated.loreBlob,
        signal: request.signal,
      });

      await onLoreComplete?.();

      if (generated.announcementBlob) {
        await voiceNode.play({
          audioBlob: generated.announcementBlob,
          signal: request.signal,
          duckingTarget: duckBus,
          ducking: {
            duckRatio: ducking?.duckRatio ?? DUCK_RATIO,
            rampInMs: ducking?.rampInMs ?? DUCK_RAMP_MS,
            rampOutMs: ducking?.rampOutMs ?? RESTORE_RAMP_MS,
          },
          onRestore: onBreakExit,
        });
      } else {
        onBreakExit?.();
      }
      return;
    }

    // A warmed clip skips generation entirely, so its script has to be reported
    // here for the caller to see the same callback on both paths.
    if (audioBlob && script) request.onScript?.(script);

    const clip = audioBlob ?? (await generateDjBreak(request));
    if (!clip) {
      console.warn("[dj-intro] Skipping DJ break — voice generation unavailable");
      return;
    }

    await voiceNode.play({
      audioBlob: clip,
      signal: request.signal,
      duckingTarget: duckMusic ? duckBus : undefined,
      ducking: duckMusic ? ducking : undefined,
      onRestore: onBreakExit,
    });
  } catch (err) {
    console.error("[SongHost TRACE ERROR]", err);
    throw err;
  }
}

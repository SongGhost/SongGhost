import type { PersonaId } from "@/data/personas";
import type { VolumeController } from "@/types/audio";
import {
  isLoreSegmentKind,
  isRootsTeaserKind,
  type CommentaryFormat,
  type DjKnowledge,
  type DjPace,
  type DjSegmentPlan,
} from "@/types/dj";
import type { AlbumContext, ChatterPacing, EraLock, VoiceProfileOverride } from "@/types/station";
import type { LocalVoiceSlot, TtsProvider } from "@/types/voice";
import { chatterPacingToPace } from "@/lib/dj/scriptGenerator";
import { normalizeUserPreferences, readPrefsRaw } from "@/lib/user/preferences";
import { DUCK_RAMP_MS, DUCK_RATIO, RESTORE_RAMP_MS } from "@/lib/audio/mix-bus";
import {
  playEarconFailClosed,
  resolveEarconSrc,
  waitCommentaryGap,
} from "@/lib/dj/earcon";
import {
  consumeVibePreviewBreak,
  overlayVibePreviewOnPayload,
} from "@/lib/dj/vibePreview";
import { getSongIntroLine, getStationLaunchClips } from "@/lib/dj/scriptGenerator";
import { tryPlayPrerecordedFallback } from "@/lib/audio/prerecorded";
import type { VoiceSpeaker } from "./audio/VoiceNode";

type DjBreakRequest = {
  songTitle: string;
  artistName: string;
  maxDurationInSeconds?: number;
  personaId?: PersonaId;
  provider?: TtsProvider;
  /** Host Studio voice: OpenAI id, or `local:N` when provider is local. */
  voice?: string;
  /** Sidecar slot 1–4 when `provider` is `"local"`. */
  voiceSlot?: LocalVoiceSlot;
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
  /** Host Studio talk density — forwarded so server defaults do not fight the UI. */
  talkLevel?: ChatterPacing;
  chatterPacing?: ChatterPacing;
  /** Host Studio pace (frequency only). */
  pace?: DjPace;
  /** Clean Mode / Allow Explicit from Host Studio. */
  allowExplicit?: boolean;
  /** Legacy Tuning Console knowledge depth. */
  knowledge?: DjKnowledge;
  /** Broadcast City preference — VPN-safe weather location for atmosphere prompts. */
  homeCity?: string;
  /** Blueprint seed genres — used when the station is not in the house catalog. */
  seedGenres?: string[];
  segmentPlan?: DjSegmentPlan;
  signal?: AbortSignal;
  /** Break-flight generation — stale attempts must not speak. */
  generation?: number;
  /**
   * Last gate before a clip may air. False when music already started or
   * this attempt was aborted / superseded.
   */
  canPlay?: () => boolean;
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
  /**
   * Live dial default is false: the host speaks in the pre-song gap, then
   * the song starts at full volume. Never talk over a YouTube bed.
   */
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
   * Fired after the full Pavlovian sequence (lore + optional sweeper +
   * announcement) so the caller can start Track B at full volume.
   */
  onLoreComplete?: () => void | Promise<void>;
};

export type PlayDjIntroResult = {
  /** True when at least one clip reached VoiceNode (live, warmed, or fallback). */
  played: boolean;
};

async function recoverWithFallback(
  request: DjBreakRequest,
  voiceNode: VoiceSpeaker,
): Promise<boolean> {
  return tryPlayPrerecordedFallback({
    provider: request.provider,
    voiceSlot: request.voiceSlot,
    voiceNode,
    generation: request.generation,
    canPlay: request.canPlay,
    signal: request.signal,
    onScript: request.onScript,
  });
}

function readStoredHostStudio(stationId?: string): {
  chatterPacing?: ChatterPacing;
  allowExplicit?: boolean;
} {
  if (typeof window === "undefined") return {};
  try {
    const keys = Object.keys(window.localStorage).filter((key) =>
      key.startsWith("songhost:prefs:"),
    );
    const preferred =
      keys.find((key) => key !== "songhost:prefs:guest") ?? "songhost:prefs:guest";
    const raw = window.localStorage.getItem(preferred) ?? readPrefsRaw(null);
    if (!raw) return {};
    const prefs = normalizeUserPreferences(JSON.parse(raw) as Record<string, unknown>);
    const config = stationId ? prefs.stationConfigs?.[stationId] : undefined;
    return {
      chatterPacing: config?.chatterPacing ?? prefs.chatterPacing,
      allowExplicit: prefs.allowExplicit,
    };
  } catch {
    return {};
  }
}

function hostStudioScriptFields(request: Pick<
  DjBreakRequest,
  | "talkLevel"
  | "chatterPacing"
  | "pace"
  | "allowExplicit"
  | "knowledge"
  | "commentaryFormat"
  | "stationId"
>): Record<string, unknown> {
  const stored = readStoredHostStudio(request.stationId);
  const talk = request.talkLevel ?? request.chatterPacing ?? stored.chatterPacing;
  const allowExplicit = request.allowExplicit ?? stored.allowExplicit;
  const pace = request.pace ?? (talk ? chatterPacingToPace(talk) : undefined);
  const knowledge = request.knowledge;
  const fields: Record<string, unknown> = {};
  if (talk) {
    fields.talkLevel = talk;
    fields.chatterPacing = talk;
  }
  if (pace) fields.pace = pace;
  if (typeof allowExplicit === "boolean") fields.allowExplicit = allowExplicit;
  if (knowledge) fields.knowledge = knowledge;
  if (request.commentaryFormat) fields.commentaryFormat = request.commentaryFormat;
  return fields;
}

function homeCityForScriptRequest(
  segmentPlan: DjSegmentPlan | undefined,
  homeCity?: string,
): string | undefined {
  if (segmentPlan?.kind !== "local_events") return undefined;
  const city = homeCity?.trim() || segmentPlan.listenerCity?.trim();
  return city || undefined;
}

function clipStillAirable(
  request: Pick<DjBreakRequest, "signal" | "canPlay">,
): boolean {
  if (request.signal?.aborted) return false;
  if (request.canPlay && !request.canPlay()) return false;
  return true;
}

function voicePlayGate(request: Pick<DjBreakRequest, "signal" | "generation" | "canPlay">) {
  return {
    signal: request.signal,
    generation: request.generation,
    canPlay: request.canPlay,
  };
}

function generateVoiceBody(
  text: string,
  request: Pick<DjBreakRequest, "personaId" | "provider" | "voice" | "voiceSlot" | "tier">,
) {
  return {
    text,
    personaId: request.personaId,
    provider: request.provider ?? "openai",
    voice: request.voice,
    tier: request.tier,
    ...(request.voiceSlot != null ? { voiceSlot: request.voiceSlot } : {}),
  };
}

function voiceFailureLabel(request: Pick<DjBreakRequest, "provider">): string {
  return request.provider === "local"
    ? "[Voice Generator Failure] Local helper unavailable — skipping break (no OpenAI fallback)"
    : "[Voice Generator Failure]";
}

function vibeScriptFields(request: Pick<DjBreakRequest, "vibePrompt" | "tier">): {
  vibePrompt: string;
  vibePreviewActive?: boolean;
} {
  const overlay = overlayVibePreviewOnPayload(
    request.vibePrompt,
    request.tier === "pro",
  );
  return {
    vibePrompt: overlay.vibePrompt,
    ...(overlay.vibePreviewActive ? { vibePreviewActive: true } : {}),
  };
}

function consumePreviewAfterVoicedBreak(isPro: boolean, previewActive: boolean): void {
  if (isPro || !previewActive) return;
  consumeVibePreviewBreak();
}

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
  voiceSlot,
  tier,
  stationId,
  stationName,
  stationFrequency,
  eraLock,
  vibePrompt,
  albumContext,
  voiceProfile,
  commentaryFormat,
  talkLevel,
  chatterPacing,
  pace,
  allowExplicit,
  knowledge,
  homeCity,
  seedGenres,
  segmentPlan,
  previousTrack,
  signal,
  onScript,
}: DjBreakRequest): Promise<Blob | null> {
  const request: DjBreakRequest = {
    songTitle,
    artistName,
    maxDurationInSeconds,
    personaId,
    provider,
    voice,
    voiceSlot,
    tier,
    stationId,
    stationName,
    stationFrequency,
    eraLock,
    vibePrompt,
    albumContext,
    voiceProfile,
    commentaryFormat,
    talkLevel,
    chatterPacing,
    pace,
    allowExplicit,
    knowledge,
    homeCity,
    seedGenres,
    segmentPlan,
    previousTrack,
    signal,
    onScript,
  };

  // Session-opening song_intro stays a templated launch liner (no LLM).
  // Names-only song_id (always-announce) reuses the same song-ID templates.
  // Mid-session song_intro falls through to the lore script path.
  if (segmentPlan?.kind === "song_id") {
    const line = getSongIntroLine(artistName, songTitle);
    onScript?.(line);
    return synthesizeDjVoice(line, request);
  }
  if (segmentPlan?.kind === "song_intro" && segmentPlan.isSessionOpening) {
    const line = getStationLaunchClips(
      stationName?.trim() || "SonGhost",
      artistName,
      songTitle,
    ).line;
    onScript?.(line);
    return synthesizeDjVoice(line, request);
  }

  console.log("[SongHost TRACE 3] Requesting DJ script/TTS...");
  const clientTimeZone =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : undefined;
  const localCity = homeCityForScriptRequest(segmentPlan, homeCity);
  const vibeFields = vibeScriptFields({ vibePrompt, tier });
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
      ...vibeFields,
      albumContext,
      voiceProfile: voiceProfile ?? undefined,
      commentaryFormat,
      ...hostStudioScriptFields(request),
      homeCity: localCity,
      seedGenres,
      segmentPlan,
      listenerCity: localCity,
      localEvent: segmentPlan?.localEvent,
      ttsProvider: provider,
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

  consumePreviewAfterVoicedBreak(tier === "pro", Boolean(vibeFields.vibePreviewActive));

  const { script } = (await scriptResponse.json()) as { script: string };
  onScript?.(script);

  if (signal?.aborted) return null;
  return synthesizeDjVoice(script, request);
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
  const localCity = homeCityForScriptRequest(request.segmentPlan, request.homeCity);
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
      ...vibeScriptFields(request),
      albumContext: request.albumContext,
      voiceProfile: request.voiceProfile ?? undefined,
      commentaryFormat: request.commentaryFormat,
      ...hostStudioScriptFields(request),
      homeCity: localCity,
      seedGenres: request.seedGenres,
      segmentPlan: request.segmentPlan,
      listenerCity: localCity,
      localEvent: request.segmentPlan?.localEvent,
      scriptPhase,
      ttsProvider: request.provider,
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
  if (request.signal?.aborted) return null;
  const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const voiceResponse = await fetch("/api/generate-voice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(generateVoiceBody(text, request)),
    signal: request.signal,
  });
  const durationMs = Math.round(
    (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt,
  );
  console.log("[SongHost] TTS synth duration_ms", durationMs, {
    provider: request.provider ?? "openai",
    ok: voiceResponse.ok,
  });
  if (request.signal?.aborted) {
    console.warn("[SongHost] skip-break", { reason: "aborted", durationMs });
    return null;
  }
  if (!voiceResponse.ok) {
    const errorText = await voiceResponse.text();
    console.warn(voiceFailureLabel(request), voiceResponse.status, errorText);
    console.warn("[SongHost] skip-break", { reason: "tts_unavailable", durationMs });
    return null;
  }
  const buffer = await voiceResponse.arrayBuffer();
  if (request.signal?.aborted) {
    console.warn("[SongHost] skip-break", { reason: "aborted", durationMs });
    return null;
  }
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
  const previewActive = vibeScriptFields(request).vibePreviewActive === true;
  const loreScript = await fetchDjScript(request, "lore");
  if (!loreScript) return null;
  consumePreviewAfterVoicedBreak(request.tier === "pro", previewActive);

  let announcementScript = "";
  try {
    announcementScript = await fetchDjScript(request, "announcement");
  } catch (err) {
    console.warn("[dj-intro] Announcement script failed — lore clip will still air", err);
  }

  request.onScript?.([loreScript, announcementScript].filter(Boolean).join(" "));

  const loreBlob = await synthesizeDjVoice(loreScript, request);
  if (!loreBlob) return null;
  if (request.signal?.aborted) return null;

  let announcementBlob: Blob | null = null;
  if (announcementScript) {
    announcementBlob = await synthesizeDjVoice(announcementScript, request);
    if (request.signal?.aborted) {
      announcementBlob = null;
    }
  }

  return {
    loreBlob,
    loreScript,
    announcementBlob,
    announcementScript,
  };
}

async function playTalkativeStingerSweeper(
  request: DjBreakRequest,
  voiceNode: VoiceSpeaker,
): Promise<string> {
  const sweeperPlan: DjSegmentPlan = {
    kind: "stinger",
    transition: "stinger",
    announceTracks: [],
    maxDurationSeconds: 3,
  };
  let sweeperScript = "";
  try {
    const sweeper = await generateDjBreak({
      ...request,
      homeCity: undefined,
      segmentPlan: sweeperPlan,
      onScript: (text) => {
        sweeperScript = text;
      },
    });
    if (!sweeper) return sweeperScript;
    if (!clipStillAirable(request)) return sweeperScript;
    await voiceNode.play({
      audioBlob: sweeper,
      ...voicePlayGate(request),
    });
  } catch (err) {
    console.warn("[dj-intro] Talkative stinger sweeper failed — song ID will still air", err);
  }
  return sweeperScript;
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
  duckMusic = false,
  ducking,
  onBreakExit,
  onLoreComplete,
  ...request
}: PlayDjIntroOptions): Promise<PlayDjIntroResult> {
  try {
    const plan = request.segmentPlan;
    // Session-opening song_intro stays templated regardless of lore-kind.
    const pavlovian = Boolean(
      plan && isLoreSegmentKind(plan.kind) && plan.isSessionOpening !== true,
    );

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
        console.warn("[SongHost] skip-break", { reason: "tts_unavailable", kind: "pavlovian" });
        const played = await recoverWithFallback(request, voiceNode);
        return { played };
      }

      if (!clipStillAirable(request)) {
        console.warn("[SongHost] skip-break", { reason: "music_already_playing", kind: "pavlovian" });
        return { played: false };
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
        return { played: false };
      }

      await voiceNode.play({
        audioBlob: generated.loreBlob,
        ...voicePlayGate(request),
      });

      // Optional station-ID sweeper in the pre-song gap (before Track B starts).
      // Standalone stinger plans never enter this branch, so they cannot double-play.
      if (plan.includeStinger) {
        await playTalkativeStingerSweeper(request, voiceNode);
      }

      if (generated.announcementBlob) {
        await voiceNode.play({
          audioBlob: generated.announcementBlob,
          ...voicePlayGate(request),
          duckingTarget: duckMusic ? duckBus : undefined,
          ducking: duckMusic
            ? {
                duckRatio: ducking?.duckRatio ?? DUCK_RATIO,
                rampInMs: ducking?.rampInMs ?? DUCK_RAMP_MS,
                rampOutMs: ducking?.rampOutMs ?? RESTORE_RAMP_MS,
              }
            : undefined,
          onRestore: onBreakExit,
        });
      } else {
        onBreakExit?.();
      }

      await onLoreComplete?.();
      return { played: true };
    }

    if (plan && isRootsTeaserKind(plan.kind)) {
      if (audioBlob && script) request.onScript?.(script);
      const clip = audioBlob ?? (await generateDjBreak(request));
      if (!clip) {
        console.warn("[SongHost] skip-break", { reason: "tts_unavailable", kind: "roots_teaser" });
        const played = await recoverWithFallback(request, voiceNode);
        return { played };
      }

      if (!clipStillAirable(request)) {
        console.warn("[SongHost] skip-break", { reason: "music_already_playing", kind: "roots_teaser" });
        return { played: false };
      }

      await playEarconFailClosed(resolveEarconSrc(plan), { signal: request.signal });
      try {
        await waitCommentaryGap(undefined, request.signal);
      } catch {
        return { played: false };
      }

      await voiceNode.play({
        audioBlob: clip,
        ...voicePlayGate(request),
        duckingTarget: duckMusic ? duckBus : undefined,
        ducking: duckMusic ? ducking : undefined,
        onRestore: onBreakExit,
      });
      return { played: true };
    }

    // A warmed clip skips generation entirely, so its script has to be reported
    // here for the caller to see the same callback on both paths.
    let sweeperScript = "";
    if (plan?.includeStinger) {
      sweeperScript = await playTalkativeStingerSweeper(request, voiceNode);
    }

    const reportScript = (text: string) => {
      request.onScript?.(
        [sweeperScript, text].filter((part) => part.trim().length > 0).join(" "),
      );
    };

    if (audioBlob && script) reportScript(script);

    const clip = audioBlob ?? (await generateDjBreak({
      ...request,
      onScript: reportScript,
    }));
    if (!clip) {
      console.warn("[SongHost] skip-break", { reason: "tts_unavailable" });
      const played = await recoverWithFallback(request, voiceNode);
      return { played };
    }

    if (!clipStillAirable(request)) {
      console.warn("[SongHost] skip-break", { reason: "music_already_playing" });
      return { played: false };
    }

    await voiceNode.play({
      audioBlob: clip,
      ...voicePlayGate(request),
      duckingTarget: duckMusic ? duckBus : undefined,
      ducking: duckMusic ? ducking : undefined,
      onRestore: onBreakExit,
    });
    return { played: true };
  } catch (err) {
    console.error("[SongHost TRACE ERROR]", err);
    throw err;
  }
}

"use client";

import { Loader2, Mic, Phone, Play, Radio, Send } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMediaRecorder } from "@/hooks/useMediaRecorder";
import { applyTelephoneEQ } from "@/lib/audio/telephoneFilter";
import type { StudioStationManifest } from "@/lib/studio/manifest";

const MAX_RECORD_SEC = 15;

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; title: string };

type SendState = "idle" | "sending" | "sent" | "error";

/**
 * Standalone mobile-first call-in page for friends to leave a 15s voicemail
 * that plays on a published SongHost Studio station.
 */
export default function CallInVoicemailPage() {
  const params = useParams<{ id: string }>();
  const stationId = typeof params?.id === "string" ? params.id : "";

  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [callerName, setCallerName] = useState("");
  const [sendState, setSendState] = useState<SendState>("idle");
  const [sendError, setSendError] = useState<string | null>(null);
  const [isPlayingBack, setIsPlayingBack] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    startRecording,
    stopRecording,
    audioBlob,
    audioUrl,
    isRecording,
    recordingTime,
  } = useMediaRecorder();

  useEffect(() => {
    if (!stationId) {
      setLoadState({ status: "error", message: "Missing station id." });
      return;
    }

    let cancelled = false;

    async function hydrate() {
      setLoadState({ status: "loading" });
      try {
        const res = await fetch(
          `/api/studio/save-station?id=${encodeURIComponent(stationId)}`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as {
          manifest?: StudioStationManifest;
          error?: string;
        };
        if (!res.ok || !data.manifest) {
          throw new Error(data.error ?? "Station not found");
        }
        if (!cancelled) {
          setLoadState({ status: "ready", title: data.manifest.name });
        }
      } catch (err) {
        if (!cancelled) {
          setLoadState({
            status: "error",
            message:
              err instanceof Error ? err.message : "Failed to load station",
          });
        }
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [stationId]);

  useEffect(() => {
    return () => {
      if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
      playbackSourceRef.current?.stop();
      void audioContextRef.current?.close();
    };
  }, []);

  const clearMaxTimer = useCallback(() => {
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  }, []);

  const handleRecordStart = useCallback(async () => {
    if (sendState === "sending" || sendState === "sent") return;
    setRecordError(null);
    setSendState("idle");
    setSendError(null);
    try {
      await startRecording();
      clearMaxTimer();
      maxTimerRef.current = setTimeout(() => {
        stopRecording();
      }, MAX_RECORD_SEC * 1000);
    } catch (err) {
      setRecordError(
        err instanceof Error ? err.message : "Microphone access denied",
      );
    }
  }, [clearMaxTimer, sendState, startRecording, stopRecording]);

  const handleRecordEnd = useCallback(() => {
    clearMaxTimer();
    if (isRecording) stopRecording();
  }, [clearMaxTimer, isRecording, stopRecording]);

  const stopPlayback = useCallback(() => {
    try {
      playbackSourceRef.current?.stop();
    } catch {
      /* already stopped */
    }
    playbackSourceRef.current = null;
    setIsPlayingBack(false);
  }, []);

  const handlePlayBack = useCallback(async () => {
    if (!audioBlob) return;
    stopPlayback();

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = audioContextRef.current ?? new AudioCtx();
    audioContextRef.current = ctx;
    if (ctx.state === "suspended") await ctx.resume();

    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;

    const chain = applyTelephoneEQ(ctx, source);
    chain.output.connect(ctx.destination);

    playbackSourceRef.current = source;
    setIsPlayingBack(true);
    source.onended = () => {
      playbackSourceRef.current = null;
      setIsPlayingBack(false);
    };
    source.start(0);
  }, [audioBlob, stopPlayback]);

  const handleSend = useCallback(async () => {
    if (!audioBlob || !stationId || sendState === "sending") return;
    setSendState("sending");
    setSendError(null);
    stopPlayback();

    try {
      const formData = new FormData();
      formData.append("audioBlob", audioBlob, "voicemail.webm");
      formData.append("stationId", stationId);
      const name = callerName.trim();
      if (name) formData.append("callerName", name);

      const res = await fetch("/api/studio/upload-voicemail", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as {
        error?: string;
        stationTitle?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "Upload failed");
      }

      if (data.stationTitle && loadState.status === "ready") {
        setLoadState({ status: "ready", title: data.stationTitle });
      }
      setSendState("sent");
    } catch (err) {
      setSendState("error");
      setSendError(err instanceof Error ? err.message : "Failed to send");
    }
  }, [audioBlob, callerName, loadState.status, sendState, stationId, stopPlayback]);

  const stationTitle =
    loadState.status === "ready" ? loadState.title : "this station";

  if (sendState === "sent") {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-[#09090b] px-4 text-zinc-100">
        <div
          className="pointer-events-none fixed inset-0 opacity-80"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(196,136,42,0.22), transparent 55%)",
          }}
        />
        <div className="relative mx-auto w-full max-w-md text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10">
            <Phone className="h-7 w-7 text-amber-400" aria-hidden="true" />
          </div>
          <h1 className="font-sans text-2xl font-semibold tracking-tight text-zinc-50">
            Voicemail sent!
          </h1>
          <p className="mt-3 font-sans text-base leading-relaxed text-zinc-400">
            It will play on {stationTitle}.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-[#09090b] text-zinc-100">
      <div
        className="pointer-events-none fixed inset-0 opacity-80"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(196,136,42,0.18), transparent 55%), radial-gradient(ellipse 50% 35% at 85% 90%, rgba(39,39,42,0.9), transparent 50%)",
        }}
      />

      <main className="relative mx-auto flex w-full max-w-md flex-col px-4 pb-12 pt-10 sm:pt-16">
        <header className="mb-10 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-amber-500/80">
            SongHost Call-In
          </p>
          <h1 className="mt-3 font-sans text-2xl font-semibold tracking-tight text-zinc-50">
            Leave a voicemail
          </h1>
          {loadState.status === "ready" && (
            <p className="mt-2 flex items-center justify-center gap-2 font-sans text-sm text-zinc-400">
              <Radio className="h-3.5 w-3.5 text-amber-500/70" aria-hidden="true" />
              {loadState.title}
            </p>
          )}
          <p className="mt-3 font-sans text-sm text-zinc-500">
            Hold to record up to {MAX_RECORD_SEC} seconds. Your message plays
            with classic telephone EQ.
          </p>
        </header>

        {loadState.status === "loading" && (
          <div className="flex items-center justify-center gap-2 py-16 font-mono text-xs uppercase tracking-widest text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading station…
          </div>
        )}

        {loadState.status === "error" && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-8 text-center">
            <p className="font-sans text-sm text-red-300" role="alert">
              {loadState.message}
            </p>
          </div>
        )}

        {loadState.status === "ready" && (
          <div className="flex flex-col gap-6">
            <label className="block">
              <span className="mb-2 block font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                Your name (optional)
              </span>
              <input
                type="text"
                value={callerName}
                onChange={(e) => setCallerName(e.target.value)}
                maxLength={40}
                placeholder="Caller"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-3 font-sans text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
              />
            </label>

            <div className="flex flex-col items-center gap-4 py-4">
              <div
                className={`flex h-36 w-36 items-center justify-center rounded-full border-2 transition-colors ${
                  isRecording
                    ? "border-red-500 bg-red-500/15 shadow-[0_0_40px_rgba(239,68,68,0.25)]"
                    : "border-amber-500/40 bg-amber-500/10"
                }`}
              >
                <button
                  type="button"
                  aria-label="Hold to record"
                  disabled={sendState === "sending"}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    (e.currentTarget as HTMLButtonElement).setPointerCapture(
                      e.pointerId,
                    );
                    void handleRecordStart();
                  }}
                  onPointerUp={handleRecordEnd}
                  onPointerCancel={handleRecordEnd}
                  onPointerLeave={(e) => {
                    if (e.buttons === 0) return;
                    handleRecordEnd();
                  }}
                  onContextMenu={(e) => e.preventDefault()}
                  className="flex h-28 w-28 touch-none select-none flex-col items-center justify-center rounded-full bg-zinc-950/60 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-200 active:scale-95 disabled:opacity-50"
                >
                  <Mic
                    className={`mb-2 h-7 w-7 ${isRecording ? "text-red-400" : "text-amber-400"}`}
                    aria-hidden="true"
                  />
                  {isRecording ? "Recording…" : "Hold to Record"}
                </button>
              </div>

              <p
                className="font-mono text-lg tabular-nums tracking-widest text-zinc-300"
                aria-live="polite"
              >
                {recordingTime}
                <span className="text-zinc-600"> / 00:{String(MAX_RECORD_SEC).padStart(2, "0")}</span>
              </p>
            </div>

            {(recordError || sendError) && (
              <p className="text-center font-sans text-sm text-red-300" role="alert">
                {recordError ?? sendError}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={!audioBlob || isRecording || isPlayingBack}
                onClick={() => void handlePlayBack()}
                className="flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-3.5 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-200 transition enabled:hover:border-amber-500/40 enabled:hover:text-amber-100 disabled:opacity-40"
              >
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                {isPlayingBack ? "Playing…" : "Play Back"}
              </button>

              <button
                type="button"
                disabled={!audioBlob || isRecording || sendState === "sending"}
                onClick={() => void handleSend()}
                className="flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-3 py-3.5 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-950 transition enabled:hover:bg-amber-400 disabled:opacity-40"
              >
                {sendState === "sending" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Send to Station
              </button>
            </div>

            {audioUrl && !isRecording && (
              <p className="text-center font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
                Clip ready · telephone EQ on playback
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

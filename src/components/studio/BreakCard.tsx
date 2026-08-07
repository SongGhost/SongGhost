"use client";

import {
  Loader2,
  Mic,
  Phone,
  Play,
  Plus,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PersonaId } from "@/data/personas";
import { useMediaRecorder } from "@/hooks/useMediaRecorder";
import {
  BREAK_TIMING_OPTIONS,
  CALL_IN_PERSONAS,
  STUDIO_DEFAULT_DJ_VOLUME,
  type BreakAuthorMode,
  type BreakTimingTrigger,
  type CallInPersona,
  type StudioTimelineBreak,
  newClientId,
} from "@/components/studio/types";

export type BreakCardProps = {
  /** Track index this break slot sits after (−1 = before first track). */
  afterTrackIndex: number;
  /** Active studio host — sent to TTS for persona-matched previews. */
  personaId: PersonaId;
  /** Clamp preview playback to this gain (defaults to standard 0.85). */
  djVolume?: number;
  /** Existing saved break for this slot, if any. */
  savedBreak?: StudioTimelineBreak | null;
  onSave: (breakItem: StudioTimelineBreak) => void;
  onRemove: () => void;
};

const MODE_TABS: { id: BreakAuthorMode; label: string; icon: typeof Sparkles }[] = [
  { id: "ai_host", label: "AI Host Text", icon: Sparkles },
  { id: "mic", label: "Mic Recording", icon: Mic },
  { id: "call_in", label: "Call-In Widget", icon: Phone },
];

function callInSystemLead(persona: CallInPersona): string {
  switch (persona) {
    case "sarcastic_critic":
      return "You're a sarcastic SongHost call-in critic. Keep it short, dry, and cutting. NEVER mention FM frequencies, dial numbers, or radio call letters.";
    case "hype_fan":
      return "You're an over-the-top hype fan calling into the SongHost digital stream. Keep it short and electric. NEVER mention FM frequencies, dial numbers, or radio call letters.";
    case "obscure_music_snob":
      return "You're an obscure-music snob calling into the SongHost curated station. Keep it short, pretentious, and specific. NEVER mention FM frequencies, dial numbers, or radio call letters.";
  }
}

function clampPreviewVolume(volume: number | undefined): number {
  if (typeof volume !== "number" || !Number.isFinite(volume)) {
    return STUDIO_DEFAULT_DJ_VOLUME;
  }
  return Math.min(1, Math.max(0, volume));
}

/**
 * Inline DJ break / call-in authoring card between timeline tracks.
 */
export default function BreakCard({
  afterTrackIndex,
  personaId,
  djVolume = STUDIO_DEFAULT_DJ_VOLUME,
  savedBreak,
  onSave,
  onRemove,
}: BreakCardProps) {
  const [expanded, setExpanded] = useState(Boolean(savedBreak));
  const [mode, setMode] = useState<BreakAuthorMode>(savedBreak?.mode ?? "ai_host");
  const [timing, setTiming] = useState<BreakTimingTrigger>(
    savedBreak?.timing ?? "BETWEEN_TRACKS",
  );
  const [scriptText, setScriptText] = useState(savedBreak?.scriptText ?? "");
  const [callInPersona, setCallInPersona] = useState<CallInPersona>(
    savedBreak?.callInPersona ?? "hype_fan",
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    savedBreak?.localPreviewUrl ?? savedBreak?.audioUrl ?? null,
  );
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ownedPreviewRef = useRef<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const djVolumeRef = useRef(clampPreviewVolume(djVolume));
  const personaIdRef = useRef(personaId);

  djVolumeRef.current = clampPreviewVolume(djVolume);
  personaIdRef.current = personaId;

  const {
    startRecording,
    stopRecording,
    audioBlob,
    audioUrl: micUrl,
    isRecording,
    recordingTime,
  } = useMediaRecorder();

  const revokeOwnedPreview = useCallback(() => {
    if (ownedPreviewRef.current) {
      URL.revokeObjectURL(ownedPreviewRef.current);
      ownedPreviewRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      revokeOwnedPreview();
      previewAudioRef.current?.pause();
    };
  }, [revokeOwnedPreview]);

  useEffect(() => {
    if (mode !== "mic" || !micUrl) return;
    setPreviewUrl(micUrl);
    setPreviewBlob(audioBlob);
  }, [mode, micUrl, audioBlob]);

  const playPreview = useCallback(async () => {
    if (!previewUrl) return;
    previewAudioRef.current?.pause();
    const audio = new Audio(previewUrl);
    audio.volume = djVolumeRef.current;
    previewAudioRef.current = audio;
    try {
      await audio.play();
    } catch {
      setError("Could not play preview audio.");
    }
  }, [previewUrl]);

  const generateAiPreview = useCallback(async () => {
    const text = scriptText.trim();
    if (!text) {
      setError("Write some host copy before generating audio.");
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const res = await fetch("/api/generate-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          personaId: personaIdRef.current,
          provider: "elevenlabs",
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Voice generation failed");
      }

      const blob = await res.blob();
      revokeOwnedPreview();
      const url = URL.createObjectURL(blob);
      ownedPreviewRef.current = url;
      setPreviewBlob(blob);
      setPreviewUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Voice generation failed");
    } finally {
      setGenerating(false);
    }
  }, [revokeOwnedPreview, scriptText]);

  const generateCallInPreview = useCallback(async () => {
    const prompt = scriptText.trim();
    if (!prompt) {
      setError("Add a call-in prompt before generating audio.");
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const spoken = `${callInSystemLead(callInPersona)} Caller says: ${prompt}`;
      const res = await fetch("/api/generate-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: spoken,
          personaId: personaIdRef.current,
          provider: "elevenlabs",
          personality: callInPersona === "sarcastic_critic" ? "sarcastic" : "funny",
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Call-in generation failed");
      }

      const blob = await res.blob();
      revokeOwnedPreview();
      const url = URL.createObjectURL(blob);
      ownedPreviewRef.current = url;
      setPreviewBlob(blob);
      setPreviewUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Call-in generation failed");
    } finally {
      setGenerating(false);
    }
  }, [callInPersona, revokeOwnedPreview, scriptText]);

  const uploadVoice = useCallback(
    async (blob: Blob, isCallIn: boolean): Promise<string> => {
      const formData = new FormData();
      formData.append("audio", blob, isCallIn ? "call-in.webm" : "dj-break.webm");
      formData.append("isCallIn", isCallIn ? "true" : "false");

      const res = await fetch("/api/studio/upload-voice", {
        method: "POST",
        body: formData,
        headers: isCallIn ? { "x-is-call-in": "true" } : undefined,
      });

      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "Voice upload failed");
      }
      return data.url;
    },
    [],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);

    try {
      const isCallIn = mode === "call_in";
      let audioUrl = savedBreak?.audioUrl;
      const blob =
        previewBlob ??
        (mode === "mic" ? audioBlob : null);

      if (blob) {
        audioUrl = await uploadVoice(blob, isCallIn);
      } else if (!audioUrl && !previewUrl) {
        throw new Error("Generate or record audio before saving this break.");
      }

      const personaLabel = CALL_IN_PERSONAS.find((p) => p.id === callInPersona)?.label;
      const breakItem: StudioTimelineBreak = {
        clientId: savedBreak?.clientId ?? newClientId("break"),
        afterTrackIndex,
        mode,
        kind: isCallIn ? "call_in" : "full_break",
        timing,
        label: isCallIn
          ? personaLabel
          : mode === "mic"
            ? "Mic Break"
            : "AI Host Break",
        scriptText: scriptText.trim() || undefined,
        callInPersona: isCallIn ? callInPersona : undefined,
        audioUrl,
        localPreviewUrl: previewUrl ?? undefined,
        applyTelephoneEq: isCallIn,
      };

      onSave(breakItem);
      setExpanded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save break");
    } finally {
      setSaving(false);
    }
  }, [
    afterTrackIndex,
    audioBlob,
    callInPersona,
    mode,
    onSave,
    previewBlob,
    previewUrl,
    savedBreak?.audioUrl,
    savedBreak?.clientId,
    scriptText,
    timing,
    uploadVoice,
  ]);

  if (!expanded && !savedBreak) {
    return (
      <div className="flex justify-center py-1">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-zinc-700 bg-zinc-950/60 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-400 transition-colors hover:border-amber-600/50 hover:text-amber-400"
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          Add DJ Break / Call-In
        </button>
      </div>
    );
  }

  if (savedBreak && !expanded) {
    const timingLabel =
      BREAK_TIMING_OPTIONS.find((option) => option.id === savedBreak.timing)
        ?.label ?? savedBreak.timing;
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-700/30 bg-amber-500/5 px-3 py-2">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-widest text-amber-500/90">
            {savedBreak.kind === "call_in" ? "Call-In" : "DJ Break"}
            {savedBreak.applyTelephoneEq ? " · Telephone EQ" : ""}
            {timingLabel ? ` · ${timingLabel}` : ""}
          </p>
          <p className="truncate font-sans text-xs text-zinc-300">
            {savedBreak.label ?? savedBreak.scriptText ?? "Saved break"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-900 hover:text-red-400"
            aria-label="Remove break"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-amber-500/90">
          DJ Break / Call-In
        </p>
        <button
          type="button"
          onClick={() => {
            if (savedBreak) {
              setExpanded(false);
            } else {
              setExpanded(false);
              setError(null);
            }
          }}
          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Collapse break editor"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="mb-3 space-y-1.5">
        <label
          htmlFor={`break-timing-${afterTrackIndex}`}
          className="font-mono text-[10px] uppercase tracking-widest text-zinc-500"
        >
          Break Timing
        </label>
        <select
          id={`break-timing-${afterTrackIndex}`}
          value={timing}
          onChange={(e) => setTiming(e.target.value as BreakTimingTrigger)}
          className="w-full cursor-pointer rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 font-mono text-xs text-zinc-100 outline-none focus:border-amber-600/60"
        >
          {BREAK_TIMING_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label} — {option.description}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-3 grid grid-cols-1 gap-1 sm:grid-cols-3">
        {MODE_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = mode === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setMode(tab.id);
                setError(null);
              }}
              className={[
                "inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 font-mono text-[10px] uppercase tracking-widest transition-colors",
                active
                  ? "border-amber-600/60 bg-amber-500/10 text-amber-400"
                  : "border-zinc-800 bg-zinc-950/40 text-zinc-500 hover:text-zinc-300",
              ].join(" ")}
            >
              <Icon className="h-3 w-3" aria-hidden="true" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {mode === "ai_host" && (
        <div className="space-y-3">
          <textarea
            value={scriptText}
            onChange={(e) => setScriptText(e.target.value)}
            rows={3}
            placeholder="Write the host break copy…"
            className="w-full resize-y rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 font-sans text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-amber-600/60"
          />
          <button
            type="button"
            onClick={() => void generateAiPreview()}
            disabled={generating}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-zinc-200 transition-colors hover:border-amber-600/50 hover:text-amber-400 disabled:opacity-50"
          >
            {generating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Generate AI Audio Preview
          </button>
        </div>
      )}

      {mode === "mic" && (
        <div className="space-y-3">
          <p className="font-sans text-xs text-zinc-500">
            Capture a live mic break. Recording time:{" "}
            <span className="font-mono text-zinc-300">{recordingTime}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {!isRecording ? (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  void startRecording().catch((err: unknown) => {
                    setError(
                      err instanceof Error
                        ? err.message
                        : "Microphone permission denied",
                    );
                  });
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600/90 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-white hover:bg-red-500"
              >
                <Mic className="h-3.5 w-3.5" aria-hidden="true" />
                Record
              </button>
            ) : (
              <button
                type="button"
                onClick={stopRecording}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-zinc-200 hover:border-zinc-500"
              >
                <Square className="h-3.5 w-3.5" aria-hidden="true" />
                Stop
              </button>
            )}
            <button
              type="button"
              onClick={() => void playPreview()}
              disabled={!previewUrl || isRecording}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-zinc-200 hover:border-amber-600/50 hover:text-amber-400 disabled:opacity-40"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              Play Preview
            </button>
          </div>
        </div>
      )}

      {mode === "call_in" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label
              htmlFor={`call-in-persona-${afterTrackIndex}`}
              className="font-mono text-[10px] uppercase tracking-widest text-zinc-500"
            >
              Stream Caller
            </label>
            <select
              id={`call-in-persona-${afterTrackIndex}`}
              value={callInPersona}
              onChange={(e) => setCallInPersona(e.target.value as CallInPersona)}
              className="w-full cursor-pointer rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 font-mono text-xs text-zinc-100 outline-none focus:border-amber-600/60"
            >
              {CALL_IN_PERSONAS.map((persona) => (
                <option key={persona.id} value={persona.id}>
                  {persona.label} — {persona.description}
                </option>
              ))}
            </select>
          </div>
          <textarea
            value={scriptText}
            onChange={(e) => setScriptText(e.target.value)}
            rows={3}
            placeholder="What does the caller say on air?"
            className="w-full resize-y rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 font-sans text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-amber-600/60"
          />
          <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
            Telephone EQ applied on save
          </p>
          <button
            type="button"
            onClick={() => void generateCallInPreview()}
            disabled={generating}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-zinc-200 transition-colors hover:border-amber-600/50 hover:text-amber-400 disabled:opacity-50"
          >
            {generating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Phone className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Generate Call-In Preview
          </button>
        </div>
      )}

      {(mode === "ai_host" || mode === "call_in") && previewUrl && (
        <button
          type="button"
          onClick={() => void playPreview()}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-zinc-200 hover:border-amber-600/50 hover:text-amber-400"
        >
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
          Play Preview
        </button>
      )}

      {error && (
        <p className="mt-3 font-sans text-xs text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-zinc-800/80 pt-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : null}
          Save Break
        </button>
        {savedBreak ? (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-red-400/90 hover:bg-red-500/10"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}

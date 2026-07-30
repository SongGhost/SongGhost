"use client";

import { Loader2, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PersonaId } from "@/data/personas";
import type { Station, StationTrack } from "@/data/stations";
import { primeAudioOnGesture } from "@/lib/audio-unlock";

import type { CuratedPlaylistResult } from "@/types/curator";

type AICuratorModalProps = {
  open: boolean;
  onClose: () => void;
  onLoadPlaylist: (station: Station, tracks: StationTrack[], personaId: PersonaId) => void;
};

const EXAMPLE_PROMPTS = [
  "Chill 90s trip-hop for studying",
  "Upbeat 80s synth-pop road trip",
  "Dark ambient for late night coding",
  "Sunday morning jazz and soul",
];

const inputClass =
  "bg-white border border-[#D2C5B4] focus:border-amber-500 text-zinc-900 font-mono text-xs placeholder:text-zinc-400 rounded-lg px-4 py-2.5 shadow-inner outline-none transition-all w-full";

const actionBtnClass =
  "bg-white hover:bg-amber-500 hover:text-zinc-950 border border-[#D2C5B4] text-zinc-800 font-mono text-xs font-semibold uppercase tracking-widest px-4 py-2.5 rounded-lg transition-all active:scale-95 shadow-sm";

const vibeChipClass =
  "bg-[#FAF8F5] hover:bg-white border border-[#E2D9CC] text-zinc-600 font-mono text-xs px-3 py-1.5 rounded-full cursor-pointer transition-colors hover:text-amber-700 hover:border-amber-500/40";

export default function AICuratorModal({ open, onClose, onLoadPlaylist }: AICuratorModalProps) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) {
      setError(null);
    }
  }, [open]);

  const submitPrompt = useCallback(
    async (text?: string) => {
      const value = (text ?? prompt).trim();
      if (!value || loading) return;

      primeAudioOnGesture();
      setLoading(true);
      setError(null);
      setMessages((prev) => [...prev, { role: "user", text: value }]);
      setPrompt("");

      try {
        const res = await fetch("/api/curate-playlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: value }),
        });
        const data = await res.json();

        if (!res.ok) {
          setError(data.error ?? "Could not curate playlist");
          setMessages((prev) => [
            ...prev,
            { role: "assistant", text: data.error ?? "Sorry, I couldn't build that playlist." },
          ]);
          return;
        }

        const result = data as CuratedPlaylistResult;
        const station: Station = {
          id: `ai-curator-${Date.now()}`,
          name: result.name,
          frequency: 99.9,
          category: "genres",
          defaultPersonaId: result.personaId,
          accentColor: result.accentColor,
          youtubeVideoId: result.tracks[0].youtubeId,
          tracks: result.tracks,
          description: result.description,
        };

        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: `Built "${result.name}" — ${result.tracks.length} tracks. Tuning in now…`,
          },
        ]);

        onLoadPlaylist(station, result.tracks, result.personaId);
      } catch {
        setError("Network error — try again");
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: "Network error. Please try again." },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [prompt, loading, onLoadPlaylist],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close AI Curator"
      />
      <div className="relative bg-[#FAF8F5] border border-[#D2C5B4] rounded-2xl shadow-2xl p-6 max-w-lg w-full mx-auto rounded-t-2xl sm:rounded-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-600" />
            <h2 className="font-sans text-sm sm:text-base font-semibold text-zinc-900">AI Curator</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 mb-4 min-h-[120px] max-h-[40vh]">
          {messages.length === 0 && (
            <div className="space-y-2">
              <p className="font-sans text-xs text-zinc-500">
                Describe your vibe and I&apos;ll build a 10-track playlist with a DJ host.
              </p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_PROMPTS.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => submitPrompt(example)}
                    className={vibeChipClass}
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`font-sans text-xs sm:text-sm rounded-lg px-3 py-2 ${
                msg.role === "user"
                  ? "bg-amber-500/15 text-zinc-900 ml-6 border border-amber-500/30"
                  : "bg-white text-zinc-600 mr-6 border border-[#E2D9CC]"
              }`}
            >
              {msg.text}
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 font-sans text-xs text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Curating your playlist...
            </div>
          )}
        </div>

        {error && <p className="font-sans text-[10px] text-red-400/90 mb-2">{error}</p>}

        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitPrompt();
              }
            }}
            placeholder="Chill 90s trip-hop for studying..."
            rows={2}
            disabled={loading}
            className={`${inputClass} flex-1 resize-none`}
          />
          <button
            type="button"
            onClick={() => submitPrompt()}
            disabled={loading || !prompt.trim()}
            className={`${actionBtnClass} shrink-0 self-end disabled:opacity-50`}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Curate"}
          </button>
        </div>
      </div>
    </div>
  );
}

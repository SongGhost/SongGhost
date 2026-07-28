"use client";

import { Loader2, Sparkles, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { PersonaId } from "@/data/personas";
import type { Station, StationTrack } from "@/data/stations";

export type CuratedPlaylistResult = {
  name: string;
  description: string;
  personaId: PersonaId;
  accentColor: string;
  tracks: StationTrack[];
};

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

export default function AICuratorModal({ open, onClose, onLoadPlaylist }: AICuratorModalProps) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const submitPrompt = useCallback(
    async (text?: string) => {
      const value = (text ?? prompt).trim();
      if (!value || loading) return;

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
            text: `Loaded "${result.name}" — ${result.tracks.length} tracks curated. Press play!`,
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
      <div className="curator-drawer relative w-full sm:max-w-lg mx-auto rounded-t-2xl sm:rounded-2xl p-4 sm:p-6 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-rust" style={{ color: "var(--color-rust)" }} />
            <h2 className="text-sm sm:text-base font-semibold text-ice/90">AI Curator</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-ice/50 hover:text-ice/90 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 mb-4 min-h-[120px] max-h-[40vh]">
          {messages.length === 0 && (
            <div className="space-y-2">
              <p className="text-xs text-ice/50">
                Describe your vibe and I&apos;ll build a 10-track playlist with a DJ host.
              </p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_PROMPTS.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => submitPrompt(example)}
                    className="text-[10px] sm:text-xs px-2.5 py-1 rounded-full border border-white/10 text-ice/60 hover:border-rust/40 hover:text-ice/90 transition-colors"
                    style={{ borderColor: "color-mix(in srgb, var(--color-rust) 20%, transparent)" }}
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
              className={`text-xs sm:text-sm rounded-lg px-3 py-2 ${
                msg.role === "user"
                  ? "bg-teal/10 text-ice/90 ml-6"
                  : "bg-white/5 text-ice/70 mr-6"
              }`}
              style={
                msg.role === "user"
                  ? { background: "color-mix(in srgb, var(--color-teal) 10%, transparent)" }
                  : undefined
              }
            >
              {msg.text}
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-xs text-ice/50">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Curating your playlist...
            </div>
          )}
        </div>

        {error && <p className="text-[10px] text-red-400/90 mb-2">{error}</p>}

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
            className="tune-input flex-1 rounded-lg px-3 py-2 text-xs sm:text-sm resize-none"
          />
          <button
            type="button"
            onClick={() => submitPrompt()}
            disabled={loading || !prompt.trim()}
            className="analog-btn analog-btn-tune shrink-0 px-4 py-2 text-[10px] sm:text-xs self-end disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "CURATE"}
          </button>
        </div>
      </div>
    </div>
  );
}

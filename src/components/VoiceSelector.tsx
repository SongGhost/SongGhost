"use client";

import { useRef, useState } from "react";
import { Mic, Play, X } from "lucide-react";
import { useUserPreferences } from "@/context/UserPreferencesContext";
import { VOICE_OPTIONS, type VoiceOption } from "@/types/voice";
import type { TtsProvider } from "@/types/voice";

const PREVIEW_TEXT = "You're listening to SongGhost Radio. Stay tuned!";

export default function VoiceSelector() {
  const { preferredVoice, setPreferredVoice, userTier, setUserTier } = useUserPreferences();

  const [open, setOpen] = useState(false);
  const [previewing, setPreviewing] = useState<VoiceOption | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const ttsProvider: TtsProvider = userTier === "Pro" ? "elevenlabs" : "openai";

  const previewVoice = async (voice: VoiceOption) => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }

    setPreviewing(voice);

    try {
      const res = await fetch("/api/generate-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: PREVIEW_TEXT, voice, provider: ttsProvider }),
      });

      if (!res.ok) throw new Error("Preview failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setPreviewing(null);
      };
      await audio.play();
    } catch {
      setPreviewing(null);
    }
  };

  const selected = VOICE_OPTIONS.find((v) => v.id === preferredVoice);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="bg-white border border-[#D2C5B4] rounded-lg p-3 flex items-center gap-2 w-full hover:border-[#BAA892] transition-colors cursor-pointer shadow-sm"
      >
        <Mic className="h-4 w-4 text-accent" />
        <span className="flex-1 text-left">
          <span className="block font-mono text-xs text-zinc-500 uppercase tracking-widest">
            DJ Voice
          </span>
          <span className="block font-sans text-sm text-zinc-900">{selected?.label ?? "Onyx"}</span>
        </span>
      </button>

      {open && (
        <div className="absolute z-20 mt-2 w-full min-w-[280px] bg-[#FAF8F5] border border-[#D2C5B4] rounded-2xl p-4 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-mono text-xs tracking-widest text-zinc-500 uppercase">Select Voice</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close">
              <X className="h-4 w-4 text-zinc-400 hover:text-zinc-700" />
            </button>
          </div>

          <div className="mb-4 space-y-1">
            {VOICE_OPTIONS.map((voice) => (
              <div
                key={voice.id}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 border transition-all ${
                  preferredVoice === voice.id
                    ? "bg-accent/15 border-accent/30"
                    : "border-transparent hover:bg-white"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setPreferredVoice(voice.id)}
                  className="flex-1 text-left"
                >
                  <span className="block font-sans text-sm font-medium text-zinc-900">
                    {voice.label}
                  </span>
                  <span className="block font-sans text-xs text-zinc-500">{voice.description}</span>
                </button>
                <button
                  type="button"
                  onClick={() => previewVoice(voice.id)}
                  disabled={previewing === voice.id}
                  className="bg-white hover:bg-zinc-100 border border-[#D2C5B4] text-zinc-800 rounded-full p-2 transition-all shadow-sm shrink-0"
                  aria-label={`Preview ${voice.label}`}
                >
                  <Play className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>

          <div className="border-t border-[#D2C5B4] pt-3 space-y-3">
            <div>
              <label className="font-mono text-xs tracking-widest text-zinc-500 uppercase">
                Tier ({ttsProvider === "elevenlabs" ? "ElevenLabs" : "OpenAI"})
              </label>
              <div className="mt-1 flex gap-2">
                {(["Free", "Pro"] as const).map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => setUserTier(tier)}
                    className={`flex-1 font-mono text-xs px-3 py-1.5 rounded-lg border transition-all ${
                      userTier === tier
                        ? "bg-accent/15 border-accent/40 text-accent"
                        : "bg-white border-[#E2D9CC] text-zinc-500 hover:border-[#D2C5B4]"
                    }`}
                  >
                    {tier}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

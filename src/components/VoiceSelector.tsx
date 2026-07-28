"use client";

import { useRef, useState } from "react";
import { Mic, Play, X } from "lucide-react";
import { useUserPreferences } from "@/context/UserPreferencesContext";
import { VOICE_OPTIONS, type VoiceOption } from "@/types/voice";
import type { TtsProvider } from "@/types/voice";

const PREVIEW_TEXT = "You're listening to SongGhost Radio. Stay tuned!";

export default function VoiceSelector() {
  const {
    preferredVoice,
    setPreferredVoice,
    userTier,
    setUserTier,
    djPacingFrequency,
    setDjPacingFrequency,
  } = useUserPreferences();

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
        className="settings-btn flex items-center gap-2 w-full"
      >
        <Mic className="h-4 w-4 text-amber-400" />
        <span className="flex-1 text-left">
          <span className="block text-xs text-amber-200/50 uppercase tracking-widest">DJ Voice</span>
          <span className="block text-sm text-amber-100">{selected?.label ?? "Onyx"}</span>
        </span>
      </button>

      {open && (
        <div className="voice-modal absolute z-20 mt-2 w-full min-w-[280px] rounded-lg p-4 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs tracking-widest text-amber-200/60 uppercase">Select Voice</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close">
              <X className="h-4 w-4 text-amber-200/50" />
            </button>
          </div>

          <div className="mb-4 space-y-1">
            {VOICE_OPTIONS.map((voice) => (
              <div
                key={voice.id}
                className={`voice-option flex items-center gap-2 rounded-md px-3 py-2 ${
                  preferredVoice === voice.id ? "voice-option-active" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => setPreferredVoice(voice.id)}
                  className="flex-1 text-left"
                >
                  <span className="block text-sm font-medium text-amber-100">{voice.label}</span>
                  <span className="block text-xs text-amber-200/50">{voice.description}</span>
                </button>
                <button
                  type="button"
                  onClick={() => previewVoice(voice.id)}
                  disabled={previewing === voice.id}
                  className="analog-btn !w-8 !h-8 shrink-0"
                  aria-label={`Preview ${voice.label}`}
                >
                  <Play className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>

          <div className="border-t border-white/10 pt-3 space-y-3">
            <div>
              <label className="text-xs tracking-widest text-amber-200/60 uppercase">
                DJ Pacing (every N songs)
              </label>
              <div className="mt-1 flex gap-2">
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setDjPacingFrequency(n)}
                    className={`pacing-btn ${djPacingFrequency === n ? "pacing-btn-active" : ""}`}
                  >
                    {n === 1 ? "Every" : `Every ${n}`}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs tracking-widest text-amber-200/60 uppercase">
                Tier ({ttsProvider === "elevenlabs" ? "ElevenLabs" : "OpenAI"})
              </label>
              <div className="mt-1 flex gap-2">
                {(["Free", "Pro"] as const).map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => setUserTier(tier)}
                    className={`pacing-btn ${userTier === tier ? "pacing-btn-active" : ""}`}
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

"use client";

import { Radio } from "lucide-react";

type AudioStartPromptProps = {
  visible: boolean;
  onStart: () => void;
};

export default function AudioStartPrompt({ visible, onStart }: AudioStartPromptProps) {
  if (!visible) return null;

  return (
    <div className="audio-start-prompt rounded-lg px-3 py-2.5 space-y-2">
      <p className="text-[10px] sm:text-xs text-amber-100/90 leading-snug">
        Your browser needs a tap to allow radio playback.
      </p>
      <button
        type="button"
        onClick={onStart}
        className="analog-btn analog-btn-tune w-full flex items-center justify-center gap-2 px-4 py-2 text-[10px] sm:text-xs font-bold"
      >
        <Radio className="h-3.5 w-3.5" />
        START LISTENING
      </button>
    </div>
  );
}

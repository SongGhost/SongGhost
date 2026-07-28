"use client";

import type { ReactNode } from "react";

type ControlDeckProps = {
  children: ReactNode;
  accentColor: string;
};

export default function ControlDeck({ children, accentColor }: ControlDeckProps) {
  return (
    <div
      className="control-deck station-themed sticky top-[52px] z-40 w-full border-b border-white/10 backdrop-blur-md"
      style={
        {
          "--station-accent": accentColor,
          "--station-accent-glow": `${accentColor}cc`,
          "--station-accent-soft": `${accentColor}33`,
        } as React.CSSProperties
      }
    >
      <div className="mx-auto w-full max-w-4xl px-2 sm:px-4 md:px-6 py-2 sm:py-3">
        <div className="control-deck-inner radio-chassis rounded-xl sm:rounded-2xl p-3 sm:p-4 md:p-5 shadow-xl">
          {children}
        </div>
      </div>
    </div>
  );
}

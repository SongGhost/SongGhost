"use client";

import type { ReactNode } from "react";

type ControlDeckProps = {
  children: ReactNode;
  accentColor: string;
};

export default function ControlDeck({ children, accentColor }: ControlDeckProps) {
  return (
    <div
      className="control-deck station-themed sticky top-[52px] z-40 w-full shrink-0 border-b border-white/10 backdrop-blur-md"
      style={
        {
          "--station-accent": accentColor,
          "--station-accent-glow": `${accentColor}cc`,
          "--station-accent-soft": `${accentColor}33`,
        } as React.CSSProperties
      }
    >
      <div className="mx-auto w-full max-w-4xl px-2 sm:px-4 md:px-4 py-1.5 md:py-2">
        <div className="control-deck-inner radio-chassis rounded-xl sm:rounded-2xl p-2.5 md:p-3 shadow-xl">
          {children}
        </div>
      </div>
    </div>
  );
}

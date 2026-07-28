"use client";

import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import { Radio } from "lucide-react";
import type { ReactNode } from "react";

type ControlDeckProps = {
  children: ReactNode;
  accentColor: string;
};

function ControlDeckHeader() {
  const { isSignedIn, isLoaded } = useAuth();

  return (
    <div className="control-deck-header">
      <div className="flex items-center gap-2 min-w-0">
        <Radio className="h-4 w-4 shrink-0 text-accent-gold" />
        <span className="display-glow text-xs sm:text-sm font-bold tracking-widest truncate">
          SONG<span className="text-green-400">GHOST</span>
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isLoaded && !isSignedIn && (
          <SignInButton mode="modal">
            <button type="button" className="analog-btn analog-btn-tune px-3 py-1.5 text-[10px] sm:text-xs">
              SIGN IN
            </button>
          </SignInButton>
        )}
        {isLoaded && isSignedIn && (
          <UserButton
            appearance={{
              elements: {
                avatarBox:
                  "h-8 w-8 ring-2 ring-[color-mix(in_srgb,var(--color-gold)_40%,transparent)]",
              },
            }}
          />
        )}
      </div>
    </div>
  );
}

export default function ControlDeck({ children, accentColor }: ControlDeckProps) {
  return (
    <div
      className="control-deck app-shell-control station-themed z-40 w-full shrink-0 border-b border-white/10 backdrop-blur-md lg:border-b-0"
      style={
        {
          "--station-accent": accentColor,
          "--station-accent-glow": `${accentColor}cc`,
          "--station-accent-soft": `${accentColor}33`,
        } as React.CSSProperties
      }
    >
      <div className="px-2 sm:px-4 lg:px-4 xl:px-5 py-2 lg:py-3">
        <div className="control-deck-inner radio-chassis rounded-xl sm:rounded-2xl p-3 sm:p-4 shadow-xl">
          <ControlDeckHeader />
          {children}
        </div>
      </div>
    </div>
  );
}

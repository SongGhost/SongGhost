"use client";

import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import { Radio } from "lucide-react";
import type { ReactNode } from "react";
import { consoleActionBtnClass } from "@/components/QuickConnectors";

type ControlDeckProps = {
  children: ReactNode;
  accentColor: string;
};

function ControlDeckHeader() {
  const { isSignedIn, isLoaded } = useAuth();

  return (
    <div className="control-deck-header">
      <span className="chassis-badge mb-0 flex items-center gap-2">
        <Radio className="h-3.5 w-3.5 shrink-0" />
        SongGhost
      </span>
      <div className="flex items-center gap-2 shrink-0">
        {isLoaded && !isSignedIn && (
          <SignInButton mode="modal">
            <button type="button" className={consoleActionBtnClass}>
              Sign In
            </button>
          </SignInButton>
        )}
        {isLoaded && isSignedIn && (
          <UserButton
            appearance={{
              elements: {
                avatarBox: "h-8 w-8 ring-2 ring-amber-500/40",
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
      className="app-shell-control app-scroll-area z-40 w-full shrink-0 border-b-2 border-stone-950 lg:border-b-0"
      style={
        {
          "--station-accent": accentColor,
        } as React.CSSProperties
      }
    >
      <div className="px-2 sm:px-4 lg:px-4 xl:px-5 py-2 lg:py-3">
        <div className="bg-birdseye-maple border-2 border-stone-950 shadow-xl rounded-2xl p-6">
          <ControlDeckHeader />
          {children}
        </div>
      </div>
    </div>
  );
}

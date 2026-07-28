"use client";

import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import { Radio } from "lucide-react";

export default function HeaderNav() {
  const { isSignedIn, isLoaded } = useAuth();

  return (
    <header className="header-nav sticky top-0 z-50 border-b border-white/10 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 md:px-8">
        <div className="flex items-center gap-2">
          <Radio className="h-5 w-5 text-accent-gold" />
          <span className="display-glow text-sm font-bold tracking-widest">
            SONG<span className="text-green-400">GHOST</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          {isLoaded && !isSignedIn && (
            <SignInButton mode="modal">
              <button type="button" className="analog-btn analog-btn-tune px-4 py-2 text-xs">
                SIGN IN
              </button>
            </SignInButton>
          )}
          {isLoaded && isSignedIn && (
            <UserButton
              appearance={{
                elements: {
                  avatarBox: "h-9 w-9 ring-2 ring-[color-mix(in_srgb,var(--color-gold)_40%,transparent)]",
                },
              }}
            />
          )}
        </div>
      </div>
    </header>
  );
}

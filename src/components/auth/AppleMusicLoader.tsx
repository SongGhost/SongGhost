"use client";

import Script from "next/script";

const MUSIC_KIT_SCRIPT_SRC =
  "https://js-cdn.music.apple.com/musickit/v3/musickit.js";

type AppleMusicLoaderProps = {
  /** Fired after MusicKit is configured (or an existing instance is found). */
  onReady?: () => void;
  onError?: (error: Error) => void;
};

/**
 * Asynchronously loads MusicKit JS v3 and configures the singleton with the
 * Apple Music developer token. Safe to mount once near the app root.
 */
export function AppleMusicLoader({ onReady, onError }: AppleMusicLoaderProps) {
  const handleLoad = async () => {
    try {
      const developerToken =
        process.env.NEXT_PUBLIC_APPLE_MUSIC_DEVELOPER_TOKEN?.trim();

      if (!developerToken) {
        throw new Error(
          "NEXT_PUBLIC_APPLE_MUSIC_DEVELOPER_TOKEN is not configured",
        );
      }

      const MusicKit = window.MusicKit;
      if (!MusicKit) {
        throw new Error("MusicKit global was not registered after script load");
      }

      try {
        MusicKit.getInstance();
      } catch {
        await MusicKit.configure({
          developerToken,
          app: {
            name: "SongGhost",
            build: "1.0.0",
          },
        });
      }

      onReady?.();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error("[SongGhost] MusicKit init failed:", error);
      onError?.(error);
    }
  };

  return (
    <Script
      src={MUSIC_KIT_SCRIPT_SRC}
      strategy="afterInteractive"
      async
      onLoad={() => {
        void handleLoad();
      }}
      onError={() => {
        const error = new Error("Failed to load MusicKit JS");
        console.error("[SongGhost]", error);
        onError?.(error);
      }}
    />
  );
}

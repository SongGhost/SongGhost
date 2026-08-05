/**
 * Apple Music remote companion controller — MusicKit JS singleton loader and
 * thin playback wrappers for the Pause–Talk–Play web orchestrator.
 */

export type AppleTrack = {
  id: string;
  name: string;
  artistName: string;
  albumName?: string;
  artworkUrl?: string;
  durationMs?: number;
  isPlaying: boolean;
};

type MusicKitInstance = {
  authorize: () => Promise<string>;
  unauthorize: () => Promise<void>;
  isAuthorized: boolean;
  musicUserToken?: string;
  player: {
    ready: Promise<void> | boolean;
    isPlaying: boolean;
    nowPlayingItem?: MusicKitMediaItem | null;
    pause: () => Promise<void> | void;
    play: () => Promise<void> | void;
  };
};

type MusicKitMediaItem = {
  id?: string;
  title?: string;
  artistName?: string;
  albumName?: string;
  artworkURL?: string;
  artwork?: { url?: string };
  playbackDuration?: number;
  attributes?: {
    name?: string;
    artistName?: string;
    albumName?: string;
    durationInMillis?: number;
    artwork?: { url?: string };
  };
};

type MusicKitGlobal = {
  configure: (options: {
    developerToken: string;
    app: { name: string; build: string };
  }) => Promise<MusicKitInstance> | MusicKitInstance;
  getInstance: () => MusicKitInstance;
};

declare global {
  interface Window {
    MusicKit?: MusicKitGlobal;
  }
}

const MUSIC_KIT_SCRIPT_ID = "songghost-musickit-js";
const MUSIC_KIT_SCRIPT_SRC =
  "https://js-cdn.music.apple.com/musickit/v3/musickit.js";

let musicKitPromise: Promise<MusicKitInstance> | null = null;

function getDeveloperToken(): string {
  const token =
    process.env.NEXT_PUBLIC_APPLE_MUSIC_DEVELOPER_TOKEN?.trim() ||
    process.env.NEXT_PUBLIC_APPLE_DEVELOPER_TOKEN?.trim();

  if (!token) {
    throw new Error(
      "NEXT_PUBLIC_APPLE_MUSIC_DEVELOPER_TOKEN is not configured",
    );
  }
  return token;
}

function loadMusicKitScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("MusicKit requires a browser environment"));
  }

  if (window.MusicKit) {
    return Promise.resolve();
  }

  const existing = document.getElementById(MUSIC_KIT_SCRIPT_ID);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Failed to load MusicKit JS")),
        { once: true },
      );
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = MUSIC_KIT_SCRIPT_ID;
    script.src = MUSIC_KIT_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load MusicKit JS"));
    document.head.appendChild(script);
  });
}

/**
 * Lazily load and configure the MusicKit singleton.
 * Safe to call repeatedly — subsequent calls reuse the same promise.
 */
export async function getAppleMusicKit(): Promise<MusicKitInstance> {
  if (typeof window === "undefined") {
    throw new Error("Apple Music remote controller requires a browser");
  }

  if (!musicKitPromise) {
    musicKitPromise = (async () => {
      await loadMusicKitScript();

      const MusicKit = window.MusicKit;
      if (!MusicKit) {
        throw new Error("MusicKit global was not registered after script load");
      }

      try {
        return MusicKit.getInstance();
      } catch {
        // Not configured yet — fall through to configure.
      }

      const instance = await MusicKit.configure({
        developerToken: getDeveloperToken(),
        app: {
          name: "SongGhost",
          build: "5B",
        },
      });

      return instance;
    })().catch((error) => {
      musicKitPromise = null;
      throw error;
    });
  }

  return musicKitPromise;
}

/** Prompt the listener to authorize Apple Music; returns the music user token. */
export async function authorizeAppleMusic(): Promise<string> {
  const kit = await getAppleMusicKit();
  const token = await kit.authorize();
  if (!token || typeof token !== "string") {
    throw new Error("Apple Music authorization did not return a user token");
  }
  return token;
}

export async function pauseAppleMusic(): Promise<void> {
  const kit = await getAppleMusicKit();
  await kit.player.pause();
}

export async function resumeAppleMusic(): Promise<void> {
  const kit = await getAppleMusicKit();
  await kit.player.play();
}

function mapMediaItem(
  item: MusicKitMediaItem | null | undefined,
  isPlaying: boolean,
): AppleTrack | null {
  if (!item) return null;

  const attrs = item.attributes;
  const id = item.id;
  const name = attrs?.name ?? item.title;
  const artistName = attrs?.artistName ?? item.artistName;

  if (!id || !name || !artistName) return null;

  const artworkTemplate = attrs?.artwork?.url ?? item.artworkURL ?? item.artwork?.url;
  const artworkUrl = artworkTemplate
    ? artworkTemplate.replace("{w}", "300").replace("{h}", "300")
    : undefined;

  return {
    id,
    name,
    artistName,
    albumName: attrs?.albumName ?? item.albumName,
    artworkUrl,
    durationMs: attrs?.durationInMillis ?? item.playbackDuration,
    isPlaying,
  };
}

export async function getCurrentlyPlayingAppleMusic(): Promise<AppleTrack | null> {
  const kit = await getAppleMusicKit();
  return mapMediaItem(kit.player.nowPlayingItem, Boolean(kit.player.isPlaying));
}

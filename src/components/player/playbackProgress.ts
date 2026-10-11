"use client";

import { useSyncExternalStore } from "react";

export type PlaybackProgress = {
  time: number;
  duration: number;
};

const EMPTY: PlaybackProgress = { time: 0, duration: 0 };

let snapshot: PlaybackProgress = EMPTY;
let seekImpl: (seconds: number) => void = () => {};
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): PlaybackProgress {
  return snapshot;
}

function getServerSnapshot(): PlaybackProgress {
  return EMPTY;
}

/** Latest playhead. Called from the audio engine render path; does not notify. */
export function bindPlaybackSeek(seek: (seconds: number) => void): void {
  seekImpl = seek;
}

export function seekPlayback(seconds: number): void {
  seekImpl(seconds);
}

/** Publish the playhead the dock, expanded sheet, and Drive mode all read. */
export function publishPlaybackProgress(time: number, duration: number): void {
  if (snapshot.time === time && snapshot.duration === duration) return;
  snapshot = { time, duration };
  for (const listener of listeners) listener();
}

export function usePlaybackProgress(): PlaybackProgress {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

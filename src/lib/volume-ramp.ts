export function rampVolume(
  setVolume: (volume: number) => void,
  from: number,
  to: number,
  durationMs: number,
): () => void {
  const start = performance.now();
  let rafId = 0;

  const tick = (now: number) => {
    const progress = Math.min(1, (now - start) / durationMs);
    setVolume(from + (to - from) * progress);
    if (progress < 1) {
      rafId = requestAnimationFrame(tick);
    }
  };

  rafId = requestAnimationFrame(tick);

  return () => cancelAnimationFrame(rafId);
}

export function waitForAudioEnd(audio: HTMLAudioElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };

    const onEnded = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error("DJ voice playback failed"));
    };

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
  });
}

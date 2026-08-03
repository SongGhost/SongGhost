import type { VolumeController } from "@/types/audio";
import { rampVolume } from "../volume-ramp";
import { clampGain } from "./mix-bus";

/**
 * Wraps a raw get/set pair as the {@link VolumeController} the mix engine
 * ramps against.
 *
 * Only one ramp can own a bus at a time. Starting a ramp — or setting a level
 * outright — cancels whatever was already animating, so a duck release can't be
 * fought by the duck-in it superseded. Ramp ticks bypass that cancellation
 * (they drive the raw setter) or every frame would abort its own ramp.
 */
export function createVolumeController(source: {
  getVolume: () => number;
  setVolume: (normalized: number) => void;
}): VolumeController {
  let cancelActiveRamp: (() => void) | null = null;

  const apply = (normalized: number) => source.setVolume(clampGain(normalized));

  const stopActiveRamp = () => {
    cancelActiveRamp?.();
    cancelActiveRamp = null;
  };

  return {
    getVolume: () => clampGain(source.getVolume()),

    setVolume: (normalized) => {
      stopActiveRamp();
      apply(normalized);
    },

    rampVolume: (from, to, durationMs) => {
      stopActiveRamp();

      // A zero-length ramp is a jump, and requesting an animation frame for it
      // would land the level a frame late — after the caller has moved on.
      if (!Number.isFinite(durationMs) || durationMs <= 0) {
        apply(to);
        return () => {};
      }

      apply(from);
      const cancel = rampVolume(apply, from, to, durationMs);
      cancelActiveRamp = cancel;

      return () => {
        if (cancelActiveRamp === cancel) cancelActiveRamp = null;
        cancel();
      };
    },
  };
}

"use client";

import { useEffect, useRef } from "react";

type VUMeterProps = {
  active: boolean;
  compact?: boolean;
  deck?: boolean;
  /** Inline strip for queue rows — no label, single channel, 6 bars */
  inline?: boolean;
};

const BAR_COUNT = 16;
const INLINE_BAR_COUNT = 6;

export default function VUMeter({ active, compact, deck, inline }: VUMeterProps) {
  const barsRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const bars = barsRef.current?.querySelectorAll<HTMLElement>("[data-bar]");
    if (!bars) return;

    const animate = () => {
      bars.forEach((bar, i) => {
        const barCount = inline ? INLINE_BAR_COUNT : BAR_COUNT;
        const channelOffset = inline ? 0 : i >= BAR_COUNT ? 0.3 : 0;
        const base = active ? 0.2 + Math.random() * 0.8 : 0.05 + Math.random() * 0.1;
        const wave = active
          ? Math.sin(Date.now() / 200 + (i % barCount) * 0.5 + channelOffset) * 0.15
          : 0;
        const height = Math.min(100, Math.max(5, (base + wave) * 100));
        bar.style.height = `${height}%`;
      });
      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [active, inline]);

  if (inline) {
    return (
      <div
        ref={barsRef}
        className="flex items-end gap-px h-4 w-8 shrink-0"
        aria-hidden="true"
      >
        {Array.from({ length: INLINE_BAR_COUNT }).map((_, i) => (
          <div
            key={i}
            data-bar
            className="vu-bar flex-1 rounded-sm transition-[height] duration-75 min-w-[2px]"
            style={{ height: "10%" }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={`vu-meter rounded-lg ${deck ? "p-1.5" : compact ? "p-2 sm:p-3" : "p-4"}`}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] sm:text-xs tracking-widest text-amber-200/60 uppercase">
          VU Meter
        </span>
        <span className="text-[9px] sm:text-[10px] tracking-widest text-red-400/80 uppercase">
          L · R
        </span>
      </div>
      <div ref={barsRef} className="flex gap-3 sm:gap-6">
        {[0, 1].map((channel) => (
          <div
            key={channel}
            className={`flex flex-1 items-end gap-0.5 sm:gap-1 ${deck ? "h-8 md:h-10" : compact ? "h-12 sm:h-16" : "h-24"}`}
          >
            {Array.from({ length: BAR_COUNT }).map((_, i) => (
              <div
                key={i}
                data-bar
                className="vu-bar flex-1 rounded-sm transition-[height] duration-75"
                style={{ height: "10%" }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

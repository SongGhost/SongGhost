"use client";

import { useEffect, useRef } from "react";

type VUMeterProps = {
  active: boolean;
  compact?: boolean;
  deck?: boolean;
  /** Strip outer plate — for use inside a unified cream window */
  embedded?: boolean;
  /** Inline strip for queue rows — no label, single channel, 6 bars */
  inline?: boolean;
  /** Hide internal label when chassis badge is rendered externally */
  hideLabel?: boolean;
};

const BAR_COUNT = 16;
const INLINE_BAR_COUNT = 6;

function getBarClass(heightPercent: number): string {
  const threshold = 15;
  const isLit = heightPercent > threshold;

  if (!isLit) return "bg-stone-300/80";
  return "bg-amber-600 shadow-[0_0_6px_rgba(217,119,6,0.35)]";
}

export default function VUMeter({ active, compact, deck, embedded, inline, hideLabel }: VUMeterProps) {
  const barsRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number>(0);
  const heightsRef = useRef<number[]>([]);

  useEffect(() => {
    const bars = barsRef.current?.querySelectorAll<HTMLElement>("[data-bar]");
    if (!bars) return;

    const barCount = inline ? INLINE_BAR_COUNT : BAR_COUNT;
    heightsRef.current = Array.from({ length: bars.length }, () => 10);

    const animate = () => {
      bars.forEach((bar, i) => {
        const channelOffset = inline ? 0 : i >= BAR_COUNT ? 0.3 : 0;
        const idx = i % barCount;
        const base = active ? 0.2 + Math.random() * 0.8 : 0.05 + Math.random() * 0.1;
        const wave = active
          ? Math.sin(Date.now() / 200 + idx * 0.5 + channelOffset) * 0.15
          : 0;
        const height = Math.min(100, Math.max(5, (base + wave) * 100));
        heightsRef.current[i] = height;
        bar.style.height = `${height}%`;
        bar.className = `flex-1 rounded-sm transition-[height] duration-75 min-w-[2px] ${getBarClass(height)}`;
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
            className="bg-stone-300/80 flex-1 rounded-sm transition-[height] duration-75 min-w-[2px]"
            style={{ height: "10%" }}
          />
        ))}
      </div>
    );
  }

  const meterBars = (
    <div ref={barsRef} className={`flex ${embedded ? "gap-2" : "gap-3 sm:gap-6"}`}>
      {[0, 1].map((channel) => (
        <div
          key={channel}
          className={`flex flex-1 items-end gap-0.5 sm:gap-1 ${deck || embedded ? "h-8 md:h-10" : compact ? "h-12 sm:h-16" : "h-24"}`}
        >
          {Array.from({ length: BAR_COUNT }).map((_, i) => (
            <div
              key={i}
              data-bar
              className="bg-stone-300/80 flex-1 rounded-sm transition-[height] duration-75"
              style={{ height: "10%" }}
            />
          ))}
        </div>
      ))}
    </div>
  );

  if (embedded) {
    return meterBars;
  }

  return (
    <div
      className={`bg-[#F4EEDD] border border-[#D8CFC2] shadow-inner rounded-lg ${
        deck ? "p-3.5" : compact ? "p-3.5" : "p-4"
      }`}
    >
      {!hideLabel && (
        <div className="mb-1 flex items-center justify-between">
          <span className="font-mono text-[10px] sm:text-xs tracking-widest text-stone-500 uppercase">
            Signal
          </span>
          <span className="font-mono text-[9px] sm:text-[10px] tracking-widest text-stone-400 uppercase">
            L · R
          </span>
        </div>
      )}
      {meterBars}
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";

type VUMeterProps = {
  active: boolean;
  compact?: boolean;
  deck?: boolean;
};

const BAR_COUNT = 16;

export default function VUMeter({ active, compact, deck }: VUMeterProps) {
  const barsRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const bars = barsRef.current?.querySelectorAll<HTMLElement>("[data-bar]");
    if (!bars) return;

    const animate = () => {
      bars.forEach((bar, i) => {
        const channelOffset = i >= BAR_COUNT ? 0.3 : 0;
        const base = active ? 0.2 + Math.random() * 0.8 : 0.05 + Math.random() * 0.1;
        const wave = active
          ? Math.sin(Date.now() / 200 + (i % BAR_COUNT) * 0.5 + channelOffset) * 0.15
          : 0;
        const height = Math.min(100, Math.max(5, (base + wave) * 100));
        bar.style.height = `${height}%`;
      });
      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [active]);

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

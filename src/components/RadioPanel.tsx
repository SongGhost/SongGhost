import type { ReactNode } from "react";

type RadioPanelProps = {
  children: ReactNode;
};

export default function RadioPanel({ children }: RadioPanelProps) {
  return (
    <div className="relative w-full max-w-4xl">
      <div className="rounded-2xl border border-white/[0.08] bg-[#121215] p-6 shadow-xl md:p-10">
        <div className="mb-6 flex items-center justify-between border-b border-white/[0.08] pb-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">
              Studio Deck
            </p>
            <h1 className="font-sans text-2xl font-semibold tracking-[-0.03em] text-zinc-100 md:text-3xl">
              Son
              <span className="text-accent">g</span>
              Host
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent shadow-[0_0_8px_rgba(41, 146, 207,0.5)]" />
            <span className="font-mono text-xs uppercase tracking-widest text-accent/90">
              On Air
            </span>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

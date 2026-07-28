import type { ReactNode } from "react";

type RadioPanelProps = {
  children: ReactNode;
};

export default function RadioPanel({ children }: RadioPanelProps) {
  return (
    <div className="relative w-full max-w-4xl">
      <div className="wood-trim absolute -inset-3 rounded-[2rem] z-0" />
      <div className="radio-chassis relative z-10 rounded-[1.5rem] p-6 md:p-10">
        <div className="mb-6 flex items-center justify-between border-b border-white/10 pb-4">
          <div>
            <p className="text-xs tracking-[0.35em] text-amber-200/60 uppercase">
              Model SG-700
            </p>
            <h1 className="display-glow text-2xl md:text-3xl font-bold tracking-widest">
              SONG<span className="text-green-400">GHOST</span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-400 shadow-[0_0_8px_#39ff14] animate-pulse" />
            <span className="text-xs tracking-widest text-green-400/80 uppercase">
              Stereo FM
            </span>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

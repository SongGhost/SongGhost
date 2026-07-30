import type { ReactNode } from "react";

type RadioPanelProps = {
  children: ReactNode;
};

export default function RadioPanel({ children }: RadioPanelProps) {
  return (
    <div className="relative w-full max-w-4xl">
      <div className="bg-[#EAE6DF] border border-[#D2C5B4] rounded-2xl p-6 md:p-10 shadow-md">
        <div className="mb-6 flex items-center justify-between border-b border-[#D2C5B4] pb-4">
          <div>
            <p className="font-mono text-xs tracking-widest text-zinc-500 uppercase">
              Model SG-700
            </p>
            <h1 className="font-sans text-2xl md:text-3xl font-semibold text-zinc-900 tracking-wide">
              SongGhost
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)] animate-pulse" />
            <span className="font-mono text-xs tracking-widest text-amber-700 uppercase">
              Stereo FM
            </span>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

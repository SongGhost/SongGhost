type FrequencyDialProps = {
  frequency: number;
  compact?: boolean;
  deck?: boolean;
};

export default function FrequencyDial({ frequency, compact, deck }: FrequencyDialProps) {
  const rotation = ((frequency - 88) / 20) * 270 - 135;
  const dialSize = deck
    ? "h-14 w-14 md:h-16 md:w-16"
    : compact
      ? "h-20 w-20 sm:h-24 sm:w-24"
      : "h-36 w-36";
  const needleH = deck ? "h-6 md:h-7" : compact ? "h-8" : "h-14";

  return (
    <div className={`flex flex-col items-center ${deck ? "gap-0.5" : compact ? "gap-1" : "gap-3"}`}>
      <div className={`relative ${dialSize}`}>
        <div className="absolute inset-0 rounded-full dial-face border-2 sm:border-4 border-white/10" />
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="absolute left-1/2 top-1 sm:top-2 h-2 sm:h-4 w-0.5 -translate-x-1/2 bg-[var(--color-gold)]/70 origin-bottom dial-tick"
            style={{ transform: `rotate(${i * 30}deg) translateX(-50%)`, transformOrigin: "50% 64px" }}
          />
        ))}
        <div
          className={`absolute left-1/2 top-1/2 ${needleH} w-0.5 sm:w-1 -translate-x-1/2 -translate-y-full rounded-full dial-needle origin-bottom`}
          style={{ transform: `translateX(-50%) translateY(-50%) rotate(${rotation}deg)` }}
        />
        <div className="absolute left-1/2 top-1/2 h-3 w-3 sm:h-5 sm:w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-zinc-400 to-zinc-700 border border-zinc-500" />
      </div>
      {!deck && (
        <div className={`frequency-readout rounded-lg text-center ${compact ? "px-3 py-1" : "px-6 py-2"}`}>
          <span className="text-[9px] sm:text-xs tracking-widest frequency-label uppercase">
            Frequency
          </span>
          <p className={`frequency-value font-bold tabular-nums ${compact ? "text-lg sm:text-xl" : "text-3xl"}`}>
            {frequency.toFixed(1)}
            <span className="ml-0.5 sm:ml-1 text-sm sm:text-lg frequency-label">FM</span>
          </p>
        </div>
      )}
    </div>
  );
}

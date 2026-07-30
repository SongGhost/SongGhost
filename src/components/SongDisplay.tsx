import Image from "next/image";

type SongDisplayProps = {
  title: string;
  artist: string;
  albumArt: string;
  compact?: boolean;
  deck?: boolean;
  /** Render inner row only — parent supplies the cream plate frame */
  bare?: boolean;
  /** No station session — show standby state */
  idle?: boolean;
};

export default function SongDisplay({
  title,
  artist,
  albumArt,
  compact,
  deck,
  bare,
  idle,
}: SongDisplayProps) {
  const artSize = deck || bare ? 48 : compact ? 72 : 160;
  const hasArt = Boolean(albumArt?.trim());

  const inner = (
    <div
      className={`flex ${compact || deck || bare ? "flex-row items-center gap-2 md:gap-3" : "flex-col md:flex-row items-center gap-6"}`}
    >
      <div
        className="shrink-0 flex items-center justify-center rounded-lg bg-stone-200/60 border border-[#D8CFC2] overflow-hidden"
        style={{ width: artSize, height: artSize }}
      >
        {hasArt ? (
          <Image
            src={albumArt}
            alt={`${title} album art`}
            width={artSize}
            height={artSize}
            className="rounded-lg object-cover"
            style={{ width: artSize, height: artSize }}
            unoptimized
          />
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-widest text-stone-400 text-center px-1">
            {idle ? "Standby" : "Tuning"}
          </span>
        )}
      </div>
      <div className="flex-1 text-left min-w-0">
        <p className="font-mono text-[10px] sm:text-xs tracking-widest text-stone-500 uppercase mb-0.5 sm:mb-1">
          {idle ? "Off Air" : "Now Playing"}
        </p>
        <h2
          className={`text-stone-900 font-sans font-bold truncate ${
            deck || bare ? "text-base" : compact ? "text-base sm:text-xl" : "text-2xl md:text-4xl"
          }`}
        >
          {title}
        </h2>
        <p
          className={`text-amber-800 font-mono text-xs font-bold mt-0.5 sm:mt-1 truncate ${
            deck || bare ? "" : compact ? "text-sm sm:text-base" : "text-lg md:text-xl"
          }`}
        >
          {artist}
        </p>
      </div>
    </div>
  );

  if (bare) return inner;

  return (
    <div
      className={`bg-[#FAF7EE] border border-[#D8CFC2] shadow-inner rounded-xl ${
        deck ? "p-4 mb-4" : compact ? "p-3 sm:p-4" : "p-4 md:p-6"
      }`}
    >
      {inner}
    </div>
  );
}

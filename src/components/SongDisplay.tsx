import Image from "next/image";

type SongDisplayProps = {
  title: string;
  artist: string;
  albumArt: string;
  compact?: boolean;
  deck?: boolean;
};

export default function SongDisplay({ title, artist, albumArt, compact, deck }: SongDisplayProps) {
  const artSize = deck ? 48 : compact ? 72 : 160;

  return (
    <div className={`song-display rounded-lg sm:rounded-xl ${deck ? "p-1.5" : compact ? "p-2 sm:p-3" : "p-4 md:p-6"}`}>
      <div className={`flex ${compact || deck ? "flex-row items-center gap-2 md:gap-3" : "flex-col md:flex-row items-center gap-6"}`}>
        <div className="album-frame shrink-0">
          <Image
            src={albumArt}
            alt={`${title} album art`}
            width={artSize}
            height={artSize}
            className="rounded-md object-cover"
            style={{ width: artSize, height: artSize }}
            unoptimized
          />
        </div>
        <div className="flex-1 text-left min-w-0">
          <p className="text-[10px] sm:text-xs tracking-[0.25em] text-amber-200/50 uppercase mb-0.5 sm:mb-1">
            Now Playing
          </p>
          <h2
            className={`display-glow font-bold truncate ${
              deck ? "text-sm md:text-base" : compact ? "text-base sm:text-xl" : "text-2xl md:text-4xl"
            }`}
          >
            {title}
          </h2>
          <p
            className={`frequency-artist mt-0.5 sm:mt-1 truncate ${
              deck ? "text-xs md:text-sm" : compact ? "text-sm sm:text-base" : "text-lg md:text-xl"
            }`}
          >
            {artist}
          </p>
          {!compact && (
            <div className="mt-4 flex items-center justify-start gap-1">
              {Array.from({ length: 20 }).map((_, i) => (
                <span
                  key={i}
                  className="h-1 w-1 rounded-full bg-amber-400/40"
                  style={{ opacity: 0.3 + (i % 5) * 0.15 }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

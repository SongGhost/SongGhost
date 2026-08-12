/**
 * Now-playing title + artist/album subtitle for the player chrome.
 * Kept presentation-only so ControlDeck and MobilePlayerSheet share one format.
 */

export type TrackMetadataProps = {
  title: string;
  artist: string;
  /** Album name from the active track, or station.albumContext.albumTitle */
  album?: string | null;
  /**
   * `compact` — sticky deck / mini-bar.
   * `sheet` — expanded mobile now-playing sheet.
   */
  size?: "compact" | "sheet";
  className?: string;
  /** When true, center-align (mobile sheet). Default left. */
  align?: "left" | "center";
};

/** `Artist • Album` when both exist; otherwise whichever side is available. */
export function formatArtistAlbum(
  artist: string,
  album?: string | null,
): string {
  const artistName = artist.trim();
  const albumTitle = album?.trim() ?? "";
  if (artistName && albumTitle) return `${artistName} • ${albumTitle}`;
  return artistName || albumTitle;
}

export default function TrackMetadata({
  title,
  artist,
  album,
  size = "compact",
  className = "",
  align = "left",
}: TrackMetadataProps) {
  const subtitle = formatArtistAlbum(artist, album);
  const isSheet = size === "sheet";
  const alignClass = align === "center" ? "text-center" : "text-left";

  return (
    <div className={`min-w-0 ${alignClass} ${className}`.trim()}>
      <p
        className={
          isSheet
            ? "truncate font-sans text-lg font-bold leading-tight text-slate-100 hover:underline cursor-pointer"
            : "truncate font-sans text-sm font-bold leading-tight text-slate-100 hover:underline cursor-pointer"
        }
      >
        {title}
      </p>
      {subtitle && (
        <p className="mt-0.5 truncate font-sans text-xs font-medium leading-tight text-slate-400">
          {subtitle}
        </p>
      )}
    </div>
  );
}

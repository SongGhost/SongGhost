"use client";

import { Disc3 } from "lucide-react";
import Image from "next/image";
import { useCallback, useState, type ReactNode } from "react";
import { nextYouTubeThumbnailFallback } from "@/lib/youtube/ids";

export type ArtworkImageProps = {
  src?: string | null;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
  fill?: boolean;
  sizes?: string;
  unoptimized?: boolean;
  priority?: boolean;
  /** Replaces the default Disc3 icon when every src / quality tier fails. */
  fallbackIcon?: ReactNode;
};

function ArtworkFallback({
  alt,
  className,
  fill,
  width,
  height,
  icon,
}: {
  alt: string;
  className?: string;
  fill?: boolean;
  width?: number;
  height?: number;
  icon: ReactNode;
}) {
  const decorative = !alt.trim();
  return (
    <div
      className={
        fill
          ? "absolute inset-0 flex items-center justify-center"
          : `flex h-full w-full items-center justify-center ${className ?? ""}`.trim()
      }
      style={!fill && width && height ? { width, height } : undefined}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : alt}
      aria-hidden={decorative || undefined}
    >
      {icon}
    </div>
  );
}

/**
 * Artwork renderer with YouTube CDN quality fallback.
 * A 404 on `i.ytimg.com` steps hqdefault → mqdefault → default, then a clean icon.
 */
export default function ArtworkImage({
  src,
  alt,
  className,
  width,
  height,
  fill = false,
  sizes,
  unoptimized = true,
  priority,
  fallbackIcon,
}: ArtworkImageProps) {
  const incoming = src?.trim() ?? "";
  const [prevSrc, setPrevSrc] = useState(incoming);
  const [currentSrc, setCurrentSrc] = useState(incoming);
  const [failed, setFailed] = useState(!incoming);

  if (incoming !== prevSrc) {
    setPrevSrc(incoming);
    setCurrentSrc(incoming);
    setFailed(!incoming);
  }

  const handleError = useCallback(() => {
    const fallback = nextYouTubeThumbnailFallback(currentSrc);
    if (fallback) {
      setCurrentSrc(fallback);
      return;
    }
    setFailed(true);
  }, [currentSrc]);

  const icon = fallbackIcon ?? (
    <Disc3 className="h-6 w-6 text-zinc-600" aria-hidden="true" />
  );

  if (failed || !currentSrc) {
    return (
      <ArtworkFallback
        alt={alt}
        className={className}
        fill={fill}
        width={width}
        height={height}
        icon={icon}
      />
    );
  }

  if (fill) {
    return (
      <Image
        key={currentSrc}
        src={currentSrc}
        alt={alt}
        fill
        sizes={sizes}
        className={className}
        unoptimized={unoptimized}
        priority={priority}
        onError={handleError}
      />
    );
  }

  if (width != null && height != null) {
    return (
      <Image
        key={currentSrc}
        src={currentSrc}
        alt={alt}
        width={width}
        height={height}
        className={className}
        unoptimized={unoptimized}
        priority={priority}
        onError={handleError}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary CDN thumbs without fixed dimensions
    <img
      src={currentSrc}
      alt={alt}
      className={className}
      onError={handleError}
    />
  );
}

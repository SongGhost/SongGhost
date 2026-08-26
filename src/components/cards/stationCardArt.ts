/**
 * Accent-gradient sleeve for cards that have a vibe color but no artwork yet
 * (Inspired blueprints). Catalog cards without art keep the Disc3 icon.
 */

export function shouldUseAccentGradient(
  artworkUrl: string | null | undefined,
  accentColor: string | null | undefined,
  enabled = true,
): boolean {
  return enabled && !artworkUrl?.trim() && Boolean(accentColor?.trim());
}

/**
 * Diagonal wash of `accentColor` over the dark slate base — intentional, not
 * a missing-image state.
 */
export function accentGradientStyle(accentColor: string): {
  background: string;
} {
  const color = accentColor.trim();
  return {
    background: `linear-gradient(145deg, ${color} 0%, color-mix(in srgb, ${color} 42%, #121215) 42%, #0c0c0e 100%), radial-gradient(circle at 78% 18%, color-mix(in srgb, ${color} 55%, transparent) 0%, transparent 58%)`,
  };
}

"use client";

import { useEffect, useRef, useState } from "react";

export type AmbientCanvasProps = {
  /** Current track artwork — drives the ambient color orbs */
  albumArtUrl?: string | null;
  /** Fallback hue when artwork is missing or CORS-blocked */
  accentColor?: string;
  className?: string;
};

type Rgb = { r: number; g: number; b: number };

const FALLBACK_A: Rgb = { r: 196, g: 136, b: 42 };
const FALLBACK_B: Rgb = { r: 80, g: 60, b: 30 };
const TRANSITION_MS = 900;

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseHex(hex: string): Rgb | null {
  const value = hex.trim().replace(/^#/, "");
  const expanded =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function rgbCss({ r, g, b }: Rgb): string {
  return `rgb(${r}, ${g}, ${b})`;
}

function shift(rgb: Rgb, amount: number): Rgb {
  return {
    r: clampByte(rgb.r + amount),
    g: clampByte(rgb.g + amount * 0.6),
    b: clampByte(rgb.b - amount * 0.4),
  };
}

/**
 * Sample two saturated hues from album art for the ambient orbs.
 * Uses CORS-anonymous load; falls back quietly when the CDN taints the canvas.
 */
async function extractPalette(url: string): Promise<[Rgb, Rgb] | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";

    const fail = () => resolve(null);
    img.onerror = fail;

    img.onload = () => {
      try {
        const size = 32;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          fail();
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        let r1 = 0;
        let g1 = 0;
        let b1 = 0;
        let n1 = 0;
        let r2 = 0;
        let g2 = 0;
        let b2 = 0;
        let n2 = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          if (a < 128) continue;
          // Skip near-black / near-white so orbs stay chromatic.
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          if (max < 28 || min > 230) continue;
          const x = (i / 4) % size;
          if (x < size / 2) {
            r1 += r;
            g1 += g;
            b1 += b;
            n1 += 1;
          } else {
            r2 += r;
            g2 += g;
            b2 += b;
            n2 += 1;
          }
        }

        if (n1 === 0 && n2 === 0) {
          fail();
          return;
        }

        const left: Rgb =
          n1 > 0
            ? { r: clampByte(r1 / n1), g: clampByte(g1 / n1), b: clampByte(b1 / n1) }
            : { r: clampByte(r2 / n2), g: clampByte(g2 / n2), b: clampByte(b2 / n2) };
        const right: Rgb =
          n2 > 0
            ? { r: clampByte(r2 / n2), g: clampByte(g2 / n2), b: clampByte(b2 / n2) }
            : shift(left, 40);

        resolve([left, right]);
      } catch {
        fail();
      }
    };

    img.src = url;
  });
}

function fallbackPair(accentColor?: string): [Rgb, Rgb] {
  const primary = (accentColor && parseHex(accentColor)) || FALLBACK_A;
  return [primary, shift(primary, -50) ?? FALLBACK_B];
}

/**
 * Full-viewport ambient wash driven by the on-air sleeve.
 * Two blurred radial orbs crossfade when `albumArtUrl` changes.
 */
export default function AmbientCanvas({
  albumArtUrl,
  accentColor,
  className = "",
}: AmbientCanvasProps) {
  const [colors, setColors] = useState<[Rgb, Rgb]>(() => fallbackPair(accentColor));
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const url = albumArtUrl?.trim();

    if (!url) {
      setColors(fallbackPair(accentColor));
      return;
    }

    void extractPalette(url).then((palette) => {
      if (requestId !== requestIdRef.current) return;
      setColors(palette ?? fallbackPair(accentColor));
    });
  }, [albumArtUrl, accentColor]);

  const [c1, c2] = colors;
  const gradientA = `radial-gradient(ellipse 70% 55% at 22% 28%, ${rgbCss(c1)} 0%, transparent 70%)`;
  const gradientB = `radial-gradient(ellipse 65% 50% at 78% 72%, ${rgbCss(c2)} 0%, transparent 70%)`;

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed inset-0 z-0 overflow-hidden ${className}`.trim()}
    >
      <div
        className="absolute inset-[-20%] will-change-[background,opacity]"
        style={{
          backgroundImage: gradientA,
          filter: "blur(120px)",
          opacity: 0.18,
          transition: `background ${TRANSITION_MS}ms ease, opacity ${TRANSITION_MS}ms ease`,
        }}
      />
      <div
        className="absolute inset-[-20%] will-change-[background,opacity]"
        style={{
          backgroundImage: gradientB,
          filter: "blur(120px)",
          opacity: 0.18,
          transition: `background ${TRANSITION_MS}ms ease, opacity ${TRANSITION_MS}ms ease`,
        }}
      />
    </div>
  );
}

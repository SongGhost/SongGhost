import type { Config } from "tailwindcss";

/**
 * Tailwind theme extensions for SongGhost.
 * Brand accent tokens are defined as CSS variables in `src/app/globals.css`
 * and mirrored into `@theme` there for Tailwind v4 utility generation.
 */
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: "var(--brand-accent)",
          hover: "var(--brand-accent-hover)",
          glow: "var(--brand-accent-glow)",
        },
      },
    },
  },
  plugins: [],
};

export default config;

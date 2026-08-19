import type { NextConfig } from "next";
import { execSync } from "node:child_process";

/**
 * Prefer the Vercel-provided commit SHA; fall back to a local full
 * `git rev-parse HEAD`. Consumers (header / footer) slice for display.
 */
function resolvePublicCommitSha(): string {
  const fromEnv = (
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
    || process.env.VERCEL_GIT_COMMIT_SHA
    || ""
  ).trim();
  if (fromEnv) return fromEnv;

  try {
    return execSync("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "dev";
  }
}

const commitSha = resolvePublicCommitSha();

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: commitSha,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "i.ytimg.com",
      },
      {
        protocol: "https",
        hostname: "i.scdn.co",
      },
      {
        protocol: "https",
        hostname: "mosaic.scdn.co",
      },
      {
        protocol: "https",
        hostname: "**.r2.dev",
      },
      {
        protocol: "https",
        hostname: "**.cloudflarestorage.com",
      },
    ],
  },
};

export default nextConfig;

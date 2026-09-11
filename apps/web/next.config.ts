import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export default function config(phase: string): NextConfig {
  const development = phase === PHASE_DEVELOPMENT_SERVER;
  const requestedEngine = process.env.NEXT_PUBLIC_AXIOM_EDITOR_ENGINE;
  return {
    devIndicators:false,
    // Never let `next dev` overwrite a retained production release in .env.
    distDir: development
      ? process.env.AXIOM_DEV_DIST_DIR || ".next/dev-8080"
      : process.env.AXIOM_DIST_DIR || ".next",
    transpilePackages: ["@axiom/markdown", "@axiom/shared", "@axiom/editor"],
    poweredByHeader: false,
    env: {
      NEXT_PUBLIC_AXIOM_EDITOR_ENGINE:
        requestedEngine === "milkdown" || requestedEngine === "native"
          ? requestedEngine
          : "milkdown",
    },
    serverExternalPackages: ["pg", "nodemailer"],
    experimental: { serverActions: { bodySizeLimit: "2mb" } },
    async headers() {
      return [
        {
          source: "/(.*)",
          headers: [
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "Referrer-Policy", value: "same-origin" },
            { key: "X-Frame-Options", value: "DENY" },
            {
              key: "Permissions-Policy",
              value: "camera=(), microphone=(), geolocation=()",
            },
          ],
        },
      ];
    },
  };
}

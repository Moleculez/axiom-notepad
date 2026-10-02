import { defineConfig } from "vite";
import { resolve } from "node:path";

const base = process.env.SHOWCASE_BASE ?? "/axiom-notepad/";
if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base))
  throw new Error("Use a root-relative showcase base ending in a slash.");
export default defineConfig({
  root: resolve("apps/showcase"),
  base,
  publicDir: false,
  envDir: resolve("data/showcase-no-env"),
  cacheDir: resolve("data/showcase-vite-cache"),
  define: {
    "process.env.NEXT_PUBLIC_AXIOM_EDITOR_ENGINE": '"milkdown"',
    __AXIOM_ASSET_BASE__: JSON.stringify(base),
  },
  resolve: {
    alias: {
      "@axiom/markdown": resolve("packages/markdown/src/index.ts"),
      "@axiom/shared": resolve("packages/shared/src"),
      "@axiom/editor": resolve("packages/editor/src"),
    },
  },
  build: {
    target: "es2022",
    outDir: "dist",
    assetsInlineLimit: 0,
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    fs: {
      allow: [resolve("apps"), resolve("packages"), resolve("node_modules")],
      deny: ["**/.env*", "**/data/**", "**/.git/**"],
    },
  },
});

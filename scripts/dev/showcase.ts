import { createServer } from "vite";
import { resolve } from "node:path";
import { showcaseAssets } from "../build/showcase-assets";
import { buildCatalogs } from "../i18n/build";
const publicDir = resolve("data/showcase-public");
await buildCatalogs();
await showcaseAssets(publicDir);
const server = await createServer({
  configFile: resolve("apps/showcase/vite.config.ts"),
  publicDir,
  server: { host: "127.0.0.1", port: 3010, strictPort: true },
});
await server.listen();
server.printUrls();

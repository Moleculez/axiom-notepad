import { createServer } from "vite";
import { resolve } from "node:path";
// This laboratory never loads .env, contacts a database, or opens real notes.
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  envFile: false,
  cacheDir: "data/editor-lab-vite-cache",
  server: {
    host: "127.0.0.1",
    port: 3003,
    strictPort: true,
    watch: {
      ignored: [
        "**/data/**",
        "**/.next/**",
        "**/test-results/**",
        "**/playwright-report/**",
      ],
    },
    fs: {
      strict: true,
      allow: [
        resolve("apps/web"),
        resolve("packages"),
        resolve("tests/editor-lab"),
        resolve("node_modules"),
        resolve("data/editor-lab-vite-cache"),
      ],
      deny: ["**/.env*", "**/data/**", "**/.git/**"],
    },
  },
});
await server.listen();
process.stdout.write(
  "Editor laboratory: http://127.0.0.1:3003/tests/editor-lab/index.html\n",
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });

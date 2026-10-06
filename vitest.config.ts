import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({
  // New workspace code remains testable before a developer refreshes npm links.
  resolve: { alias: { "@axiom/mindmap": resolve("packages/mindmap/src") } },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 20000 },
});

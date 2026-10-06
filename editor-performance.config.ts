import { defineConfig } from "@playwright/test";
import lab from "./editor-lab.config";
// An explicit invocation, never part of concurrent interaction acceptance.
process.env.AXIOM_EDITOR_BENCHMARK = "1";
export default defineConfig({
  ...lab,
  testMatch: "performance.spec.ts",
  workers: 1,
  fullyParallel: false,
  outputDir: "data/editor-performance-results",
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});

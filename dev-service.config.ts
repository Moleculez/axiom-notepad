import { defineConfig } from "@playwright/test";

/** Read-only application smoke; editing exercises use the local scratchpad. */
export default defineConfig({
  testDir: "./tests/dev-service",
  outputDir: "./test-results/latest-dev-8080",
  timeout: 90000,
  expect: { timeout: 20000 },
  workers: 1,
  fullyParallel: false,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/dev-service", open: "never" }],
  ],
  use: {
    baseURL: "http://localhost:8080",
    browserName: "chromium",
    extraHTTPHeaders: { "X-Axiom-Appearance-Schema": "5" },
    viewport: { width: 1440, height: 1000 },
    serviceWorkers: "block",
    // Never record authenticated request headers or session storage in a trace.
    trace: "off",
    screenshot: "only-on-failure",
  },
});

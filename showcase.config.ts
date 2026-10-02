import { defineConfig } from "@playwright/test";

const remote =
  !!process.env.SHOWCASE_TEST_URL &&
  !["127.0.0.1", "localhost"].includes(
    new URL(process.env.SHOWCASE_TEST_URL).hostname,
  );
/** Run against the built repository-prefix site, not the Vite source server. */
export default defineConfig({
  testDir: "./tests/showcase",
  // Keep local/CI gates strict; a public CDN has a separate cold-network budget.
  timeout: remote ? 180000 : 45000,
  expect: { timeout: remote ? 90000 : 10000 },
  fullyParallel: true,
  workers: remote ? 1 : 2,
  reporter: "list",
  outputDir: "data/showcase-results",
  use: {
    baseURL:
      process.env.SHOWCASE_TEST_URL ?? "http://127.0.0.1:3010/axiom-notepad/",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    navigationTimeout: remote ? 90000 : 30000,
  },
  webServer: process.env.SHOWCASE_TEST_URL
    ? undefined
    : {
        command: "npm run showcase:preview",
        url: "http://127.0.0.1:3010/axiom-notepad/",
        reuseExistingServer: !process.env.CI,
        timeout: 30000,
      },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    {
      name: "firefox",
      use: {
        browserName: "firefox",
        launchOptions: { firefoxUserPrefs: { "network.proxy.type": 0 } },
      },
    },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});

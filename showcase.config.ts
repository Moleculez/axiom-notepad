import { defineConfig } from "@playwright/test";

/** Run against the built repository-prefix site, not the Vite source server. */
export default defineConfig({
  testDir: "./tests/showcase",
  timeout: 45000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  workers: 2,
  reporter: "list",
  outputDir: "data/showcase-results",
  use: {
    baseURL:
      process.env.SHOWCASE_TEST_URL ?? "http://127.0.0.1:3010/axiom-notepad/",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
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

import { defineConfig } from "@playwright/test";
// A developer's system proxy must not intercept the local fixture readiness probe.
process.env.NO_PROXY = [process.env.NO_PROXY, "localhost", "127.0.0.1"]
  .filter(Boolean)
  .join(",");
export default defineConfig({
  testDir: "./tests/editor-lab",
  testMatch: "**/*.spec.ts",
  timeout: 30000,
  expect: { timeout: 5000 },
  workers: 3,
  fullyParallel: true,
  reporter: "list",
  outputDir: "data/editor-lab-results",
  webServer: {
    command: "npm run editor:lab",
    url: "http://127.0.0.1:3003/tests/editor-lab/index.html",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
  use: {
    baseURL: "http://127.0.0.1:3003",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
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

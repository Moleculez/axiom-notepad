import { defineConfig } from "@playwright/test";
import "dotenv/config";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    browserName: (process.env.TEST_BROWSER || "chromium") as
      "chromium" | "firefox" | "webkit",
    baseURL:
      process.env.TEST_APP_URL ||
      process.env.APP_URL ||
      "http://localhost:8080",
    launchOptions:
      process.env.TEST_BROWSER === "firefox"
        ? { firefoxUserPrefs: { "network.proxy.type": 0 } }
        : {},
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});

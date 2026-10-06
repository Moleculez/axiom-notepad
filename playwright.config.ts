import { defineConfig } from "@playwright/test";
import { mutationTestTarget } from "./packages/shared/src/test-target";
const target = mutationTestTarget(process.env, process.env.AXIOM_TEST_ROOT);
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    browserName: (process.env.TEST_BROWSER || "chromium") as
      "chromium" | "firefox" | "webkit",
    baseURL: target.origin,
    launchOptions:
      process.env.TEST_BROWSER === "firefox"
        ? { firefoxUserPrefs: { "network.proxy.type": 0 } }
        : {},
    viewport: { width: 1440, height: 1000 },
    trace: "off",
    screenshot: "only-on-failure",
  },
});

import { defineConfig, devices } from "@playwright/test";
import { mutationTestTarget } from "./packages/shared/src/test-target";
const baseURL = mutationTestTarget(
  process.env,
  process.env.AXIOM_TEST_ROOT,
).origin;
if (baseURL !== "http://localhost:3004")
  throw new Error(
    "Planning mutation acceptance requires isolated staging on 3004.",
  );
process.env.TEST_APP_URL = baseURL;
process.env.TEST_OWNER_EMAIL = "extensions@axiom.local";
process.env.TEST_OWNER_PASSWORD = "ExtensionsTest2026!";
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  testMatch: ["planning-suite.spec.ts", "planning-intake.spec.ts"],
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["line"]],
  outputDir: "test-results/planning",
  use: {
    baseURL,
    trace: "off",
    screenshot: "only-on-failure",
    viewport: { width: 1500, height: 960 },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1500, height: 960 },
      },
    },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 1500, height: 960 },
        launchOptions: { firefoxUserPrefs: { "network.proxy.type": 0 } },
      },
    },
    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1500, height: 960 },
      },
    },
  ],
});

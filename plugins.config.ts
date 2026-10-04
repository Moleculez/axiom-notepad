import { defineConfig, devices } from "@playwright/test";
const baseURL = process.env.TEST_APP_URL || "http://localhost:3004";
if (
  new URL(baseURL).port !== "3004" ||
  !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname)
)
  throw new Error(
    "Extension acceptance only runs against the isolated port-3004 dataset.",
  );
// Fictional accounts in the guarded staging database only.
process.env.TEST_APP_URL = baseURL;
process.env.TEST_OWNER_EMAIL = "extensions@axiom.local";
process.env.TEST_OWNER_PASSWORD = "ExtensionsTest2026!";
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: [
    "plugins-platform.spec.ts",
    "plugins-assistant-regression.spec.ts",
  ],
  timeout: 60000,
  workers: 1,
  fullyParallel: false,
  reporter: [["line"]],
  outputDir: "test-results/plugins",
  // No recorded authentication cookies or outgoing document content in traces.
  use: {
    baseURL,
    trace: "off",
    screenshot: "only-on-failure",
    viewport: { width: 1500, height: 960 },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        launchOptions: { firefoxUserPrefs: { "network.proxy.type": 0 } },
      },
    },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});

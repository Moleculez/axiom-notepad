import { defineConfig } from "@playwright/test";

const phase =
  process.env.TEST_DEPLOYMENT_PHASE === "restart" ? "restart" : "workflow";

export default defineConfig({
  testDir: "./tests/deployment",
  workers: 1,
  timeout: 120000,
  expect: { timeout: 20000 },
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: `playwright-report/deployment-current/${phase}`,
      },
    ],
  ],
  outputDir: `test-results/deployment-current/${phase}`,
  use: {
    baseURL: process.env.TEST_APP_URL,
    ignoreHTTPSErrors: true, // Only the isolated localhost Caddy CA, never production tests.
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});

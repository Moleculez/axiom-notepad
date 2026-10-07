import { defineConfig, devices } from "@playwright/test";
import { mutationTestTarget } from "./packages/shared/src/test-target";

const target = mutationTestTarget(process.env, process.env.AXIOM_TEST_ROOT);
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: [
    "editor-vnext.spec.ts",
    "explorer.spec.ts",
    "document-export.spec.ts",
    "research-writing.spec.ts",
    "resource-review.spec.ts",
    "workspace-imports.spec.ts",
    "workspace-planning.spec.ts",
    "planning-suite.spec.ts",
    "planning-archives.spec.ts",
    "planning-lab.spec.ts",
    "planning-scale.spec.ts",
    "productivity-assistant.spec.ts",
    "assistant-grounding.spec.ts",
    "planning-intake.spec.ts",
    "ui-controls.spec.ts",
    "interface-harmony.spec.ts",
    "settings-panels.spec.ts",
    "workspace-websites.spec.ts",
    "productivity-settings.spec.ts",
    "research.spec.ts",
    "research-library.spec.ts",
    "pdf-reader.spec.ts",
    "pdf-workbench.spec.ts",
    "trash-recovery.spec.ts",
  ],
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 120000,
  expect: { timeout: 20000 },
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  outputDir: "data/reliability-results",
  use: {
    baseURL: target.origin,
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

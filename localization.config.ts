import { defineConfig } from "@playwright/test";
import isolated from "./plugins.config";
/** Reuse the existing fail-closed, local-only dataset and health attestation. */
export default defineConfig({
  ...isolated,
  testMatch: ["locale-settings.spec.ts", "mcp-review.spec.ts"],
  outputDir: "data/i18n/account-results",
});

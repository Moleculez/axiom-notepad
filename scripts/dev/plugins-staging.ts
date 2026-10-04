import { runStaging } from "./staging-runner";
// Test-only profile. Never inherits the working dataset or enables flags in .env.
process.env.AXIOM_PLUGINS_ENABLED = "true";
process.env.AXIOM_PLUGIN_IMPORTS_ENABLED = "true";
// A known, non-production key and only the local deterministic provider.
// These values never enter .env or the working server's environment.
process.env.TOOL_PROVIDER_KEY = Buffer.alloc(32, 0x31).toString("base64");
process.env.TOOL_PROVIDER_ALLOWED_ORIGINS = "http://127.0.0.1:8096";
await runStaging(
  {
    database: "axiom_plugins_test",
    storage: "data/plugins-test-attachments",
    dist: ".next/plugins-test",
    devDist: ".next/plugins-test-dev",
    webPort: 3004,
    syncPort: 1236,
  },
  process.argv[2],
  process.argv.slice(3),
);

import { runStaging } from "./staging-runner";

await runStaging(
  {
    database: process.env.AXIOM_STAGING_DATABASE ?? "axiom_release_test",
    storage:
      process.env.AXIOM_STAGING_STORAGE ?? "data/release-test-attachments",
    dist: process.env.AXIOM_STAGING_DIST ?? ".next/release-test",
    devDist: ".next/release-test-dev",
    webPort: Number(process.env.AXIOM_STAGING_PORT ?? 3004),
    syncPort: Number(process.env.AXIOM_STAGING_SYNC_PORT ?? 1236),
  },
  process.argv[2],
  process.argv.slice(3),
);

// Compatibility profile for retained September 11 verification evidence.
// New work should use npm run staging and an isolated profile.
import { runStaging } from "./dev/staging-runner";
await runStaging(
  {
    database: "axiom_refinement_test_20260908",
    storage: "data/refinement-test-attachments-20260908",
    dist: ".next/management-console-20260911",
    devDist: ".next/platform-staging-dev",
    webPort: 3002,
    syncPort: 1235,
  },
  process.argv[2],
  process.argv.slice(3),
);

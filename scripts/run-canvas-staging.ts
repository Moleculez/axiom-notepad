// Compatibility profile for retained September 11 verification evidence.
// New work should use npm run staging and an isolated profile.
import { runStaging } from "./dev/staging-runner";
await runStaging(
  {
    database: "axiom_canvas_v1_test_20260911",
    storage: "data/canvas-v1-test-attachments-20260911",
    dist: ".next/canvas-v1-20260911",
    devDist: ".next/canvas-v1-dev-20260911",
    webPort: 3004,
    syncPort: 1236,
  },
  process.argv[2],
  process.argv.slice(3),
);

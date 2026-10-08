import "dotenv/config";
import { pool, query } from "../../packages/shared/src/db";
import {
  processWorkspaceJob,
  workspaceMaintenance,
} from "../../packages/shared/src/workspace-jobs";
import { processToolJob } from "../../packages/shared/src/tool-jobs";
import { processChangeSet } from "../../packages/shared/src/workspace-change-sets";
import { processSiteRelease } from "../../packages/shared/src/site-worker";
import { executeReviewedAction } from "../../apps/web/lib/reviewed-actions";
import { analyticsMaintenance } from "../../packages/shared/src/site-analytics";
import { backfillResearchIndex } from "../../packages/shared/src/documents";
import { processPlanningAutomation } from "../../packages/shared/src/planning-automation-api";
import { runWorkerQueues } from "../../packages/shared/src/worker-scheduler";
import { retireStorageClient } from "../../packages/shared/src/storage-client";
import { startWorkerHeartbeat } from "./worker-health";

let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
const once = process.argv.includes("--once");
if (process.argv.includes("--check")) {
  // All static imports above have resolved. Image-build checks supply only
  // credential-free build placeholders, and never dispatch or touch a dataset.
  retireStorageClient();
  await pool.end();
  console.log("Workspace worker runtime imports are available.");
} else {
  console.log("Axiom workspace worker started.");
  const stopHeartbeat = once ? async () => {} : await startWorkerHeartbeat();
  let maintenanceDelay = 60_000;
  try {
    await runWorkerQueues(
      [
        {
          name: "maintenance",
          lane: "io",
          participatesInDrain: false,
          get idleDelayMs() {
            return maintenanceDelay;
          },
          async run() {
            try {
              await workspaceMaintenance();
              await analyticsMaintenance();
              maintenanceDelay = 60_000;
            } catch (error) {
              console.error(
                "Workspace maintenance:",
                error instanceof Error ? error.message : "failed",
              );
              // Other queues must remain available if periodic maintenance fails.
              maintenanceDelay = 10_000;
            }
            return false;
          },
        },
        { name: "workspace", lane: "io", run: processWorkspaceJob },
        { name: "tools", lane: "io", run: processToolJob },
        {
          name: "changes",
          lane: "local",
          run: () => processChangeSet(executeReviewedAction),
        },
        { name: "sites", lane: "io", run: processSiteRelease },
        { name: "research", lane: "local", run: backfillResearchIndex },
        { name: "planning", lane: "local", run: processPlanningAutomation },
      ],
      { concurrency: 2, once, shouldStop: () => stopping },
    );
  } finally {
    await stopHeartbeat();
    retireStorageClient();
    await query("SELECT 1").catch(() => {});
    await pool.end();
  }
}

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

let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
const once = process.argv.includes("--once");
console.log("Axiom workspace worker started.");
let lastMaintenance = 0;
try {
  do {
    if (Date.now() - lastMaintenance > 60_000) {
      try {
        await workspaceMaintenance();
        await analyticsMaintenance();
        lastMaintenance = Date.now();
      } catch (error) {
        console.error(
          "Workspace maintenance:",
          error instanceof Error ? error.message : "failed",
        );
        lastMaintenance = Date.now() - 50_000;
      }
    }
    const workspaceWorked = await processWorkspaceJob();
    const toolsWorked = await processToolJob();
    const changesWorked = await processChangeSet(executeReviewedAction);
    const siteWorked = await processSiteRelease();
    const researchWorked = await backfillResearchIndex();
    const planningWorked = await processPlanningAutomation();
    const worked =
      workspaceWorked ||
      toolsWorked ||
      changesWorked ||
      siteWorked ||
      researchWorked || planningWorked;
    if (once && !worked) break;
    if (!worked) await new Promise((resolve) => setTimeout(resolve, 1000));
  } while (!stopping);
} finally {
  await query("SELECT 1").catch(() => {});
  await pool.end();
}

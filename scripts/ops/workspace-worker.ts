import "dotenv/config";
import { pool, query } from "../../packages/shared/src/db";
import {
  processWorkspaceJob,
  workspaceMaintenance,
} from "../../packages/shared/src/workspace-jobs";
import { processToolJob } from "../../packages/shared/src/tool-jobs";

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
    const worked = workspaceWorked || toolsWorked;
    if (once && !worked) break;
    if (!worked) await new Promise((resolve) => setTimeout(resolve, 1000));
  } while (!stopping);
} finally {
  await query("SELECT 1").catch(() => {});
  await pool.end();
}

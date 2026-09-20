import "dotenv/config";
import { processPdfOcrJob } from "../../packages/shared/src/pdf-ocr-worker";
import { pool } from "../../packages/shared/src/db";
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
console.log("Axiom private PDF OCR worker started.");
try {
  do {
    const worked = await processPdfOcrJob();
    if (process.argv.includes("--once")) break;
    if (!worked) await new Promise((resolve) => setTimeout(resolve, 1000));
  } while (!stopping);
} finally {
  await pool.end();
}

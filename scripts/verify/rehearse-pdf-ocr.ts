/** Isolated transport/queue/ACL rehearsal; not a recognition-accuracy test. */
import "dotenv/config";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const target = new URL(process.env.DATABASE_URL ?? "");
const database =
  process.env.AXIOM_STAGING_DATABASE ?? "axiom_workspace_test_20260920";
if (
  !["localhost", "127.0.0.1"].includes(target.hostname) ||
  !/^axiom_[a-z0-9_]*test[a-z0-9_]*$/.test(database) ||
  target.pathname.slice(1) === database
)
  throw new Error("Use a separate local test database.");
target.pathname = `/${database}`;
process.env.DATABASE_URL = target.href;
process.env.STORAGE_PATH = resolve("data/release-test-attachments");
process.env.STORAGE_DRIVER = "local";
const { query, pool } = await import("../../packages/shared/src/db");
const { pdfOcrApi } = await import("../../packages/shared/src/pdf-ocr-api");
const { processPdfOcrJob } =
  await import("../../packages/shared/src/pdf-ocr-worker");
const { getAttachment } = await import("../../packages/shared/src/storage");
const [source] = await query(
  "SELECT a.*,r.owner_id FROM attachments a JOIN file_versions v ON v.id=a.id JOIN resources r ON r.id=v.resource_id WHERE a.mime='application/pdf' AND r.name='workbench-paper.pdf' AND r.deleted_at IS NULL ORDER BY a.created_at DESC LIMIT 1",
);
if (!source) throw new Error("Run pdf-workbench browser fixtures first.");
const original = await getAttachment(source.storage_key),
  calls: string[] = [];
const server = createServer(async (req, res) => {
  for await (const _chunk of req) {
    /* drain bounded fixture input */
  }
  const mode = String(req.headers["x-ocr-mode"]),
    page = String(req.headers["x-ocr-pages"]);
  calls.push(`${mode}:${page}`);
  if (mode === "pdf") {
    res.setHeader("Content-Type", "application/pdf");
    res.end(original);
  } else
    res.end(JSON.stringify({ text: `Recognized page ${page}`, native: false }));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string")
  throw new Error("Test listener unavailable.");
process.env.PDF_OCR_URL = `http://127.0.0.1:${address.port}`;
process.env.PDF_OCR_TOKEN = "isolated-fixture-not-a-production-secret";
const id = randomUUID(),
  user = source.owner_id as string;
const req = (path: string, method = "GET", body?: unknown) =>
  pdfOcrApi(
    new Request(`http://localhost:3004/api/v1/${path}`, {
      method,
      ...(body === undefined
        ? {}
        : {
            body: JSON.stringify(body),
            headers: { "content-type": "application/json" },
          }),
    }),
    path.split("/"),
    user,
  );
try {
  const input = {
    id,
    versionId: source.id,
    settings: { pages: [1, 2], language: "eng", searchable: true },
    consent: true,
  };
  assert.equal((await req("pdf-ocr", "POST", input))!.status, 202);
  assert.equal((await req("pdf-ocr", "POST", input))!.status, 202);
  await processPdfOcrJob();
  let result = await (await req(`pdf-ocr/${id}`))!.json();
  assert.equal(result.pages.length, 1);
  await req(`pdf-ocr/${id}/cancel`, "POST", {});
  assert.equal(await processPdfOcrJob(), false);
  await req(`pdf-ocr/${id}/retry`, "POST", {});
  await processPdfOcrJob();
  await processPdfOcrJob();
  result = await (await req(`pdf-ocr/${id}`))!.json();
  assert.equal(result.status, "complete");
  assert.equal(result.pages.length, 2);
  assert.deepEqual(calls, ["text:1", "text:2", "pdf:1,2"]);
  const review = {
    page: 1,
    version: 1,
    text: "Reviewed source",
    reviewed: true,
  };
  assert.equal(
    (await req(`pdf-ocr/${id}/pages`, "PATCH", review))!.status,
    200,
  );
  await assert.rejects(
    () => req(`pdf-ocr/${id}/pages`, "PATCH", review),
    /review changed/,
  );
  await assert.rejects(
    () =>
      pdfOcrApi(
        new Request(`http://localhost:3004/api/v1/pdf-ocr/${id}`),
        ["pdf-ocr", id],
        "unrelated-user",
      ),
    /unavailable/,
  );
  assert.deepEqual(await getAttachment(source.storage_key), original);
  assert.equal((await req(`pdf-ocr/${id}/pdf`))!.status, 200);
  await req(`pdf-ocr/${id}`, "DELETE");
  assert.equal(
    (await query("SELECT cleared_at FROM pdf_ocr_jobs WHERE id=$1", [id]))[0]
      .cleared_at instanceof Date,
    true,
  );
  console.log(
    "PASS: private OCR queue, idempotency, page checkpoint, cancellation/resume, output, review conflicts and ownership. Recognition was mocked.",
  );
} finally {
  await query("DELETE FROM pdf_ocr_jobs WHERE id=$1", [id]);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
}

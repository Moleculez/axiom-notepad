import { randomUUID, createHash } from "node:crypto";
import { pool, query, transaction } from "./db";
import { fileAccess } from "./access";
import { requireScope } from "./workspace-service";
import { getAttachment, putAttachment, removeAttachment } from "./storage";
import { reserveCapacity } from "./uploads-api";
import { pdfOcrSettingsSchema, type PdfOcrJob } from "./pdf-ocr";
import { z } from "zod";

async function readBounded(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("OCR returned an empty response.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      length += r.value.length;
      if (length > limit) {
        await reader.cancel();
        throw new Error("OCR output exceeds its size limit.");
      }
      chunks.push(r.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
export async function processPdfOcrJob() {
  if (!process.env.PDF_OCR_URL || !process.env.PDF_OCR_TOKEN) return false;
  const lock = await pool.connect();
  let locked = false;
  try {
    locked = (
      await lock.query(
        "SELECT pg_try_advisory_lock(hashtext('axiom:pdf-ocr-worker')) AS locked",
      )
    ).rows[0].locked;
    if (!locked) return false;
    await query("DELETE FROM pdf_ocr_jobs WHERE expires_at<now()");
    await query(
      "UPDATE pdf_ocr_jobs SET status='queued',lease_until=NULL WHERE status='running' AND lease_until<now()",
    );
    const [job] = await query<PdfOcrJob>(
      "UPDATE pdf_ocr_jobs SET status='running',lease_until=now()+interval '90 seconds',updated_at=now() WHERE id=(SELECT id FROM pdf_ocr_jobs WHERE status='queued' AND cleared_at IS NULL AND expires_at>now() ORDER BY created_at LIMIT 1) RETURNING *",
    );
    if (!job) return false;
    const controller = new AbortController();
    const poll = setInterval(() => {
      void query(
        "UPDATE pdf_ocr_jobs SET lease_until=now()+interval '90 seconds' WHERE id=$1 AND status='running' RETURNING id",
        [job.id],
      )
        .then((rows) => {
          if (!rows.length) controller.abort();
        })
        .catch(() => controller.abort());
    }, 1500);
    let outputKey: string | null = null,
      saved = false;
    try {
      const settings = pdfOcrSettingsSchema.parse(job.settings),
        {
          file,
          space,
          resource: sourceResource,
        } = await fileAccess(job.owner_id, job.version_id);
      if (sourceResource.deleted_at)
        throw new Error(
          "The source PDF is in Trash. Restore it before retrying OCR.",
        );
      if (
        file.mime !== "application/pdf" ||
        Number(file.bytes) > 100 * 1024 * 1024
      )
        throw new Error("Source PDF is unsupported or exceeds 100 MiB.");
      const finished = await query<{ page: number }>(
        "SELECT page FROM pdf_ocr_pages WHERE job_id=$1",
        [job.id],
      );
      const page = settings.pages.find(
        (p) => !finished.some((f) => f.page === p),
      );
      const searchable =
        page === undefined && settings.searchable && !job.output_key;
      if (page === undefined && !searchable) {
        await query(
          "UPDATE pdf_ocr_jobs SET status='complete',updated_at=now() WHERE id=$1 AND status='running'",
          [job.id],
        );
        return true;
      }
      const endpoint = new URL(
        searchable || !settings.research
          ? process.env.PDF_OCR_URL!
          : process.env.PDF_RESEARCH_OCR_URL!,
      );
      if (
        !["http:", "https:"].includes(endpoint.protocol) ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash
      )
        throw new Error("Invalid operator-configured OCR endpoint.");
      const response = await fetch(new URL("/process", endpoint), {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(searchable ? 3_600_000 : 300_000),
        ]),
        headers: {
          "content-type": "application/pdf",
          authorization: `Bearer ${process.env.PDF_OCR_TOKEN}`,
          "x-ocr-mode": searchable
            ? "pdf"
            : settings.research
              ? "research"
              : "text",
          "x-ocr-pages": (searchable ? settings.pages : [page!]).join(","),
          "x-ocr-language": settings.language,
        },
        body: new Uint8Array(
          await getAttachment(file.storage_key),
        ) as Uint8Array<ArrayBuffer>,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(
          `Local OCR failed (${response.status}). Retry after checking the service; completed pages are retained.`,
        );
      }
      const bytes = await readBounded(
        response,
        searchable ? 200 * 1024 * 1024 : 500_000,
      );
      const result = searchable
        ? null
        : z
            .object({ text: z.string().max(100000), native: z.boolean() })
            .parse(JSON.parse(bytes.toString("utf8")));
      if (searchable && !bytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
        throw new Error("OCR did not produce a PDF.");
      if (searchable) {
        outputKey = randomUUID();
        await query(
          "INSERT INTO workspace_jobs(kind,dedupe_key,payload,available_at) VALUES('delete-blob',$1,$2,now()+interval '2 hours')",
          [`pdf-ocr-orphan:${outputKey}`, { key: outputKey }],
        );
      }
      await transaction(async (client) => {
        await requireScope(client, job.owner_id, space.id, "read");
        const {
          rows: [resource],
        } = await client.query(
          "SELECT id FROM resources WHERE id=$1 AND space_id=$2 AND deleted_at IS NULL FOR SHARE",
          [file.resource_id, space.id],
        );
        const {
          rows: [current],
        } = await client.query(
          "SELECT * FROM pdf_ocr_jobs WHERE id=$1 FOR UPDATE",
          [job.id],
        );
        if (
          !resource ||
          current?.status !== "running" ||
          current.cleared_at ||
          controller.signal.aborted
        )
          throw new Error("OCR was cancelled or source access changed.");
        const length = searchable
          ? bytes.length
          : Buffer.byteLength(result!.text);
        if (!searchable) {
          const {
            rows: [total],
          } = await client.query(
            "SELECT coalesce(sum(octet_length(text)),0) AS bytes FROM pdf_ocr_pages WHERE job_id=$1",
            [job.id],
          );
          if (
            Number(total.bytes) + length > 8_000_000 ||
            Number(current.text_bytes) + length > 16_000_000
          )
            throw new Error(
              "This batch exceeds its 8 MB extraction or 16 MB combined review limit. Use smaller page ranges.",
            );
        }
        await reserveCapacity(client, space.id, length);
        if (searchable) {
          await putAttachment(outputKey!, bytes, "application/pdf");
          await client.query(
            "UPDATE pdf_ocr_jobs SET output_key=$2,output_bytes=$3,output_sha256=$4,status='complete',lease_until=NULL,error=NULL,updated_at=now() WHERE id=$1",
            [
              job.id,
              outputKey,
              bytes.length,
              createHash("sha256").update(bytes).digest("hex"),
            ],
          );
        } else {
          await client.query(
            "INSERT INTO pdf_ocr_pages(job_id,page,text,native) VALUES($1,$2,$3,$4)",
            [job.id, page, result!.text, result!.native],
          );
          await client.query(
            "UPDATE pdf_ocr_jobs SET text_bytes=text_bytes+$2,status='queued',lease_until=NULL,error=NULL,updated_at=now() WHERE id=$1",
            [job.id, length],
          );
        }
      });
      saved = true;
    } catch (e) {
      await query(
        "UPDATE pdf_ocr_jobs SET status='failed',lease_until=NULL,error=$2,updated_at=now() WHERE id=$1 AND status='running'",
        [
          job.id,
          (e instanceof Error ? e.message : "OCR stopped.").slice(0, 500),
        ],
      );
    } finally {
      clearInterval(poll);
      if (outputKey && !saved)
        await removeAttachment(outputKey).catch(() => {});
    }
    return true;
  } finally {
    if (locked)
      await lock.query(
        "SELECT pg_advisory_unlock(hashtext('axiom:pdf-ocr-worker'))",
      );
    lock.release();
  }
}

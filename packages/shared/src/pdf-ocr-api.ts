import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { query, transaction } from "./db";
import { fileAccess, HttpError } from "./access";
import { requireScope, workspaceJson as json } from "./workspace-service";
import { pdfOcrSettingsSchema, type PdfOcrJob } from "./pdf-ocr";
import { PDF_EDIT_MAX_BYTES } from "./pdf-reader";
import { fileResponse } from "./storage-streams";
import { reserveCapacity } from "./uploads-api";

export async function pdfOcrApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  if (path[0] !== "pdf-ocr") return null;
  const [, id, action] = path,
    method = request.method,
    url = new URL(request.url);
  if (id === "capabilities" && method === "GET")
    return json({
      available: !!(process.env.PDF_OCR_URL && process.env.PDF_OCR_TOKEN),
      research: !!process.env.PDF_RESEARCH_OCR_URL,
      languages: ["eng", "chi_sim", "eng+chi_sim", "deu", "fra", "spa"],
    });
  if (!id && method === "POST") {
    if (!process.env.PDF_OCR_URL || !process.env.PDF_OCR_TOKEN)
      throw new HttpError(
        503,
        "Self-hosted OCR is not configured. Ask an administrator to enable the OCR services.",
      );
    const input = z
      .object({
        id: z.uuid(),
        versionId: z.uuid(),
        settings: pdfOcrSettingsSchema,
        consent: z.literal(true),
      })
      .strict()
      .parse(await request.json());
    if (input.settings.research && !process.env.PDF_RESEARCH_OCR_URL)
      throw new HttpError(503, "Equation-aware OCR is not configured.");
    const { file, space, resource } = await fileAccess(userId, input.versionId);
    if (
      file.mime !== "application/pdf" ||
      Number(file.bytes) > PDF_EDIT_MAX_BYTES
    )
      throw new HttpError(413, "Choose a PDF no larger than 100 MiB.");
    const result = await transaction(async (client) => {
      await requireScope(client, userId, space.id, "read");
      const { rows: available } = await client.query(
        "SELECT id FROM resources WHERE id=$1 AND space_id=$2 AND deleted_at IS NULL FOR SHARE",
        [resource.id, space.id],
      );
      if (!available.length)
        throw new HttpError(
          409,
          "The source PDF moved or was removed. Reopen it before starting OCR.",
        );
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `pdf-ocr:${userId}`,
      ]);
      const {
        rows: [existing],
      } = await client.query("SELECT * FROM pdf_ocr_jobs WHERE id=$1", [
        input.id,
      ]);
      if (existing) {
        if (
          existing.owner_id !== userId ||
          existing.version_id !== input.versionId ||
          !isDeepStrictEqual(existing.settings, input.settings)
        )
          throw new HttpError(409, "This OCR request ID is already in use.");
        if (
          existing.cleared_at ||
          new Date(existing.expires_at).getTime() <= Date.now()
        )
          throw new HttpError(
            409,
            "This OCR request was cleared or expired. Start a new request.",
          );
        return { id: existing.id, status: existing.status };
      }
      const {
        rows: [limit],
      } = await client.query(
        "SELECT count(*) FILTER(WHERE status IN ('queued','running'))::int AS pending,count(*)::int AS today FROM pdf_ocr_jobs WHERE owner_id=$1 AND created_at>now()-interval '1 day'",
        [userId],
      );
      if (limit.pending >= 2 || limit.today >= 20)
        throw new HttpError(
          429,
          "OCR allows two pending jobs and 20 submissions per day per account.",
        );
      const {
        rows: [job],
      } = await client.query(
        "INSERT INTO pdf_ocr_jobs(id,owner_id,version_id,settings) VALUES($1,$2,$3,$4) RETURNING id,status",
        [input.id, userId, input.versionId, input.settings],
      );
      return job;
    });
    return json(result, 202);
  }
  if (!id && method === "GET") {
    const version = z.uuid().parse(url.searchParams.get("version"));
    await fileAccess(userId, version);
    return json(
      await query(
        "SELECT id,status,error,settings,created_at,expires_at,output_bytes,version_id,(SELECT count(*)::int FROM pdf_ocr_pages p WHERE p.job_id=j.id) AS completed_pages FROM pdf_ocr_jobs j WHERE owner_id=$1 AND version_id=$2 AND cleared_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 30",
        [userId, version],
      ),
    );
  }
  z.uuid().parse(id);
  const [job] = await query<PdfOcrJob>(
    "SELECT * FROM pdf_ocr_jobs WHERE id=$1 AND owner_id=$2 AND cleared_at IS NULL AND expires_at>now()",
    [id, userId],
  );
  if (!job) throw new HttpError(404, "OCR job unavailable.");
  const { file, space, resource } = await fileAccess(userId, job.version_id);
  if (action === "pdf" && ["GET", "HEAD"].includes(method)) {
    if (!job.output_key || !job.output_sha256)
      throw new HttpError(404, "Searchable PDF is not ready.");
    return fileResponse(
      request,
      {
        storage_key: job.output_key,
        sha256: job.output_sha256,
        bytes: Number(job.output_bytes),
        mime: "application/pdf",
        name: file.name.replace(/\.pdf$/i, "") + "-searchable.pdf",
      },
      true,
    );
  }
  if (!action && method === "GET")
    return json({
      ...job,
      output_key: undefined,
      pages: await query(
        "SELECT page,text,reviewed_text,reviewed,native,version FROM pdf_ocr_pages WHERE job_id=$1 ORDER BY page",
        [id],
      ),
    });
  if (method === "DELETE") {
    // Keep the job receipt until retention expiry, so deletion cannot bypass rate limits.
    await query(
      "UPDATE pdf_ocr_jobs SET status='cancelled',cleared_at=now(),error='Private history removed.',updated_at=now() WHERE id=$1 AND owner_id=$2",
      [id, userId],
    );
    await transaction(async (client) => {
      const {
        rows: [current],
      } = await client.query(
        "SELECT * FROM pdf_ocr_jobs WHERE id=$1 FOR UPDATE",
        [id],
      );
      await client.query("DELETE FROM pdf_ocr_pages WHERE job_id=$1", [id]);
      if (current.output_key)
        await client.query(
          "INSERT INTO workspace_jobs(kind,dedupe_key,payload) VALUES('delete-blob',$1,$2) ON CONFLICT(dedupe_key) DO NOTHING",
          [`pdf-ocr-clear:${id}`, { key: current.output_key }],
        );
      await client.query(
        "UPDATE pdf_ocr_jobs SET output_key=NULL,output_bytes=0,output_sha256=NULL,text_bytes=0 WHERE id=$1",
        [id],
      );
    });
    return json({ ok: true });
  }
  if (method === "POST" && ["cancel", "retry"].includes(action)) {
    const result = await query(
      "UPDATE pdf_ocr_jobs SET status=$3,error=NULL,updated_at=now() WHERE id=$1 AND owner_id=$2 AND cleared_at IS NULL AND expires_at>now() AND status=ANY($4::text[]) RETURNING id,status",
      [
        id,
        userId,
        action === "cancel" ? "cancelled" : "queued",
        action === "cancel" ? ["queued", "running"] : ["failed", "cancelled"],
      ],
    );
    if (!result.length)
      throw new HttpError(409, "OCR status changed. Refresh the job.");
    return json(result[0]);
  }
  if (method === "PATCH" && action === "pages") {
    const input = z
      .object({
        page: z.number().int().min(1).max(2000),
        version: z.number().int().positive(),
        text: z.string().max(100000),
        reviewed: z.boolean(),
      })
      .strict()
      .parse(await request.json());
    const result = await transaction(async (client) => {
      await requireScope(client, userId, space.id, "read");
      const { rows: available } = await client.query(
        "SELECT id FROM resources WHERE id=$1 AND space_id=$2 AND deleted_at IS NULL FOR SHARE",
        [resource.id, space.id],
      );
      if (!available.length)
        throw new HttpError(
          409,
          "The source PDF moved or was removed. Reopen it before reviewing OCR.",
        );
      const {
        rows: [current],
      } = await client.query(
        "SELECT text_bytes FROM pdf_ocr_jobs WHERE id=$1 AND cleared_at IS NULL AND expires_at>now() FOR UPDATE",
        [id],
      );
      if (!current) throw new HttpError(404, "OCR job unavailable.");
      const {
        rows: [old],
      } = await client.query(
        "SELECT * FROM pdf_ocr_pages WHERE job_id=$1 AND page=$2 FOR UPDATE",
        [id, input.page],
      );
      if (!old || old.version !== input.version)
        throw new HttpError(
          409,
          "The OCR review changed. Your text is retained; reload before saving.",
        );
      const delta =
        Buffer.byteLength(input.text) -
        Buffer.byteLength(old.reviewed_text ?? "");
      if (Number(current.text_bytes) + delta > 16_000_000)
        throw new HttpError(
          413,
          "OCR research text and corrections are limited to 16 MB per job.",
        );
      if (delta > 0) await reserveCapacity(client, space.id, delta, false);
      const {
        rows: [row],
      } = await client.query(
        "UPDATE pdf_ocr_pages SET reviewed_text=$3,reviewed=$4,version=version+1 WHERE job_id=$1 AND page=$2 RETURNING *",
        [id, input.page, input.text, input.reviewed],
      );
      await client.query(
        "UPDATE pdf_ocr_jobs SET text_bytes=text_bytes+$2,updated_at=now() WHERE id=$1",
        [id, delta],
      );
      return row;
    });
    return json(result);
  }
  throw new HttpError(405, "Method not allowed.");
}

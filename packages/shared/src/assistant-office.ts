import { z } from "zod";
import { createHash } from "node:crypto";
import { query, transaction } from "./db";
import { fileAccess, HttpError } from "./access";
import { requireScope, workspaceJson as json } from "./workspace-service";
import { getAttachment } from "./storage";
import { readOffice } from "./office-parse";
import { readWorkbook } from "./workbook-parse";
import { cellAddress } from "./workbook-preview";
import { officeBlockText } from "./office-preview";
export type OfficeExcerptSource = {
  source: string;
  locators: { from: number; to: number; label: string; target: string }[];
  format: string;
  warnings: string[];
};
export async function extractOfficeSource(
  bytes: ArrayBuffer,
  format: "docx" | "pptx" | "xlsx",
): Promise<OfficeExcerptSource> {
  const result: OfficeExcerptSource = {
    source: "",
    locators: [],
    format,
    warnings: [],
  };
  const append = (text: string, label: string, target: string) => {
    const from = result.source.length;
    result.source += `${label}\n${text}\n\n`;
    if (result.source.length > 500000)
      throw new Error(
        "Office extraction exceeds 500,000 characters. Export a smaller document or worksheet; nothing was truncated.",
      );
    result.locators.push({ from, to: result.source.length, label, target });
  };
  if (format === "xlsx") {
    const book = await readWorkbook(bytes);
    result.warnings = book.warnings;
    if (
      book.sheets.some((s) => s.truncated) ||
      book.warnings.some((w) => /first 100/.test(w))
    )
      throw new Error(
        "This workbook exceeds complete extraction limits. Export a smaller worksheet; no partial evidence was produced.",
      );
    for (const sheet of book.sheets)
      sheet.rows.forEach((row, r) => {
        const cells = row
          .map((c, i) => ({ ...c, address: cellAddress(r, i) }))
          .filter((c) => c.text || c.formula);
        if (cells.length)
          append(
            cells
              .map(
                (c) =>
                  `${c.address}: ${c.text}${c.formula ? ` (saved formula: ${c.formula}; not recalculated)` : ""}`,
              )
              .join("\n"),
            sheet.name,
            `${sheet.name}!${cells[0].address}`,
          );
      });
  } else {
    const doc = await readOffice(bytes, format);
    result.warnings = doc.warnings;
    if (format === "docx")
      for (const b of doc.blocks)
        append(
          officeBlockText(b),
          b.kind === "paragraph" && b.heading
            ? `Heading ${b.heading}`
            : "Document block",
          b.id,
        );
    else
      doc.slides.forEach((slide, i) =>
        append(
          `${slide.blocks.map(officeBlockText).join("\n\n")}\nSpeaker notes:\n${slide.notes}`,
          `Slide ${i + 1}: ${slide.title}`,
          String(i + 1),
        ),
      );
  }
  if (!result.source.trim())
    throw new Error("This file contains no readable text.");
  return result;
}
export async function assistantOfficeApi(
  request: Request,
  path: string[],
  user: string,
): Promise<Response | null> {
  if (path[0] !== "assistant" || path[1] !== "extractions") return null;
  if (request.method === "POST") {
    const input = z
      .object({
        id: z.uuid(),
        versionId: z.uuid(),
        format: z.enum(["docx", "pptx", "xlsx"]),
      })
      .strict()
      .parse(await request.json());
    const { file, resource, space } = await fileAccess(user, input.versionId);
    if (resource.deleted_at) throw new HttpError(404, "File unavailable.");
    if (Number(file.bytes) > (input.format === "xlsx" ? 25000000 : 50000000))
      throw new HttpError(413, "The file exceeds the Office reading limit.");
    return json(
      await transaction(async (db) => {
        await requireScope(db, user, space.id);
        await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          "assistant-previews:" + user,
        ]);
        const {
          rows: [old],
        } = await db.query(
          "SELECT * FROM tool_jobs WHERE id=$1 AND owner_id=$2",
          [input.id, user],
        );
        if (old) {
          if (
            old.kind !== "assistant-evidence" ||
            old.version_id !== file.id ||
            old.input.format !== input.format
          )
            throw new HttpError(
              409,
              "This extraction request belongs to a different file.",
            );
          return { id: old.id, status: old.status };
        }
        const {
          rows: [count],
        } = await db.query(
          "SELECT count(*)::int AS n,count(*) FILTER(WHERE status IN ('queued','running'))::int AS pending FROM tool_jobs WHERE owner_id=$1 AND created_at>now()-interval '1 day'",
          [user],
        );
        if (count.pending >= 5 || count.n >= 100)
          throw new HttpError(
            429,
            "Wait for a current job or the daily extraction budget before extracting more evidence.",
          );
        await db.query(
          "INSERT INTO tool_jobs(id,resource_id,version_id,owner_id,kind,input) VALUES($1,$2,$3,$4,'assistant-evidence',$5)",
          [
            input.id,
            resource.id,
            file.id,
            user,
            { format: input.format, spaceId: space.id },
          ],
        );
        return { id: input.id, status: "queued" };
      }),
      201,
    );
  }
  const id = z.uuid().parse(path[2]),
    [job] = await query(
      "SELECT * FROM tool_jobs WHERE id=$1 AND owner_id=$2 AND kind='assistant-evidence' AND created_at>now()-interval '1 day'",
      [id, user],
    );
  if (!job) throw new HttpError(404, "Extraction expired or unavailable.");
  const { resource, space } = await fileAccess(user, job.version_id);
  if (resource.deleted_at || space.id !== job.input.spaceId)
    throw new HttpError(404, "Source moved or is unavailable.");
  if (request.method === "DELETE") {
    await query(
      "UPDATE tool_jobs SET status='cancelled',result=NULL,updated_at=now() WHERE id=$1",
      [id],
    );
    return json({ ok: true });
  }
  if (request.method !== "GET")
    throw new HttpError(405, "Unsupported extraction action.");
  return json({
    id: job.id,
    status: job.status,
    result: job.result,
    error: job.error,
  });
}
export async function executeOfficeEvidence(
  job: Record<string, any>,
  signal: AbortSignal,
) {
  const { file, resource, space } = await fileAccess(
    job.owner_id,
    job.version_id,
  );
  if (resource.deleted_at || space.id !== job.input.spaceId)
    throw new Error("Evidence source moved or is unavailable.");
  const bytes = await getAttachment(file.storage_key);
  if (bytes.length > 50000000)
    throw new Error("Office file exceeds extraction limit.");
  if (createHash("sha256").update(bytes).digest("hex") !== file.sha256)
    throw new Error("Source checksum mismatch.");
  const result = await extractOfficeSource(
    Uint8Array.from(bytes).buffer,
    job.input.format,
  );
  if (signal.aborted) return;
  await transaction(async (db) => {
    await requireScope(db, job.owner_id, space.id);
    const {
      rows: [r],
    } = await db.query(
      "SELECT space_id,deleted_at FROM resources WHERE id=$1 FOR SHARE",
      [resource.id],
    );
    if (!r || r.deleted_at || r.space_id !== space.id)
      throw new Error("Evidence source changed during extraction.");
    await db.query(
      "UPDATE tool_jobs SET status='complete',result=$2,updated_at=now() WHERE id=$1 AND status='running'",
      [job.id, result],
    );
  });
}

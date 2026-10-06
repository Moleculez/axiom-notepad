import { documentExportRequestSchema } from "./document-export";
import { renderHtmlExport } from "./html-export";
import { HttpError, fileAccess, noteAccess } from "./access";
import { query } from "./db";
import { getAttachment, attachmentMime } from "./storage";
import { appUrl } from "./auth";
import { MathExportLimitError } from "../../markdown/src/math-server";
import { z } from "zod";
import { latexOptionsSchema } from "./latex-export";
import { prepareLatexExport } from "./latex-export-api";

/** Read-authorized, non-persisting preview. The regular API origin check still
 * applies to this POST; accepting a snapshot must never imply edit authority. */
export async function documentExportPreview(
  request: Request,
  userId: string,
  id: string,
) {
  const input = documentExportRequestSchema
    .extend({
      latex: z
        .object({
          options: latexOptionsSchema,
          fingerprint: z.string().regex(/^[a-f\d]{64}$/),
        })
        .strict()
        .optional(),
    })
    .parse(await request.json());
  const check = async () => {
    const note = await noteAccess(userId, id);
    if (note.source_format && note.source_format !== "markdown")
      throw new HttpError(400, "Use this document's studio export.");
    if (note.generation !== input.snapshot.generation)
      throw new HttpError(
        409,
        "This document was restored or replaced. Reopen the export preview.",
      );
    return note;
  };
  const note = await check();
  const manuscript = input.latex
    ? await prepareLatexExport(userId, id, input.snapshot, input.latex.options)
    : null;
  if (manuscript && manuscript.fingerprint !== input.latex?.fingerprint)
    throw new HttpError(
      409,
      "Paper dependencies changed. Refresh the project review.",
    );
  const references = Object.fromEntries(
    (
      manuscript?.references ??
      (await query("SELECT * FROM axiom_note_bibliography($1)", [id]))
    ).map((r) => [r.cite_key, r]),
  );
  const targets = await query(
    "SELECT id,title FROM notes WHERE group_id=$1 AND deleted_at IS NULL AND axiom_can_read_note($2,id)",
    [note.group_id, userId],
  );
  const included = new Set<string>();
  let imageBytes = 0;
  const result = await renderHtmlExport(
    input.snapshot.source,
    input.snapshot.title,
    {
      references,
      resolveLink: (target) => {
        const [name, heading] = target.split("#");
        const linked = targets.find(
          (n) => n.id === name || n.title.toLowerCase() === name.toLowerCase(),
        );
        return linked
          ? {
              title: linked.title,
              href: `${appUrl}/workbench/notes/${linked.id}${heading ? "#" + encodeURIComponent(heading) : ""}`,
            }
          : undefined;
      },
    },
    async (attachmentId) => {
      try {
        await fileAccess(userId, attachmentId);
      } catch (error) {
        if (error instanceof HttpError && [403, 404].includes(error.status))
          return undefined;
        throw error;
      }
      const [file] = await query(
        "SELECT storage_key,bytes FROM attachments WHERE id=$1",
        [attachmentId],
      );
      if (!file) return undefined;
      if (Number(file.bytes) > 20 * 1024 * 1024)
        throw new HttpError(
          413,
          "An image exceeds the 20 MB export limit. Use Markdown + assets instead.",
        );
      const data = await getAttachment(file.storage_key);
      const mime = attachmentMime(data);
      if (/^image\/(png|jpeg|gif|webp)$/.test(mime)) {
        imageBytes += data.byteLength;
        if (imageBytes > 20 * 1024 * 1024)
          throw new HttpError(
            413,
            "The images exceed the 20 MB export limit. Use Markdown + assets instead.",
          );
      }
      included.add(attachmentId);
      return { mime, data };
    },
    input.preferences,
    input.options,
    appUrl,
  ).catch((error: unknown) => {
    if (error instanceof MathExportLimitError)
      throw new HttpError(error.status, error.message);
    throw error;
  });
  // Rendering and storage reads can take time. Revoked access must not leak a
  // prepared document or dependency after the initial authorization check.
  await check();
  for (const attachmentId of included) await fileAccess(userId, attachmentId);
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}

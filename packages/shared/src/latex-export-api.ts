import { createHash } from "node:crypto";
import type pg from "pg";
import { parseMarkdown } from "@axiom/markdown";
import { query } from "./db";
import { HttpError, noteAccess, fileAccess } from "./access";
import {
  markdownExportAssetIds,
  type MarkdownExportSnapshot,
} from "./document-export";
import { scanBibtex } from "./bibtex-model";
import {
  buildLatexProject,
  latexPreviewRequestSchema,
  type LatexOptions,
  type LatexPreview,
  type LatexReference,
  type LatexAsset,
} from "./latex-export";

export const exportHash = (value: unknown) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
export async function authorizeLatexDependencies(
  userId: string,
  preview: LatexPreview,
) {
  const note = await noteAccess(userId, preview.noteId);
  if (note.generation !== preview.generation)
    throw new HttpError(
      409,
      "The note was restored. Refresh the export snapshot.",
    );
  for (const asset of preview.assets) await fileAccess(userId, asset.id);
}

/** Resolve only parsed keys/dependencies. Never scan the entire library into a client response. */
export async function prepareLatexExport(
  userId: string,
  noteId: string,
  snapshot: MarkdownExportSnapshot,
  options: LatexOptions,
  client?: pg.PoolClient,
): Promise<LatexPreview> {
  const note = await noteAccess(userId, noteId);
  if (note.source_format && note.source_format !== "markdown")
    throw new HttpError(400, "LaTeX projects start from a Markdown note.");
  if (note.generation !== snapshot.generation)
    throw new HttpError(
      409,
      "The note was restored. Refresh the export snapshot.",
    );
  const read = async (sql: string, values: unknown[]) =>
    client ? (await client.query(sql, values)).rows : query(sql, values);
  const parsed = parseMarkdown(snapshot.source),
    wanted = new Set(parsed.citations),
    references: LatexReference[] = [],
    visited = new Set<string>();
  for (;;) {
    const next = [...wanted].filter((key) => !visited.has(key));
    if (!next.length) break;
    if (wanted.size > 1000)
      throw new HttpError(
        413,
        "Export up to 1,000 bibliography entries in one project.",
      );
    next.forEach((key) => visited.add(key));
    const rows = await read(
      "SELECT b.*,c.version,c.cite_key AS canonical_key,c.bibtex AS canonical_bibtex FROM axiom_note_bibliography($1) b LEFT JOIN bibliography c ON c.id=b.reference_id WHERE b.cite_key=ANY($2::text[]) AND (b.reference_id IS NULL OR c.deleted_at IS NULL)",
      [noteId, next],
    );
    for (const row of rows) {
      const reference: LatexReference = {
        ...row,
        bibtex: row.canonical_bibtex ?? row.bibtex,
        identity: row.reference_id ?? `note:${noteId}:${row.cite_key}`,
        version: row.version ?? 1,
      };
      delete (reference as unknown as Record<string, unknown>).canonical_bibtex;
      references.push(reference);
      if (reference.bibtex)
        try {
          const record = scanBibtex(reference.bibtex).records.find(
            (r) => r.key,
          );
          for (const name of ["crossref", "xdata"])
            (record?.fields[name]?.value ?? "")
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
              .forEach((key) => wanted.add(key));
        } catch {
          /* The project builder reports malformed records, preserving their source. */
        }
    }
  }
  const ids = markdownExportAssetIds(snapshot.source);
  if (ids.length > 1000)
    throw new HttpError(
      413,
      "Export up to 1,000 attached versions per manuscript.",
    );
  const rows = ids.length
    ? await read(
        "SELECT a.*,v.resource_id FROM attachments a JOIN file_versions v ON v.id=a.id JOIN resources r ON r.id=v.resource_id WHERE a.id=ANY($1::uuid[]) AND r.deleted_at IS NULL AND axiom_space_role($2,r.space_id) IS NOT NULL",
        [ids, userId],
      )
    : [];
  if (rows.length !== ids.length)
    throw new HttpError(
      403,
      "Some attached versions are unavailable. Remove their links or restore access before export.",
    );
  const assets: LatexAsset[] = rows
    .map((r) => {
      const extension = /\.([a-z\d]{1,10})$/i.exec(r.name)?.[1]?.toLowerCase();
      const originalPath = `assets/originals/${r.id}${extension ? "." + extension : ".bin"}`;
      const native = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "application/pdf": ".pdf",
      }[r.mime as string];
      const convert =
        ["image/webp", "image/gif", "image/svg+xml"].includes(r.mime) &&
        Number(r.bytes) <= 20 * 1024 * 1024;
      return {
        id: r.id,
        resourceId: r.resource_id,
        versionId: r.id,
        name: r.name,
        mime: r.mime,
        bytes: Number(r.bytes),
        sha256: r.sha256,
        originalPath,
        figurePath: native
          ? `figures/${r.id}${native}`
          : convert
            ? `figures/${r.id}.png`
            : undefined,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  references.sort((a, b) => a.cite_key.localeCompare(b.cite_key));
  const project = buildLatexProject(snapshot, options, references, assets);
  if (project.diagrams.length > 100)
    throw new HttpError(
      413,
      "Export up to 100 diagram blocks in one manuscript.",
    );
  for (const diagram of project.diagrams)
    diagram.sha256 = exportHash(diagram.source);
  const sourceHash = exportHash(snapshot.source);
  const fingerprint = exportHash({
    version: 1,
    noteId,
    snapshot,
    options,
    references,
    assets,
  });
  const result = {
    ...project,
    fingerprint,
    sourceHash,
    assets,
    references,
    noteId,
    generation: snapshot.generation,
  };
  await authorizeLatexDependencies(userId, result);
  return result;
}
export async function latexExportPreview(
  request: Request,
  userId: string,
  noteId: string,
) {
  const { snapshot, options } = latexPreviewRequestSchema.parse(
    await request.json(),
  );
  return Response.json(
    await prepareLatexExport(userId, noteId, snapshot, options),
    { headers: { "cache-control": "no-store" } },
  );
}

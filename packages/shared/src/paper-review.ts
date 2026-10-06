import { noteAccess, fileAccess, HttpError } from "./access";
import { readResourceRevision } from "./revision-api";
import { prepareLatexExport } from "./latex-export-api";
import {
  latexOptionsSchema,
  type LatexDiagnostic,
  type LatexPreview,
} from "./latex-export";
import type pg from "pg";
export type PaperReviewPreview = {
  fingerprint: string;
  sourceHash: string;
  referenceKeys: string[];
  assets: { id: string; name: string; sha256: string }[];
  diagnostics: LatexDiagnostic[];
};
export async function preparePaperReview(
  userId: string,
  resourceId: string,
  reference: string,
  client?: pg.PoolClient,
) {
  const revision = await readResourceRevision(userId, resourceId, reference);
  if (
    revision.kind !== "snapshot" ||
    revision.format !== "markdown" ||
    revision.body === null
  )
    throw new HttpError(
      400,
      "Choose a saved Markdown milestone for a paper review.",
    );
  const note = await noteAccess(userId, resourceId);
  return prepareLatexExport(
    userId,
    resourceId,
    {
      source: revision.body,
      title: revision.title,
      generation: note.generation,
    },
    latexOptionsSchema.parse({}),
    client,
  );
}
export const paperReviewSummary = (
  preview: LatexPreview,
): PaperReviewPreview => ({
  fingerprint: preview.fingerprint,
  sourceHash: preview.sourceHash,
  referenceKeys: preview.referenceKeys,
  assets: preview.assets.map((a) => ({
    id: a.id,
    name: a.name,
    sha256: a.sha256,
  })),
  diagnostics: preview.diagnostics,
});
// Listing queries must not transfer full frozen bibliography/source records.
export const paperReviewSummarySql = (alias: "q" | "v") =>
  `CASE WHEN ${alias}.paper_context IS NULL THEN NULL ELSE jsonb_build_object('version',1,'sourceHash',${alias}.paper_context->>'sourceHash','referenceCount',jsonb_array_length(${alias}.paper_context->'references'),'assetCount',jsonb_array_length(${alias}.paper_context->'assets')) END`;
export function reviewRecordSummary(row: Record<string, any>) {
  const context = row.paper_context;
  return {
    ...row,
    paper_context: context
      ? {
          version: 1,
          sourceHash: context.sourceHash,
          referenceCount: context.references?.length ?? 0,
          assetCount: context.assets?.length ?? 0,
        }
      : null,
  };
}
export async function safeReviewRecord(
  userId: string,
  row: Record<string, any>,
) {
  if (!row.paper_context) return row;
  for (const asset of row.paper_context.assets ?? [])
    try {
      await fileAccess(userId, asset.id);
    } catch (error) {
      if (error instanceof HttpError && [403, 404].includes(error.status))
        return { ...row, paper_context: { version: 1, unavailable: true } };
      throw error;
    }
  return row;
}

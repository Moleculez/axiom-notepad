import { z } from "zod";
import { transaction } from "./db";
import { HttpError, resourceAccess } from "./access";
import { requireScope } from "./workspace-service";
import {
  assistantScopes,
  assistantHash,
  captureAssistantEvidence,
} from "./assistant-service";
import { currentRevisionDoc } from "./revision-api";
import { documentSource } from "./document-format";
import { sourceHash } from "./document-commands";
import { agentReadSchema } from "./productivity";
import type { AssistantSelection } from "./assistant";

export const evidenceSearchSchema = z
  .object({
    q: z.string().max(200).default(""),
    limit: z.coerce.number().int().min(1).max(30).default(30),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
    cursor: z.string().max(1500).optional(),
  })
  .strict();
/** Search summaries are previews, not captured, citable source text. */
export async function searchAssistantEvidence(
  user: string,
  anchor: string,
  requested: string[],
  raw: unknown,
) {
  const input = evidenceSearchSchema.parse(raw);
  const scope = await assistantScopes(user, anchor, requested);
  const signature = assistantHash({ scope, q: input.q });
  let position: { updatedAt: string; id: string } | undefined;
  if (input.cursor) {
    try {
      const cursor = z
        .object({
          signature: z.string(),
          updatedAt: z.iso.datetime({ offset: true }),
          id: z.uuid(),
        })
        .strict()
        .parse(
          JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")),
        );
      if (cursor.signature !== signature) throw new Error("scope");
      position = cursor;
    } catch {
      throw new HttpError(
        400,
        "Search position belongs to another query or workspace scope.",
      );
    }
  }
  // %, _ and backslash are literal characters, not caller-controlled SQL wildcards.
  const pattern = "%" + input.q.replace(/[\\%_]/g, "\\$&") + "%";
  return transaction(async (db) => {
    await assistantScopes(user, anchor, scope, db);
    const { rows } = await db.query(
      `SELECT * FROM (
      SELECT r.id,r.space_id,r.name AS title,
       CASE WHEN n.source_format IN ('markdown','latex','text','canvas') THEN 'document' WHEN lower(a.name) ~ '[.](docx|pptx|xlsx)$' THEN 'office' ELSE 'pdf' END AS kind,
       left(coalesce(n.plain_text,r.description,''),220) AS excerpt,
       coalesce(n.source_format,substring(lower(a.name) from '[.]([^.]+)$')) AS format,
       r.current_version_id AS version_id,r.version,n.generation,
       to_char(r.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
      FROM resources r LEFT JOIN notes n ON n.id=r.note_id LEFT JOIN attachments a ON a.id=r.current_version_id
      WHERE r.space_id=ANY($1::uuid[]) AND r.deleted_at IS NULL
       AND (n.source_format IN ('markdown','latex','text','canvas') OR a.mime='application/pdf' OR lower(a.name) ~ '[.](docx|pptx|xlsx)$')
       AND (r.name ILIKE $2 OR n.plain_text ILIKE $2 OR r.description ILIKE $2)
      UNION ALL SELECT id,space_id,title,'task',left(body,220),NULL,NULL,version,NULL,
       to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
       FROM tasks WHERE space_id=ANY($1::uuid[]) AND deleted_at IS NULL AND (title ILIKE $2 OR body ILIKE $2)
     ) s WHERE ($3::timestamptz IS NULL OR (updated_at::timestamptz,id)<($3::timestamptz,$4::uuid))
     ORDER BY updated_at::timestamptz DESC,id DESC LIMIT $5 OFFSET $6`,
      [
        scope,
        pattern,
        position?.updatedAt ?? null,
        position?.id ?? null,
        input.limit + 1,
        position ? 0 : input.offset,
      ],
    );
    const items = rows.slice(0, input.limit),
      last = items.at(-1);
    return {
      items,
      nextOffset: rows.length > input.limit ? input.offset + input.limit : null,
      nextCursor:
        rows.length > input.limit && last
          ? Buffer.from(
              JSON.stringify({
                signature,
                updatedAt: last.updated_at,
                id: last.id,
              }),
            ).toString("base64url")
          : null,
      pagination: "live" as const,
      excerptKind: "summary-preview" as const,
    };
  });
}

export async function readAssistantEvidence(
  user: string,
  scope: string[],
  raw: unknown,
) {
  const read = agentReadSchema.parse(raw);
  if (read.kind === "search")
    return {
      output: await searchAssistantEvidence(user, scope[0], scope, {
        q: read.query,
        limit: 20,
      }),
      evidence: undefined,
    };
  const selections: AssistantSelection[] = [];
  if (read.kind === "planning") {
    if (!scope.includes(read.id))
      throw new HttpError(
        403,
        "Planning data is outside the selected workspaces.",
      );
    const taskIds =
      read.taskIds ??
      (await transaction(async (db) => {
        await requireScope(db, user, read.id);
        const { rows } = await db.query(
          "SELECT id FROM tasks WHERE space_id=$1 AND deleted_at IS NULL ORDER BY id LIMIT 101",
          [read.id],
        );
        if (rows.length > 100)
          throw new HttpError(
            413,
            "Select at most 100 planning tasks; nothing was truncated.",
          );
        return rows.map((t) => t.id as string);
      }));
    if (!taskIds.length)
      return {
        output: { message: "No planning tasks in this workspace." },
        evidence: undefined,
      };
    selections.push({ kind: "planning", id: read.id, taskIds });
  } else {
    const { resource } = await resourceAccess(user, read.id);
    if (!scope.includes(resource.space_id))
      throw new HttpError(403, "File is outside the selected workspaces.");
    if (!resource.note_id)
      throw new HttpError(
        400,
        "Select exact PDF/Office excerpts through Add evidence.",
      );
    const current = await currentRevisionDoc(resource.note_id);
    try {
      if (current.format === "canvas") {
        if (read.from !== undefined || read.to !== undefined)
          throw new HttpError(
            400,
            "Canvas evidence uses explicit card selections, not text character ranges.",
          );
        const source = documentSource(current.doc, current.format),
          canvas = JSON.parse(source);
        if (read.hash && read.hash !== sourceHash(source))
          throw new HttpError(
            409,
            "The Canvas changed. Capture its cards again.",
          );
        if (canvas.nodes.length > 50)
          throw new HttpError(
            413,
            "Select at most 50 Canvas cards through Add evidence.",
          );
        if (!canvas.nodes.length)
          return {
            output: { message: "This Canvas has no cards." },
            evidence: undefined,
          };
        selections.push({
          kind: "canvas",
          id: read.id,
          nodeIds: canvas.nodes.map((n: { id: string }) => n.id),
          hash: sourceHash(source),
        });
      } else
        selections.push({
          kind: "document",
          id: read.id,
          from: read.from,
          to: read.to,
          hash: read.hash,
          editable: false,
        });
    } finally {
      current.doc.destroy();
    }
  }
  const {
    evidence: [evidence],
  } = await captureAssistantEvidence(user, scope[0], selections, scope);
  if (evidence.source.length > 30000)
    throw new HttpError(
      413,
      "Select a shorter excerpt. This source exceeds 30,000 characters; nothing was truncated.",
    );
  // Capture uses the same canonical CRDT snapshot and authorizations as manual evidence.
  await transaction(async (db) => {
    await assistantScopes(user, scope[0], scope, db);
    if (evidence.kind !== "planning") {
      const { rowCount } = await db.query(
        "SELECT id FROM resources WHERE id=$1 AND space_id=$2 AND deleted_at IS NULL FOR SHARE",
        [evidence.id, evidence.spaceId],
      );
      if (!rowCount)
        throw new HttpError(403, "Source access changed during capture.");
    }
  });
  return { output: evidence, evidence };
}

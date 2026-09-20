import { createHash, randomBytes } from "node:crypto";
import * as Y from "yjs";
import type { PoolClient } from "pg";
import { query, transaction } from "./db";
import { HttpError, resourceAccess, spaceAccess, fileAccess } from "./access";
import { requireScope } from "./workspace-service";
import { currentRevisionDoc } from "./revision-api";
import { documentSource } from "./document-format";
import { sourceHash } from "./document-commands";
import {
  assistantTaskSchema,
  type AssistantEvidence,
  type AssistantSelection,
  type AssistantMessage,
  type AssistantPrepared,
} from "./assistant";

export type AssistantContext = {
  id: string;
  conversation_id: string;
  provider_id: string;
  provider_version: number;
  prompt: string;
  evidence: AssistantEvidence[];
  bases: Record<string, string>;
  messages: AssistantMessage[];
  history_ids: string[];
  fingerprint: string;
  allow_task_create: boolean;
  conversation_version: number;
  expires_at: string;
  submitted_at: string | null;
  cleared_at: string | null;
  created_at: string;
  owner_id: string;
  space_id: string;
};
export const assistantHash = (value: unknown): string => {
  const stable = (v: unknown): string =>
    v === null || typeof v !== "object"
      ? JSON.stringify(v)
      : Array.isArray(v)
        ? `[${v.map(stable).join(",")}]`
        : `{${Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => JSON.stringify(k) + ":" + stable(x))
            .join(",")}}`;
  return createHash("sha256").update(stable(value)).digest("hex");
};
export async function assistantConversation(id: string, userId: string) {
  const [c] = await query(
    "SELECT * FROM assistant_conversations WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL",
    [id, userId],
  );
  if (!c) throw new HttpError(404, "Conversation unavailable.");
  await spaceAccess(userId, c.space_id);
  return c;
}
export async function assistantContext(
  id: string,
  userId?: string,
  client?: PoolClient,
): Promise<AssistantContext> {
  const run = (sql: string, params: unknown[]) =>
    client
      ? client.query<AssistantContext>(sql, params).then((r) => r.rows)
      : query<AssistantContext>(sql, params);
  const [c] = await run(
    "SELECT x.*,c.owner_id,c.space_id FROM assistant_contexts x JOIN assistant_conversations c ON c.id=x.conversation_id WHERE x.id=$1 AND ($2::text IS NULL OR c.owner_id=$2) AND c.deleted_at IS NULL AND x.cleared_at IS NULL AND x.created_at>now()-interval '30 days'",
    [id, userId ?? null],
  );
  if (!c)
    throw new HttpError(404, "The private context expired or is unavailable.");
  return c;
}
export async function assistantProvider(
  user: string,
  spaceId: string,
  providerId: string,
  version?: number,
  client?: PoolClient,
) {
  const run = (sql: string, params: unknown[]) =>
    client ? client.query(sql, params).then((r) => r.rows) : query(sql, params);
  const [p] = await run(
    "SELECT p.*,g.name AS group_name FROM tool_providers p JOIN groups g ON g.id=p.group_id JOIN members m ON m.group_id=p.group_id AND m.user_id=$1 JOIN spaces s ON s.id=$2 WHERE p.id=$3 AND p.enabled AND 'assistant'=ANY(p.capabilities) AND g.lifecycle_status='active' AND (s.group_id IS NULL OR s.group_id=p.group_id)" +
      (client ? " FOR SHARE OF p" : ""),
    [user, spaceId, providerId],
  );
  if (!p || (version !== undefined && p.version !== version))
    throw new HttpError(
      409,
      "The provider or its configuration changed. Prepare and review the context again.",
    );
  return p;
}
export function taskAssistantFields(t: Record<string, any>) {
  if (typeof t.body === "string" && t.body.length > 12000)
    throw new HttpError(
      413,
      "This task exceeds the assistant's 12,000-character task limit. Use a shorter research note as evidence; nothing was truncated.",
    );
  return assistantTaskSchema.parse({
    title: t.title,
    body: t.body,
    status: t.status,
    priority: t.priority,
    assigneeId: t.assignee_id,
    labels: t.labels,
    estimateHours: t.estimate_hours == null ? null : Number(t.estimate_hours),
  });
}
export async function captureAssistantEvidence(
  user: string,
  spaceId: string,
  selections: AssistantSelection[],
) {
  const evidence: AssistantEvidence[] = [],
    bases: Record<string, string> = {};
  const prefix = "E" + randomBytes(5).toString("hex");
  for (const [i, s] of selections.entries()) {
    let e: AssistantEvidence = {
      key: prefix + "_" + (i + 1),
      kind: s.kind,
      id: s.id,
      title: "",
      source: "",
      hash: "",
      capturedAt: new Date().toISOString(),
      editable: false,
    };
    if (s.kind === "task") {
      await spaceAccess(user, spaceId, s.editable ? "edit" : "read");
      const [t] = await query(
        "SELECT * FROM tasks WHERE id=$1 AND space_id=$2 AND deleted_at IS NULL",
        [s.id, spaceId],
      );
      if (!t) throw new HttpError(404, "Task unavailable in this workspace.");
      const task = taskAssistantFields(t);
      e = {
        ...e,
        title: t.title,
        source: JSON.stringify(task, null, 2),
        task,
        version: t.version,
        editable: s.editable,
      };
    } else {
      const { resource } = await resourceAccess(
        user,
        s.id,
        s.kind === "document" && s.editable ? "comment" : "read",
      );
      if (resource.space_id !== spaceId)
        throw new HttpError(403, "Select evidence from this workspace only.");
      e.title = resource.name;
      if (s.kind === "document") {
        if (!resource.note_id)
          throw new HttpError(400, "Select a native text document.");
        const current = await currentRevisionDoc(resource.note_id);
        try {
          if (
            !["markdown", "latex", "text"].includes(
              current.format ?? "markdown",
            )
          )
            throw new HttpError(
              400,
              "This format is not supported as assistant context yet.",
            );
          const source = documentSource(current.doc, current.format),
            from = s.from ?? 0,
            to = s.to ?? source.length;
          if (
            from > to ||
            to > source.length ||
            (s.hash && s.hash !== sourceHash(source))
          )
            throw new HttpError(
              409,
              "The selected text changed. Select it again before preparing context.",
            );
          e = {
            ...e,
            source: source.slice(from, to),
            format: current.format ?? "markdown",
            generation: current.generation,
            from,
            to,
            editable: s.editable,
          };
          if (s.editable) {
            if (e.format === "text")
              throw new HttpError(
                400,
                "Edit proposals support Markdown and math documents.",
              );
            const state = Buffer.from(Y.encodeStateAsUpdate(current.doc));
            if (state.length > 2_000_000)
              throw new HttpError(
                413,
                "This document's edit snapshot is too large. Use read-only context.",
              );
            bases[e.key] = state.toString("base64");
          }
        } finally {
          current.doc.destroy();
        }
      } else if (s.kind === "pdf") {
        const { file } = await fileAccess(user, s.versionId);
        if (file.resource_id !== s.id || file.mime !== "application/pdf")
          throw new HttpError(
            400,
            "Select a PDF version belonging to this file.",
          );
        e = { ...e, source: s.text, versionId: s.versionId, page: s.page };
      } else {
        const [p] = await query(
          "SELECT p.*,j.version_id FROM pdf_ocr_pages p JOIN pdf_ocr_jobs j ON j.id=p.job_id JOIN file_versions v ON v.id=j.version_id WHERE j.id=$1 AND j.owner_id=$2 AND v.resource_id=$3 AND p.page=$4 AND p.reviewed AND j.cleared_at IS NULL AND j.expires_at>now()",
          [s.jobId, user, s.id, s.page],
        );
        if (!p)
          throw new HttpError(
            404,
            "Choose a reviewed OCR page belonging to you.",
          );
        e = {
          ...e,
          source: p.reviewed_text ?? p.text,
          versionId: p.version_id,
          page: s.page,
          jobId: s.jobId,
        };
      }
    }
    e.hash = sourceHash(e.source);
    evidence.push(e);
  }
  if (JSON.stringify(bases).length > 8_000_000)
    throw new HttpError(
      413,
      "Too many editable document snapshots. Select fewer targets.",
    );
  return { evidence, bases };
}
/** All historical evidence remains an authorization dependency of a derived answer. */
export async function assertAssistantAccess(
  c: AssistantContext,
  client?: PoolClient,
) {
  const check = async (db: PoolClient) => {
    await requireScope(db, c.owner_id, c.space_id);
    // Deletion and retention take the exclusive side of these locks before
    // redacting jobs. A completed provider response cannot resurrect deleted data.
    const { rowCount: live } = await db.query(
      "SELECT id FROM assistant_conversations WHERE id=$1 AND owner_id=$2 AND space_id=$3 AND deleted_at IS NULL FOR SHARE",
      [c.conversation_id, c.owner_id, c.space_id],
    );
    const contextIds = [...new Set([c.id, ...c.history_ids])].sort();
    const { rows: contexts } = await db.query<AssistantContext>(
      "SELECT * FROM assistant_contexts WHERE id=ANY($1::uuid[]) AND conversation_id=$2 AND cleared_at IS NULL AND created_at>now()-interval '30 days' ORDER BY id FOR SHARE",
      [contextIds, c.conversation_id],
    );
    if (!live || contexts.length !== contextIds.length)
      throw new HttpError(
        403,
        "Earlier context expired or became unavailable. Start a new conversation.",
      );
    const evidence = contexts.flatMap((x) => x.evidence);
    const resources = [
      ...new Set(evidence.filter((e) => e.kind !== "task").map((e) => e.id)),
    ].sort();
    if (resources.length) {
      const { rows } = await db.query(
        "SELECT id FROM resources WHERE id=ANY($1::uuid[]) AND space_id=$2 AND deleted_at IS NULL ORDER BY id FOR SHARE",
        [resources, c.space_id],
      );
      if (rows.length !== resources.length)
        throw new HttpError(
          403,
          "A source was moved, trashed, or is no longer accessible. This answer is withheld.",
        );
    }
    const tasks = [
      ...new Set(evidence.filter((e) => e.kind === "task").map((e) => e.id)),
    ].sort();
    if (tasks.length) {
      const { rows } = await db.query(
        "SELECT id FROM tasks WHERE id=ANY($1::uuid[]) AND space_id=$2 AND deleted_at IS NULL ORDER BY id FOR SHARE",
        [tasks, c.space_id],
      );
      if (rows.length !== tasks.length)
        throw new HttpError(
          403,
          "A task source is unavailable. Start a new conversation with accessible evidence.",
        );
    }
    for (const e of evidence.filter((e) => e.versionId)) {
      const { rowCount } = await db.query(
        "SELECT 1 FROM file_versions WHERE id=$1 AND resource_id=$2",
        [e.versionId, e.id],
      );
      if (!rowCount)
        throw new HttpError(403, "A captured file version is unavailable.");
      if (e.jobId) {
        const { rowCount: exists } = await db.query(
          "SELECT 1 FROM pdf_ocr_jobs WHERE id=$1 AND owner_id=$2 AND cleared_at IS NULL AND expires_at>now()",
          [e.jobId, c.owner_id],
        );
        if (!exists)
          throw new HttpError(
            403,
            "Private OCR evidence expired or was cleared.",
          );
      }
    }
  };
  return client ? check(client) : transaction(check);
}
export function publicAssistantContext(
  c: AssistantContext,
  p: Record<string, any>,
): AssistantPrepared {
  return {
    id: c.id,
    fingerprint: c.fingerprint,
    expiresAt: c.expires_at,
    conversationId: c.conversation_id,
    provider: {
      id: p.id,
      name: p.name,
      model: p.model,
      version: p.version,
      group_name: p.group_name,
    },
    evidence: c.evidence,
    messages: c.messages,
    characters: c.messages.reduce((n, m) => n + m.content.length, 0),
  };
}
export async function assistantMaintenance() {
  await transaction(async (client) => {
    // Same conversation -> context/job lock order as provider result publication.
    await client.query(
      "SELECT c.id FROM assistant_conversations c WHERE c.deleted_at IS NOT NULL OR c.updated_at<now()-interval '30 days' OR EXISTS(SELECT 1 FROM assistant_contexts x WHERE x.conversation_id=c.id AND (x.cleared_at IS NOT NULL OR x.created_at<now()-interval '30 days' OR (x.submitted_at IS NULL AND x.expires_at<now()))) ORDER BY c.id FOR UPDATE",
    );
    // Redact, don't delete quota receipts. Backup retention remains an operator policy.
    await client.query(
      "UPDATE tool_jobs j SET status=CASE WHEN status IN ('queued','running') THEN 'cancelled' ELSE status END,input='{}',result='{\"deleted\":true}',error=NULL FROM assistant_contexts x JOIN assistant_conversations c ON c.id=x.conversation_id WHERE j.assistant_context_id=x.id AND (x.created_at<now()-interval '30 days' OR c.deleted_at IS NOT NULL OR x.cleared_at IS NOT NULL)",
    );
    await client.query(
      "DELETE FROM assistant_proposals WHERE job_id IN(SELECT id FROM tool_jobs WHERE kind='assistant' AND result->>'deleted'='true')",
    );
    await client.query(
      "UPDATE assistant_contexts x SET prompt='',evidence='[]',bases='{}',messages='[]',history_ids='{}',cleared_at=now() FROM assistant_conversations c WHERE c.id=x.conversation_id AND x.cleared_at IS NULL AND (c.deleted_at IS NOT NULL OR x.created_at<now()-interval '30 days' OR (x.submitted_at IS NULL AND x.expires_at<now()))",
    );
    await client.query(
      "UPDATE assistant_conversations SET title='Expired conversation',deleted_at=coalesce(deleted_at,now()) WHERE updated_at<now()-interval '30 days'",
    );
  });
}

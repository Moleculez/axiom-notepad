import { createHash, randomBytes } from "node:crypto";
import * as Y from "yjs";
import type { PoolClient } from "pg";
import { query, transaction } from "./db";
import { HttpError, resourceAccess, spaceAccess, fileAccess } from "./access";
import { requireScope } from "./workspace-service";
import { currentRevisionDoc } from "./revision-api";
import { documentSource } from "./document-format";
import { sourceHash } from "./document-commands";
import { planningTasks } from "./planning-api";
import { analyzeSchedule, compareBaseline } from "./planning-analysis";
import { calendarSchema } from "./planning";
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
  space_ids?: string[];
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
export async function assistantScopes(
  user: string,
  anchor: string,
  requested: string[] = [anchor],
  client?: PoolClient,
) {
  const ids = [...new Set([anchor, ...requested])].sort();
  if (ids.length > 20)
    throw new HttpError(413, "Choose at most 20 workspaces in one group.");
  const run = async (db: PoolClient) => {
    for (const id of ids) await requireScope(db, user, id);
    const { rows } = await db.query(
      "SELECT id,group_id FROM spaces WHERE id=ANY($1::uuid[]) ORDER BY id",
      [ids],
    );
    const group = rows.find((s) => s.id === anchor)?.group_id;
    if (
      rows.length !== ids.length ||
      (ids.length > 1 && (!group || rows.some((s) => s.group_id !== group)))
    )
      throw new HttpError(
        403,
        "Choose accessible workspaces in the same group. Personal workspaces cannot be mixed.",
      );
    return ids;
  };
  return client ? run(client) : transaction(run);
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
    "SELECT x.*,c.owner_id,c.space_id,c.space_ids FROM assistant_contexts x JOIN assistant_conversations c ON c.id=x.conversation_id WHERE x.id=$1 AND ($2::text IS NULL OR c.owner_id=$2) AND c.deleted_at IS NULL AND x.cleared_at IS NULL AND x.created_at>now()-interval '30 days'",
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
  allowedSpaces: string[] = [spaceId],
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
    if (s.kind === "planning") {
      if (!allowedSpaces.includes(s.id))
        throw new HttpError(
          403,
          "Planning evidence is outside this conversation.",
        );
      await spaceAccess(user, s.id);
      const value = await transaction(async (db) => {
        await requireScope(db, user, s.id);
        const {
          rows: [space],
        } = await db.query("SELECT * FROM spaces WHERE id=$1 FOR SHARE", [
          s.id,
        ]);
        const tasks = await planningTasks(db, s.id),
          calendar = calendarSchema.parse({
            ...space.planning_calendar,
            timezone: space.timezone,
          }),
          analysis = analyzeSchedule(tasks, calendar);
        const selected = tasks.filter((t) => s.taskIds.includes(t.id));
        if (selected.length !== new Set(s.taskIds).size)
          throw new HttpError(409, "A selected planning task is unavailable.");
        let comparison;
        if (s.baselineId) {
          const {
            rows: [b],
          } = await db.query(
            "SELECT snapshot FROM planning_baselines WHERE id=$1 AND space_id=$2",
            [s.baselineId, s.id],
          );
          if (!b) throw new HttpError(404, "Baseline unavailable.");
          comparison = compareBaseline(b.snapshot, {
            tasks,
            calendar,
            milestones: [],
            planningVersion: space.planning_version,
          }).items.filter((t) => s.taskIds.includes(t.id));
        }
        return {
          title: space.name,
          version: space.planning_version,
          source: JSON.stringify({
            calendar,
            tasks: selected,
            analysis: {
              ...analysis,
              tasks: analysis.tasks.filter((t) => s.taskIds.includes(t.id)),
              incompleteIds: analysis.incompleteIds.filter((id) =>
                s.taskIds.includes(id),
              ),
            },
            comparison,
          }),
        };
      });
      e = {
        ...e,
        spaceId: s.id,
        title: `${value.title} · selected plan`,
        planningVersion: value.version,
        taskIds: s.taskIds,
        source: value.source,
      };
    } else if (s.kind === "task") {
      const [t] = await query(
        "SELECT * FROM tasks WHERE id=$1 AND space_id=ANY($2::uuid[]) AND deleted_at IS NULL",
        [s.id, allowedSpaces],
      );
      if (!t) throw new HttpError(404, "Task unavailable in this workspace.");
      await spaceAccess(user, t.space_id, s.editable ? "edit" : "read");
      const task = taskAssistantFields(t);
      e = {
        ...e,
        title: t.title,
        spaceId: t.space_id,
        startOn:
          t.start_on instanceof Date
            ? t.start_on.toISOString().slice(0, 10)
            : t.start_on,
        dueOn:
          t.due_on instanceof Date
            ? t.due_on.toISOString().slice(0, 10)
            : t.due_on,
        source: JSON.stringify(
          { ...task, startOn: t.start_on, dueOn: t.due_on },
          null,
          2,
        ),
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
      if (!allowedSpaces.includes(resource.space_id))
        throw new HttpError(403, "Select evidence from this workspace only.");
      e.title = resource.name;
      e.spaceId = resource.space_id;
      if (s.kind === "office") {
        const [job] = await query(
          "SELECT result,input FROM tool_jobs WHERE id=$1 AND owner_id=$2 AND resource_id=$3 AND version_id=$4 AND kind='assistant-evidence' AND status='complete' AND created_at>now()-interval '1 day'",
          [s.extractionId, user, s.id, s.versionId],
        );
        if (
          !job?.result?.source ||
          job.input.spaceId !== resource.space_id ||
          s.to > job.result.source.length
        )
          throw new HttpError(
            409,
            "Extract this version again before selecting its evidence.",
          );
        const location = job.result.locators.find(
          (l: { from: number; to: number }) =>
            s.from >= l.from && s.from < l.to,
        );
        e = {
          ...e,
          versionId: s.versionId,
          format: job.result.format,
          from: s.from,
          to: s.to,
          locator: location?.target,
          source: job.result.source.slice(s.from, s.to),
        };
      } else if (s.kind === "canvas") {
        if (!resource.note_id)
          throw new HttpError(400, "Choose a native canvas.");
        const current = await currentRevisionDoc(resource.note_id);
        try {
          if (current.format !== "canvas")
            throw new HttpError(400, "Choose a native canvas.");
          const source = documentSource(current.doc, current.format);
          if (sourceHash(source) !== s.hash)
            throw new HttpError(
              409,
              "The canvas changed. Select its cards again.",
            );
          const canvas = JSON.parse(source),
            nodes = canvas.nodes.filter((n: any) => s.nodeIds.includes(n.id));
          if (nodes.length !== new Set(s.nodeIds).size)
            throw new HttpError(409, "A selected card is unavailable.");
          e = {
            ...e,
            format: "canvas",
            generation: current.generation,
            locator: s.nodeIds.join(","),
            source: JSON.stringify({
              nodes: nodes.map((n: any) => ({
                id: n.id,
                type: n.type,
                label: n.title ?? n.label ?? n.name,
                text: n.type === "text" ? n.text : undefined,
              })),
              edges: canvas.edges
                .filter(
                  (edge: any) =>
                    s.nodeIds.includes(edge.fromNode) &&
                    s.nodeIds.includes(edge.toNode),
                )
                .map((edge: any) => ({
                  from: edge.fromNode,
                  to: edge.toNode,
                  label: edge.label,
                })),
            }),
          };
        } finally {
          current.doc.destroy();
        }
      } else if (s.kind === "document") {
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
      } else if (s.kind === "ocr") {
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
    const scope = [...new Set(c.space_ids ?? [c.space_id])].sort();
    for (const sid of scope) await requireScope(db, c.owner_id, sid);
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
      ...new Set(
        evidence
          .filter((e) => e.kind !== "task" && e.kind !== "planning")
          .map((e) => e.id),
      ),
    ].sort();
    if (resources.length) {
      const { rows } = await db.query(
        "SELECT id,space_id FROM resources WHERE id=ANY($1::uuid[]) AND space_id=ANY($2::uuid[]) AND deleted_at IS NULL ORDER BY id FOR SHARE",
        [resources, scope],
      );
      if (
        rows.length !== resources.length ||
        evidence.some(
          (e) =>
            resources.includes(e.id) &&
            !rows.some(
              (r) => r.id === e.id && r.space_id === (e.spaceId ?? c.space_id),
            ),
        )
      )
        throw new HttpError(
          403,
          "A source was moved, trashed, or is no longer accessible. This answer is withheld.",
        );
    }
    const tasks = [
      ...new Set(
        evidence.flatMap((e) =>
          e.kind === "task"
            ? [e.id]
            : e.kind === "planning"
              ? (e.taskIds ?? [])
              : [],
        ),
      ),
    ].sort();
    if (tasks.length) {
      const { rows } = await db.query(
        "SELECT id,space_id FROM tasks WHERE id=ANY($1::uuid[]) AND space_id=ANY($2::uuid[]) AND deleted_at IS NULL ORDER BY id FOR SHARE",
        [tasks, scope],
      );
      if (
        rows.length !== tasks.length ||
        evidence.some((e) =>
          (e.kind === "task"
            ? [e.id]
            : e.kind === "planning"
              ? (e.taskIds ?? [])
              : []
          ).some(
            (id) =>
              !rows.some(
                (r) => r.id === id && r.space_id === (e.spaceId ?? c.space_id),
              ),
          ),
        )
      )
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
  await query(
    "UPDATE tool_jobs SET result=NULL,input='{}',status=CASE WHEN status IN ('queued','running') THEN 'cancelled' ELSE status END WHERE kind='assistant-evidence' AND created_at<now()-interval '1 day' AND (result IS NOT NULL OR input<>'{}'::jsonb)",
  );
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

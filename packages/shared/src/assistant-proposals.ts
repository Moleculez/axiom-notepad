import * as Y from "yjs";
import { z } from "zod";
import { query, transaction } from "./db";
import { HttpError, spaceAccess, resourceAccess } from "./access";
import { workspaceJson as json } from "./workspace-service";
import { assistantProposalSchema, type AssistantProposal } from "./assistant";
import {
  assistantContext,
  assertAssistantAccess,
  assistantHash,
  taskAssistantFields,
} from "./assistant-service";
import { captureHunks, resolveHunks } from "./suggestion-hunks";
import { diffChanges } from "./version-diff";
import { currentRevisionDoc } from "./revision-api";
import { lockPlanning, mutatePlanningTask } from "./planning-api";
import { notifyWorkspace } from "./documents";
import { applyChanges } from "@axiom/editor/transactions";

async function loadProposal(id: string, user: string) {
  const [p] = await query(
    "SELECT p.*,j.assistant_context_id FROM assistant_proposals p JOIN tool_jobs j ON j.id=p.job_id WHERE p.id=$1 AND j.owner_id=$2 AND j.status='complete'",
    [id, user],
  );
  if (!p) throw new HttpError(404, "Private proposal unavailable.");
  const c = await assistantContext(p.assistant_context_id, user);
  await assertAssistantAccess(c);
  return { p, c };
}
export async function assistantProposalApi(
  request: Request,
  path: string[],
  user: string,
): Promise<Response> {
  const id = z.uuid().parse(path[2]),
    action = path[3],
    method = request.method,
    { p, c } = await loadProposal(id, user);
  const original = assistantProposalSchema.parse(p.data),
    evidence =
      original.kind === "task-create"
        ? undefined
        : c.evidence.find((e) => e.key === original.evidenceKey);
  if (original.kind !== "task-create" && !evidence?.editable)
    throw new HttpError(403, "This target was not approved for proposals.");
  if (action === "preview" && method === "POST") {
    if (p.state !== "draft")
      throw new HttpError(
        409,
        "This proposal was already applied or dismissed.",
      );
    const data = assistantProposalSchema.parse(await request.json());
    if (
      data.kind !== original.kind ||
      (data.kind !== "task-create" &&
        (original.kind === "task-create" ||
          data.evidenceKey !== original.evidenceKey))
    )
      throw new HttpError(403, "A proposal cannot change its approved target.");
    let before: unknown = null,
      prepared: Record<string, unknown> = { proposal: data };
    if (data.kind === "document") {
      await resourceAccess(user, evidence!.id, "comment");
      const base = new Y.Doc(),
        current = await currentRevisionDoc(evidence!.id);
      try {
        if (current.generation !== evidence!.generation)
          throw new HttpError(
            409,
            "The document generation changed. Ask for a fresh proposal.",
          );
        Y.applyUpdate(
          base,
          new Uint8Array(Buffer.from(c.bases[evidence!.key], "base64")),
        );
        const hunks = captureHunks(
          base,
          diffChanges(evidence!.source, data.source).map((change) => ({
            ...change,
            from: change.from + evidence!.from!,
            to: change.to + evidence!.from!,
          })),
        );
        try {
          resolveHunks(current.doc, hunks);
        } catch (e) {
          throw new HttpError(409, (e as Error).message);
        }
        if (!hunks.length)
          throw new HttpError(400, "This proposal has no changes.");
        prepared = {
          ...prepared,
          hunks,
          generation: current.generation,
          noteId: evidence!.id,
        };
        before = evidence!.source;
      } finally {
        base.destroy();
        current.doc.destroy();
      }
    } else {
      await spaceAccess(user, c.space_id, "edit");
      if (data.kind === "task-create" && !c.allow_task_create)
        throw new HttpError(
          403,
          "Task creation was not enabled for this request.",
        );
      if (data.kind === "task-update") {
        const [task] = await query(
          "SELECT * FROM tasks WHERE id=$1 AND space_id=$2 AND deleted_at IS NULL",
          [evidence!.id, c.space_id],
        );
        if (!task || task.version !== evidence!.version)
          throw new HttpError(
            409,
            "The task changed. Prepare a new proposal; newer work will not be overwritten.",
          );
        before = taskAssistantFields(task);
        prepared = { ...prepared, taskId: task.id, version: task.version };
      }
      if (data.fields.assigneeId) {
        const [allowed] = await query(
          "SELECT axiom_space_role($1,$2) AS role",
          [data.fields.assigneeId, c.space_id],
        );
        if (!allowed?.role)
          throw new HttpError(400, "The assignee must have workspace access.");
      }
    }
    const fingerprint = assistantHash(prepared);
    const r = await transaction(async (client) => {
      await assertAssistantAccess(c, client);
      const {
        rows: [proposal],
      } = await client.query(
        "SELECT state FROM assistant_proposals WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (proposal?.state !== "draft")
        throw new HttpError(
          409,
          "This proposal was dismissed or already applied.",
        );
      // Only the latest unsubmitted preview is actionable. Applied receipts remain
      // immutable so retries and guarded Undo preserve their exact identity.
      await client.query(
        "DELETE FROM assistant_receipts WHERE proposal_id=$1 AND applied_at IS NULL",
        [id],
      );
      const {
        rows: [receipt],
      } = await client.query(
        "INSERT INTO assistant_receipts(proposal_id,data,before_data,fingerprint) VALUES($1,$2,$3,$4) RETURNING id,expires_at",
        [id, JSON.stringify(prepared), JSON.stringify(before), fingerprint],
      );
      return receipt;
    });
    return json(
      {
        id: r.id,
        fingerprint,
        expiresAt: r.expires_at,
        before,
        after: data.kind === "document" ? data.source : data.fields,
        kind: data.kind,
      },
      201,
    );
  }
  if (action === "draft" && method === "GET") {
    if (p.state !== "draft")
      throw new HttpError(
        409,
        "This proposal was dismissed or already applied.",
      );
    const receipt = z
      .uuid()
      .parse(new URL(request.url).searchParams.get("receipt"));
    const [r] = await query(
      "SELECT * FROM assistant_receipts WHERE id=$1 AND proposal_id=$2 AND expires_at>now()",
      [receipt, id],
    );
    if (!r || r.data.proposal.kind !== "document")
      throw new HttpError(
        409,
        "This preview expired. Review the proposal again.",
      );
    await resourceAccess(user, r.data.noteId, "comment");
    const current = await currentRevisionDoc(r.data.noteId);
    try {
      if (current.generation !== r.data.generation)
        throw new HttpError(
          409,
          "The document was restored. Prepare a new proposal.",
        );
      let changes;
      try {
        changes = resolveHunks(current.doc, r.data.hunks);
      } catch (e) {
        throw new HttpError(409, (e as Error).message);
      }
      const [existing] = await query(
        "SELECT version,status FROM revision_suggestions WHERE id=$1 AND author_id=$2",
        [id, user],
      );
      if (existing && existing.status !== "pending")
        throw new HttpError(
          409,
          "This suggestion was already decided. Open Review suggestions.",
        );
      return json({
        id,
        assistantContextId: c.id,
        assistantStateVector: Buffer.from(
          Y.encodeStateVector(current.doc),
        ).toString("base64"),
        manualPublish: true,
        noteId: r.data.noteId,
        generation: current.generation,
        hunks: r.data.hunks,
        source: applyChanges(
          current.doc.getText("markdown").toString(),
          changes,
        ),
        message:
          "AI-assisted draft — verify before publishing. " +
          r.data.proposal.explanation,
        version: existing?.version ?? 0,
        revision: 1,
        confirmed: 0,
        updatedAt: new Date().toISOString(),
      });
    } finally {
      current.doc.destroy();
    }
  }
  if ((action === "apply" || action === "undo") && method === "POST") {
    const input = z
      .object({ receiptId: z.uuid(), fingerprint: z.string().length(64) })
      .strict()
      .parse(await request.json());
    if (original.kind === "document")
      throw new HttpError(
        400,
        "Publish document proposals through the suggestion editor. Accepted content is not directly editable by the assistant.",
      );
    const result = await transaction(async (client) => {
      const space = await lockPlanning(client, user, c.space_id);
      await assertAssistantAccess(c, client);
      const {
        rows: [proposal],
      } = await client.query(
        "SELECT state FROM assistant_proposals WHERE id=$1 FOR UPDATE",
        [id],
      );
      const {
        rows: [r],
      } = await client.query(
        "SELECT * FROM assistant_receipts WHERE id=$1 AND proposal_id=$2 FOR UPDATE",
        [input.receiptId, id],
      );
      if (!r || r.fingerprint !== input.fingerprint)
        throw new HttpError(409, "Approval does not match this preview.");
      if (action === "undo") {
        if (r.undone_at) return { ok: true, undone: true };
        if (!r.applied_at || !r.result?.id || !r.inverse)
          throw new HttpError(
            409,
            "This proposal has no applied task change to undo.",
          );
        if (r.inverse.deleted) {
          const { rowCount } = await client.query(
            "SELECT 1 FROM task_dependencies WHERE depends_on=$1 UNION ALL SELECT 1 FROM tasks WHERE parent_id=$1 AND deleted_at IS NULL UNION ALL SELECT 1 FROM project_discussions WHERE task_id=$1 AND deleted_at IS NULL UNION ALL SELECT 1 FROM task_resources WHERE task_id=$1 LIMIT 1",
            [r.result.id],
          );
          if (rowCount)
            throw new HttpError(
              409,
              "New work depends on this task. Undo cannot remove it.",
            );
        }
        const restored = await mutatePlanningTask(
          client,
          user,
          c.space_id,
          space,
          r.result.id,
          { ...r.inverse, version: r.result.version },
        );
        await client.query(
          "UPDATE assistant_receipts SET undone_at=now() WHERE id=$1",
          [r.id],
        );
        await client.query(
          "UPDATE assistant_proposals SET state='undone' WHERE id=$1",
          [id],
        );
        return { ok: true, undone: true, id: restored.id };
      }
      if (r.applied_at) return r.result;
      if (
        proposal?.state !== "draft" ||
        new Date(r.expires_at).valueOf() <= Date.now()
      )
        throw new HttpError(
          409,
          "The proposal was applied or its preview expired. Review again.",
        );
      const data = assistantProposalSchema.parse(r.data.proposal) as Exclude<
        AssistantProposal,
        { kind: "document" }
      >;
      const task = await mutatePlanningTask(
        client,
        user,
        c.space_id,
        space,
        r.data.taskId,
        {
          ...data.fields,
          ...(r.data.taskId ? { version: r.data.version } : {}),
        },
      );
      const saved = {
        id: task.id,
        version: task.version,
        spaceId: c.space_id,
        receiptId: r.id,
        fingerprint: r.fingerprint,
      };
      await client.query(
        "UPDATE assistant_receipts SET applied_at=now(),result=$2,inverse=$3 WHERE id=$1",
        [
          r.id,
          JSON.stringify(saved),
          JSON.stringify(
            data.kind === "task-create" ? { deleted: true } : r.before_data,
          ),
        ],
      );
      await client.query(
        "UPDATE assistant_proposals SET state='applied' WHERE id=$1",
        [id],
      );
      return saved;
    });
    await notifyWorkspace();
    return json(result);
  }
  if (action === "dismiss" && method === "POST") {
    await query(
      "UPDATE assistant_proposals SET state='dismissed' WHERE id=$1 AND state='draft'",
      [id],
    );
    return json({ ok: true });
  }
  throw new HttpError(405, "Unsupported proposal operation.");
}

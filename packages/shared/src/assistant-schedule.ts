import { z } from "zod";
import type { PoolClient } from "pg";
import { transaction } from "./db";
import { HttpError } from "./access";
import { workspaceJson as json } from "./workspace-service";
import { lockPlanning } from "./planning-api";
import { previewSchedule, applySchedule } from "./schedule-service";
import {
  assistantHash,
  assertAssistantAccess,
  type AssistantContext,
} from "./assistant-service";
import { assistantProposalSchema, type AssistantEvidence } from "./assistant";
import { notifyWorkspace } from "./documents";
/** Stable lock ordering for proposals whose evidence spans multiple workspaces. */
export async function lockAssistantPlanning(
  db: PoolClient,
  user: string,
  c: AssistantContext,
  target: string,
) {
  const scope = [...new Set([...(c.space_ids ?? [c.space_id]), target])].sort();
  for (const id of scope)
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      "planning:" + id,
    ]);
  await db.query(
    "SELECT id FROM spaces WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
    [scope],
  );
  return lockPlanning(db, user, target);
}
export async function assistantScheduleProposal(
  request: Request,
  user: string,
  p: Record<string, any>,
  c: AssistantContext,
  e: AssistantEvidence,
  action: string,
) {
  if (request.method !== "POST")
    throw new HttpError(405, "Use POST for schedule proposals.");
  if (!e.editable || e.kind !== "task")
    throw new HttpError(403, "This task was not approved for proposals.");
  const target = e.spaceId ?? c.space_id,
    raw = await request.json();
  const result = await transaction(async (db) => {
    const space = await lockAssistantPlanning(db, user, c, target);
    await assertAssistantAccess(c, db);
    const {
      rows: [proposal],
    } = await db.query(
      "SELECT state FROM assistant_proposals WHERE id=$1 FOR UPDATE",
      [p.id],
    );
    if (action === "dismiss") {
      if (proposal.state === "draft")
        await db.query(
          "UPDATE assistant_proposals SET state='dismissed' WHERE id=$1",
          [p.id],
        );
      return { ok: true };
    }
    if (action === "preview") {
      if (proposal.state !== "draft")
        throw new HttpError(409, "This proposal is no longer a private draft.");
      const value = assistantProposalSchema.parse(raw);
      if (value.kind !== "schedule" || value.evidenceKey !== e.key)
        throw new HttpError(403, "Cannot change the approved target.");
      const plan = await previewSchedule(db, user, space, [
        {
          id: e.id,
          version: e.version!,
          startOn: value.startOn,
          dueOn: value.dueOn,
        },
      ]);
      const data = { proposal: value, scheduleId: plan.id, spaceId: target },
        fingerprint = assistantHash(data);
      await db.query(
        "DELETE FROM assistant_receipts WHERE proposal_id=$1 AND applied_at IS NULL",
        [p.id],
      );
      const {
        rows: [receipt],
      } = await db.query(
        "INSERT INTO assistant_receipts(proposal_id,data,before_data,fingerprint) VALUES($1,$2,$3,$4) RETURNING id,expires_at",
        [p.id, data, JSON.stringify(plan.before), fingerprint],
      );
      return {
        id: receipt.id,
        expiresAt: receipt.expires_at,
        fingerprint,
        kind: "schedule",
        before: plan.before,
        after: plan.proposed,
        plan,
        spaceId: target,
      };
    }
    if (!["apply", "undo"].includes(action))
      throw new HttpError(404, "Unknown proposal action.");
    const input = z
      .object({ receiptId: z.uuid(), fingerprint: z.string().length(64) })
      .strict()
      .parse(raw);
    const {
      rows: [receipt],
    } = await db.query(
      "SELECT * FROM assistant_receipts WHERE id=$1 AND proposal_id=$2 FOR UPDATE",
      [input.receiptId, p.id],
    );
    if (!receipt || receipt.fingerprint !== input.fingerprint)
      throw new HttpError(409, "Approval does not match this preview.");
    if (action === "apply" && receipt.applied_at) return receipt.result;
    if (action === "undo" && receipt.undone_at)
      return { ok: true, undone: true };
    if (
      action === "apply" &&
      (proposal.state !== "draft" ||
        new Date(receipt.expires_at).valueOf() <= Date.now())
    )
      throw new HttpError(409, "Review a fresh proposal preview.");
    const applied = await applySchedule(
      db,
      user,
      space,
      receipt.data.scheduleId,
      "proposed",
      action === "undo",
    );
    const saved = {
      ...applied,
      spaceId: target,
      id: e.id,
      receiptId: receipt.id,
      fingerprint: receipt.fingerprint,
    };
    if (action === "undo")
      await db.query(
        "UPDATE assistant_receipts SET undone_at=now() WHERE id=$1",
        [receipt.id],
      );
    else
      await db.query(
        "UPDATE assistant_receipts SET applied_at=now(),result=$2 WHERE id=$1",
        [receipt.id, saved],
      );
    await db.query("UPDATE assistant_proposals SET state=$2 WHERE id=$1", [
      p.id,
      action === "undo" ? "undone" : "applied",
    ]);
    return saved;
  });
  await notifyWorkspace();
  return json(result);
}

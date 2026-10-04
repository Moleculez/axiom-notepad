import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { query, transaction } from "./db";
import { HttpError, spaceAccess, spaceAccessEpoch } from "./access";
import { activeConnection } from "./integration-security";
import { activePluginGrant, authorizePluginAction } from "./plugin-security";
import {
  assistantContext,
  assertAssistantAccess,
  assistantHash,
  assistantScopes,
} from "./assistant-service";
import { withAuditContext, installAuditContext } from "./audit-context";
import { integrationActions } from "./integration-catalog";
import { notifyWorkspace } from "./documents";
import {
  changeSetInput,
  changeActionSchema,
  isWorkspaceMutation,
  orderedActions,
  selectedActionKeys,
  resolveActionReferences,
  type ChangeAction,
} from "./productivity";
import {
  authorizeAction,
  prepareAction,
  planningAction,
  applyPlanningAction,
  type ActionActor,
  type ActionExecutor,
  type PreparedAction,
} from "./workspace-actions";

type SetRow = {
  id: string;
  owner_id: string;
  connection_id?: string;
  grant_version?: string;
  context_id?: string;
  space_ids: string[];
  status: string;
  version: number;
  preview: any;
  [key: string]: any;
};
type ActionRow = {
  id: string;
  set_id: string;
  key: string;
  entity_id: string;
  data: ChangeAction;
  state: string;
  selected: boolean;
  prepared?: PreparedAction;
  before_data?: Record<string, any>;
  result?: Record<string, any>;
  [key: string]: any;
};
const actorFor = (s: SetRow): ActionActor => ({
  userId: s.owner_id,
  spaceIds: s.space_ids,
  connectionId: s.connection_id,
  grantVersion: s.grant_version,
  pluginGrantId: s.plugin_grant_id,
  pluginPackageHash: s.plugin_package_hash,
  pluginGrantRevision: s.plugin_grant_revision,
});
export async function assertChangeSetAccess(s: SetRow, db?: PoolClient) {
  if (s.plugin_grant_id) {
    const grant = await activePluginGrant(
      {
        grantId: s.plugin_grant_id,
        userId: s.owner_id,
        packageHash: s.plugin_package_hash,
        revision: s.plugin_grant_revision,
      },
      db,
    );
    if (
      s.space_ids.length !== 1 ||
      s.space_ids[0] !== grant.space_id ||
      s.connection_id ||
      s.context_id
    )
      throw new HttpError(403, "Extension change set scope changed.");
    const rows = db
      ? (
          await db.query(
            "SELECT data FROM workspace_change_actions WHERE set_id=$1",
            [s.id ?? s.set_id],
          )
        ).rows
      : await query(
          "SELECT data FROM workspace_change_actions WHERE set_id=$1",
          [s.id ?? s.set_id],
        );
    for (const row of rows)
      await authorizePluginAction(
        {
          grantId: grant.id,
          userId: s.owner_id,
          packageHash: grant.package_hash,
          revision: grant.revision,
        },
        row.data,
        db,
      );
  }
  if (s.context_id)
    await assertAssistantAccess(
      await assistantContext(s.context_id, s.owner_id, db),
      db,
    );
  for (const id of s.space_ids) await spaceAccess(s.owner_id, id);
  if (s.connection_id) {
    const c = await activeConnection(
      s.connection_id,
      s.owner_id,
      "workspace:read",
      db,
      s.grant_version,
    );
    if (s.space_ids.some((id) => !c.space_ids.includes(id)))
      throw new HttpError(403, "Connection scope changed.");
  }
}
export async function loadChangeSet(
  id: string,
  user: string,
  connectionId?: string,
) {
  const [s] = await query<SetRow>(
    "SELECT * FROM workspace_change_sets WHERE id=$1 AND owner_id=$2 AND created_at>now()-interval '30 days'",
    [z.uuid().parse(id), user],
  );
  if (!s || (connectionId && s.connection_id !== connectionId))
    throw new HttpError(404, "Change set unavailable.");
  await assertChangeSetAccess(s);
  return s;
}
export async function changeSetView(
  id: string,
  user: string,
  connectionId?: string,
) {
  const s = await loadChangeSet(id, user, connectionId);
  const actions = await query<ActionRow>(
    "SELECT * FROM workspace_change_actions WHERE set_id=$1 ORDER BY position",
    [id],
  );
  return {
    id: s.id,
    title: s.title,
    status: s.status,
    version: s.version,
    space_ids: s.space_ids,
    connection_id: s.connection_id,
    plugin_package_hash: s.plugin_package_hash,
    plugin_grant_id: s.plugin_grant_id,
    error: s.error,
    preview: s.preview
      ? { fingerprint: s.preview.fingerprint, expiresAt: s.preview.expiresAt }
      : undefined,
    actions: actions.map((a) => ({
      id: a.id,
      entity_id: a.entity_id,
      data: a.data,
      state: a.state,
      selected: a.selected,
      before: a.before_data,
      prepared: a.prepared,
      result: a.result,
      error: a.error,
      undoable:
        a.state === "complete" &&
        [
          "document_edit",
          "workspace_task_create",
          "workspace_task_update",
          "file_update",
          "workspace_schedule_apply",
        ].includes(a.data.action),
    })),
  };
}
export async function createChangeSet(
  actor: ActionActor,
  raw: unknown,
  contextId?: string,
  runId?: string,
) {
  const input = changeSetInput.parse(raw);
  if (JSON.stringify(input).length > 1_500_000)
    throw new HttpError(413, "Split this change set into smaller batches.");
  if (input.spaceIds.some((id) => !actor.spaceIds.includes(id)))
    throw new HttpError(403, "Change set exceeds authorized scope.");
  if (!actor.connectionId && !actor.pluginGrantId)
    await assistantScopes(actor.userId, input.spaceIds[0], input.spaceIds);
  if (
    actor.pluginGrantId &&
    (contextId || runId || input.spaceIds.length !== 1)
  )
    throw new HttpError(
      403,
      "Extensions propose changes in one approved workspace at a time.",
    );
  const actions = orderedActions(input.actions);
  if (actions.some((a) => !isWorkspaceMutation(a.action)))
    throw new HttpError(400, "Change sets contain only workspace mutations.");
  const ids = Object.fromEntries(actions.map((a) => [a.key, randomUUID()]));
  for (const a of actions) {
    if (!input.spaceIds.includes(a.spaceId))
      throw new HttpError(403, "An action is outside this change set.");
    // Future targets are checked when their prerequisite has been created.
    const resolved = resolveActionReferences(a, ids);
    if (
      !a.targetId?.includes("@{") &&
      !String(a.payload.noteId ?? "").includes("@{")
    )
      await authorizeAction({ ...actor, spaceIds: input.spaceIds }, resolved);
    else if (!actor.connectionId)
      throw new HttpError(
        400,
        "Put initial content in the file creation action instead of editing a not-yet-created file.",
      );
  }
  const requestHash = assistantHash(input);
  await transaction(async (db) => {
    if (actor.pluginGrantId)
      for (const action of actions)
        await authorizePluginAction(
          {
            grantId: actor.pluginGrantId,
            userId: actor.userId,
            packageHash: actor.pluginPackageHash!,
            revision: actor.pluginGrantRevision!,
          },
          action,
          db,
        );
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      "changes:" + actor.userId,
    ]);
    const {
      rows: [existing],
    } = await db.query("SELECT * FROM workspace_change_sets WHERE id=$1", [
      input.mutationId,
    ]);
    if (existing) {
      if (
        existing.owner_id !== actor.userId ||
        existing.connection_id !== (actor.connectionId ?? null) ||
        existing.plugin_grant_id !== (actor.pluginGrantId ?? null) ||
        existing.plugin_package_hash !== (actor.pluginPackageHash ?? null) ||
        existing.plugin_grant_revision !==
          (actor.pluginGrantRevision ?? null) ||
        existing.request_hash !== requestHash
      )
        throw new HttpError(
          409,
          "Retry identifier belongs to another change set.",
        );
      return;
    }
    const {
      rows: [usage],
    } = await db.query(
      "SELECT count(*)::int AS count FROM workspace_change_sets WHERE owner_id=$1 AND status IN ('draft','queued','applying') AND created_at>now()-interval '30 days'",
      [actor.userId],
    );
    if (usage.count >= 100)
      throw new HttpError(
        429,
        "Dismiss an older change set before preparing another.",
      );
    await db.query(
      "INSERT INTO workspace_change_sets(id,owner_id,connection_id,grant_version,context_id,run_id,title,space_ids,request_hash,plugin_grant_id,plugin_package_hash,plugin_grant_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        input.mutationId,
        actor.userId,
        actor.connectionId ?? null,
        actor.grantVersion ?? null,
        contextId ?? null,
        runId ?? null,
        input.title,
        input.spaceIds,
        requestHash,
        actor.pluginGrantId ?? null,
        actor.pluginPackageHash ?? null,
        actor.pluginGrantRevision ?? null,
      ],
    );
    for (const [i, a] of actions.entries())
      await db.query(
        "INSERT INTO workspace_change_actions(set_id,key,position,entity_id,data) VALUES($1,$2,$3,$4,$5)",
        [input.mutationId, a.key, i, ids[a.key], JSON.stringify(a)],
      );
  });
  return changeSetView(
    input.mutationId,
    actor.userId,
    actor.connectionId ?? undefined,
  );
}
export async function reviseChangeSet(
  id: string,
  user: string,
  version: number,
  changes: ChangeAction[],
) {
  const s = await loadChangeSet(id, user),
    parsed = z.array(changeActionSchema).min(1).max(50).parse(changes);
  const current = await query<ActionRow>(
    "SELECT * FROM workspace_change_actions WHERE set_id=$1",
    [id],
  );
  if (
    current.length !== parsed.length ||
    parsed.some(
      (a) =>
        !current.some(
          (old) =>
            old.key === a.key &&
            old.data.action === a.action &&
            old.data.spaceId === a.spaceId &&
            old.data.targetId === a.targetId,
        ),
    )
  )
    throw new HttpError(
      400,
      "Edit fields without changing action identities or targets. Regenerate for different operations.",
    );
  const ordered = orderedActions(parsed);
  await transaction(async (db) => {
    await assertChangeSetAccess(s, db);
    const { rowCount } = await db.query(
      "UPDATE workspace_change_sets SET version=version+1,preview=NULL,updated_at=now() WHERE id=$1 AND owner_id=$2 AND version=$3 AND status='draft'",
      [id, user, version],
    );
    if (!rowCount)
      throw new HttpError(
        409,
        "The change set changed. Refresh before editing.",
      );
    for (const [i, a] of ordered.entries())
      await db.query(
        "UPDATE workspace_change_actions SET data=$3,position=$4,prepared=NULL,before_data=NULL,selected=false WHERE set_id=$1 AND key=$2",
        [s.id, a.key, JSON.stringify(a), i],
      );
  });
  return changeSetView(id, user);
}
export async function previewChangeSet(
  id: string,
  user: string,
  version: number,
  keys: string[],
) {
  const s = await loadChangeSet(id, user);
  if (s.status !== "draft" || s.version !== version)
    throw new HttpError(409, "Refresh this change set before reviewing.");
  const all = await query<ActionRow>(
    "SELECT * FROM workspace_change_actions WHERE set_id=$1 ORDER BY position",
    [id],
  );
  const selected = selectedActionKeys(
    all.map((a) => a.data),
    keys,
  );
  if (!selected.length) throw new HttpError(400, "Select at least one action.");
  const ids = Object.fromEntries(all.map((a) => [a.key, a.entity_id])),
    future = new Set(Object.values(ids));
  const prepared: { row: ActionRow; value: PreparedAction }[] = [];
  for (const row of all.filter((a) => selected.includes(a.key))) {
    const a = resolveActionReferences(row.data, ids);
    if (["file_create", "folder_create"].includes(a.action))
      a.payload.id = row.entity_id;
    prepared.push({
      row,
      value: await prepareAction(actorFor(s), a, row.id, future),
    });
  }
  const preview = {
    fingerprint: assistantHash({
      version,
      selected,
      prepared: prepared.map((p) => p.value),
    }),
    expiresAt: new Date(Date.now() + 900000).toISOString(),
    selected,
  };
  await transaction(async (db) => {
    await assertChangeSetAccess(s, db);
    const { rowCount } = await db.query(
      "UPDATE workspace_change_sets SET preview=$4,updated_at=now() WHERE id=$1 AND owner_id=$2 AND version=$3 AND status='draft'",
      [id, user, version, JSON.stringify(preview)],
    );
    if (!rowCount)
      throw new HttpError(409, "The draft changed while preparing review.");
    await db.query(
      "UPDATE workspace_change_actions SET selected=false WHERE set_id=$1",
      [id],
    );
    for (const { row, value } of prepared)
      await db.query(
        "UPDATE workspace_change_actions SET selected=true,prepared=$2,before_data=$3 WHERE id=$1",
        [row.id, JSON.stringify(value), JSON.stringify(value.before)],
      );
  });
  return changeSetView(id, user);
}
export async function approveChangeSet(
  id: string,
  user: string,
  fingerprint: string,
) {
  const s = await loadChangeSet(id, user);
  await transaction(async (db) => {
    await assertChangeSetAccess(s, db);
    const {
      rows: [current],
    } = await db.query<SetRow>(
      "SELECT * FROM workspace_change_sets WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (current.preview?.fingerprint !== fingerprint)
      throw new HttpError(409, "Approval does not match the exact preview.");
    if (["queued", "applying", "complete", "partial"].includes(current.status))
      return;
    if (
      current.status !== "draft" ||
      Date.parse(current.preview.expiresAt) <= Date.now()
    )
      throw new HttpError(409, "Review expired. Prepare a fresh preview.");
    await db.query(
      "UPDATE workspace_change_sets SET status='queued',approved_at=now(),updated_at=now() WHERE id=$1",
      [id],
    );
  });
  return changeSetView(id, user);
}
export async function cancelChangeSet(
  id: string,
  user: string,
  connectionId?: string,
) {
  await loadChangeSet(id, user, connectionId);
  await query(
    "UPDATE workspace_change_sets SET status=CASE WHEN approved_at IS NULL THEN 'cancelled' ELSE 'partial' END,error='Cancelled. Already completed changes remain.',updated_at=now() WHERE id=$1 AND status IN ('draft','queued','applying')",
    [id],
  );
  return changeSetView(id, user, connectionId);
}
async function actionAudit(s: SetRow, a: ActionRow) {
  const grant = s.connection_id
    ? await activeConnection(
        s.connection_id,
        s.owner_id,
        integrationActions.find((d) => d.name === a.data.action)?.scope ??
          "workspace:write",
        undefined,
        s.grant_version,
      )
    : undefined;
  return {
    actorId: s.owner_id,
    operationId: a.id,
    allowedSpaceIds: s.space_ids,
    assistantContextId: s.context_id,
    changeSetId: s.id,
    pluginGrantId: s.plugin_grant_id,
    pluginPackageHash: s.plugin_package_hash,
    pluginGrantRevision: s.plugin_grant_revision,
    ...(grant
      ? {
          integrationId: grant.id,
          integrationClient: grant.client_id,
          integrationScope:
            integrationActions.find((d) => d.name === a.data.action)?.scope ??
            "workspace:write",
          integrationVersion: grant.grant_version,
        }
      : {}),
  };
}
async function completeAction(db: PoolClient, a: ActionRow, result: unknown) {
  await db.query(
    "UPDATE workspace_change_actions SET state='complete',result=$2,error=NULL,completed_at=now() WHERE id=$1",
    [a.id, JSON.stringify(result)],
  );
}
/** One bounded unit per worker tick. Workspace services retain their own mutation receipts. */
export async function processChangeSet(execute: ActionExecutor) {
  const [schema] = await query(
    "SELECT to_regclass('public.workspace_change_sets') AS present",
  );
  if (!schema?.present) return false;
  // An unconfirmed nontransactional side effect is never automatically repeated.
  await query(
    "UPDATE workspace_change_sets SET status='partial',error='Processing was interrupted. Inspect completed results before preparing remaining actions.',updated_at=now() WHERE status='applying' AND lease_until<now()",
  );
  const s = await transaction(async (db) => {
    const {
      rows: [next],
    } = await db.query<SetRow>(
      "SELECT * FROM workspace_change_sets WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
    );
    if (!next) return null;
    await db.query(
      "UPDATE workspace_change_sets SET status='applying',lease_until=now()+interval '3 minutes' WHERE id=$1",
      [next.id],
    );
    return next;
  });
  if (!s) return false;
  let active: ActionRow[] = [];
  try {
    await assertChangeSetAccess(s);
    const rows = await query<ActionRow>(
      "SELECT * FROM workspace_change_actions WHERE set_id=$1 AND selected ORDER BY position",
      [s.id],
    );
    const pending = rows.filter((a) => a.state !== "complete");
    if (!pending.length) {
      await query(
        "UPDATE workspace_change_sets SET status='complete',updated_at=now() WHERE id=$1 AND status='applying'",
        [s.id],
      );
      return true;
    }
    active = [pending[0]];
    if (planningAction(pending[0].data.action)) {
      for (const a of pending.slice(1)) {
        if (
          !planningAction(a.data.action) ||
          a.data.spaceId !== pending[0].data.spaceId
        )
          break;
        active.push(a);
      }
    }
    for (const a of active) {
      if (a.state !== "pending" || !a.prepared)
        throw new HttpError(
          409,
          "An action needs a new review after interruption.",
        );
      await authorizeAction(actorFor(s), a.prepared.data);
      if (a.prepared.scopeVersion !== (await spaceAccessEpoch(a.data.spaceId)))
        throw new HttpError(
          409,
          "Workspace access changed after approval. Review again.",
        );
    }
    await withAuditContext(await actionAudit(s, active[0]), async () => {
      if (planningAction(active[0].data.action)) {
        await transaction(async (db) => {
          await assertChangeSetAccess(s, db);
          const {
            rows: [live],
          } = await db.query(
            "SELECT status FROM workspace_change_sets WHERE id=$1 FOR UPDATE",
            [s.id],
          );
          if (live?.status !== "applying")
            throw new HttpError(409, "Change set cancelled.");
          for (const a of active) {
            await installAuditContext(db, await actionAudit(s, a));
            const result = await applyPlanningAction(
              db,
              actorFor(s),
              { ...a.prepared!.data, payload: a.prepared!.payload },
              a.entity_id,
            );
            await completeAction(db, a, result);
          }
        });
      } else {
        const a = active[0],
          p = { ...a.prepared!.payload };
        delete p.previewSource;
        const claimed = await query(
          "UPDATE workspace_change_actions SET state='executing' WHERE id=$1 AND state='pending' AND EXISTS(SELECT 1 FROM workspace_change_sets WHERE id=$2 AND status='applying') RETURNING id",
          [a.id, s.id],
        );
        if (!claimed.length) throw new HttpError(409, "Change set cancelled.");
        const result = await execute(
          actorFor(s),
          { ...a.prepared!.data, payload: p },
          a.id,
          s.id,
        );
        await transaction((db) => completeAction(db, a, result));
      }
    });
    await query(
      "UPDATE workspace_change_sets SET status=CASE WHEN EXISTS(SELECT 1 FROM workspace_change_actions WHERE set_id=$1 AND selected AND state<>'complete') THEN 'queued' ELSE 'complete' END,updated_at=now() WHERE id=$1 AND status='applying'",
      [s.id],
    );
    await notifyWorkspace();
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "The action could not be completed.";
    await query(
      "UPDATE workspace_change_actions SET state=CASE WHEN state='executing' AND $3 THEN 'uncertain' ELSE 'failed' END,error=$2 WHERE id=ANY($1::uuid[]) AND state<>'complete'",
      [
        active.map((a) => a.id),
        message.slice(0, 2000),
        !(e instanceof HttpError && e.status < 500),
      ],
    );
    await query(
      "UPDATE workspace_change_sets SET status='partial',error=$2,updated_at=now() WHERE id=$1 AND status='applying'",
      [s.id, message.slice(0, 2000)],
    );
  }
  return true;
}

/** The sync server validates the approved command inside the same transaction as its journal. */
export async function assertReviewedDocumentCommand(
  db: PoolClient,
  input: { actorId: string; setId?: string; actionId?: string },
  command: unknown,
) {
  const {
    rows: [a],
  } = await db.query(
    "SELECT a.*,s.owner_id,s.connection_id,s.grant_version,s.space_ids,s.context_id,s.plugin_grant_id,s.plugin_package_hash,s.plugin_grant_revision,s.status AS set_status FROM workspace_change_actions a JOIN workspace_change_sets s ON s.id=a.set_id WHERE a.id=$1 AND s.id=$2 AND s.owner_id=$3 FOR SHARE OF s,a",
    [
      z.uuid().parse(input.actionId),
      z.uuid().parse(input.setId),
      input.actorId,
    ],
  );
  if (
    !a ||
    a.data.action !== "document_edit" ||
    !a.selected ||
    !["executing", "complete"].includes(a.state) ||
    !["applying", "complete", "partial"].includes(a.set_status)
  )
    throw new HttpError(403, "This document edit has not been approved.");
  const payload = { ...a.prepared.payload };
  delete payload.previewSource;
  if (assistantHash(payload) !== assistantHash(command))
    throw new HttpError(
      403,
      "Document edit differs from the reviewed command.",
    );
  await assertChangeSetAccess({ ...a, id: a.set_id }, db);
  return a;
}

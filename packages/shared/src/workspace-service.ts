import { createHash } from "node:crypto";
import type pg from "pg";
import { query, transaction } from "./db";
import { HttpError } from "./access";
import { currentAuditContext, installAuditContext } from "./audit-context";
import { roleAllows, type Capability, type ContentRole } from "./workspace";

export const workspaceJson = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
export async function requireScope(
  client: pg.PoolClient,
  userId: string,
  spaceId: string,
  capability: Capability = "read",
  allowInactive = false,
) {
  const integration = currentAuditContext();
  if (integration?.integrationId) {
    const {
      rows: [grant],
    } = await client.query(
      "SELECT space_ids FROM integration_connections WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL FOR SHARE",
      [integration.integrationId, userId],
    );
    if (!grant?.space_ids.includes(spaceId))
      throw new HttpError(
        403,
        "This workspace is outside the connected application's permissions.",
      );
  }
  // Membership/audience changes take FOR UPDATE on these same rows. KEY SHARE
  // fences access without deadlocking independent quota/metadata updates.
  await client.query("SELECT id FROM spaces WHERE id=$1 FOR KEY SHARE", [
    spaceId,
  ]);
  if (capability !== "read" && !allowInactive)
    await assertSpaceActive(client, spaceId);
  const {
    rows: [scope],
  } = await client.query<{ role: ContentRole; manage: boolean }>(
    "SELECT axiom_space_role($1,$2) AS role,axiom_manage_space($1,$2) AS manage",
    [userId, spaceId],
  );
  if (
    !scope ||
    (capability === "manage"
      ? !scope.manage
      : !roleAllows(scope.role, capability))
  )
    throw new HttpError(403, "Your access no longer allows this action.");
  return scope;
}
export async function assertSpaceActive(
  client: pg.PoolClient,
  spaceId: string,
) {
  const {
    rows: [space],
  } = await client.query(
    "SELECT axiom_space_state(id) AS state FROM spaces WHERE id=$1 FOR KEY SHARE",
    [spaceId],
  );
  if (!space || space.state !== "active")
    throw new HttpError(
      409,
      "This workspace is read-only or in trash. Restore it before making changes.",
    );
}
export async function assertGroupActive(
  client: pg.PoolClient,
  groupId: string,
) {
  const {
    rows: [space],
  } = await client.query(
    "SELECT id,lifecycle_status AS state FROM groups WHERE id=$1 FOR KEY SHARE",
    [groupId],
  );
  if (!space) throw new HttpError(404, "This group is unavailable.");
  if (space.state !== "active")
    throw new HttpError(
      409,
      "Restore this group in Group administration before making changes.",
    );
}
export async function requireNoteScope(
  client: pg.PoolClient,
  userId: string,
  noteId: string,
  capability: "edit" | "comment" | "read" = "edit",
) {
  const {
    rows: [resource],
  } = await client.query("SELECT space_id FROM resources WHERE note_id=$1", [
    noteId,
  ]);
  if (!resource) throw new HttpError(404, "This note is unavailable.");
  await requireScope(client, userId, resource.space_id, capability);
  const {
    rows: [locked],
  } = await client.query(
    "SELECT space_id FROM resources WHERE note_id=$1 FOR SHARE",
    [noteId],
  );
  if (!locked || locked.space_id !== resource.space_id)
    throw new HttpError(
      409,
      "This note moved to another workspace. Refresh before editing.",
    );
}
export async function noteWriteQuery(
  userId: string,
  noteId: string,
  sql: string,
  values: unknown[],
  capability: "edit" | "comment" = "edit",
  destinationId?: string,
) {
  return transaction(async (client) => {
    if (destinationId)
      await requireScope(client, userId, destinationId, capability);
    await requireNoteScope(client, userId, noteId, capability);
    return (await client.query(sql, values)).rows;
  });
}
/** Retry identity is bound to the operation and complete input, never just a UUID. */
export async function workspaceMutation<T>(
  userId: string,
  id: string,
  operation: string,
  input: unknown,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const fingerprint = createHash("sha256")
    .update(operation + JSON.stringify(input))
    .digest("hex");
  return transaction(async (client) => {
    await installAuditContext(client, {
      ...currentAuditContext(),
      actorId: userId,
      operationId: currentAuditContext()?.operationId ?? id,
    });
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      userId + id,
    ]);
    const {
      rows: [previous],
    } = await client.query(
      "SELECT fingerprint,result FROM workspace_mutations WHERE user_id=$1 AND id=$2",
      [userId, id],
    );
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new HttpError(
          409,
          "This retry identifier belongs to a different operation.",
        );
      return previous.result as T;
    }
    const result = await work(client);
    await client.query(
      "INSERT INTO workspace_mutations(user_id,id,fingerprint,result) VALUES($1,$2,$3,$4)",
      [userId, id, fingerprint, JSON.stringify(result)],
    );
    return result;
  });
}
export async function recordActivity(
  client: pg.PoolClient,
  input: {
    spaceId: string;
    userId: string;
    kind: string;
    title: string;
    resourceId?: string;
    taskId?: string;
  },
) {
  await client.query(
    "INSERT INTO workspace_activity(space_id,actor_id,kind,title,resource_id,task_id) VALUES($1,$2,$3,$4,$5,$6)",
    [
      input.spaceId,
      input.userId,
      input.kind,
      input.title.slice(0, 300),
      input.resourceId ?? null,
      input.taskId ?? null,
    ],
  );
}
export async function enqueueJob(
  kind: string,
  dedupe: string,
  payload: unknown,
  client?: pg.PoolClient,
) {
  const context = currentAuditContext();
  if (context?.integrationId && payload && typeof payload === "object")
    payload = { ...payload, integrationAudit: context };
  const sql =
    "INSERT INTO workspace_jobs(kind,dedupe_key,payload) VALUES($1,$2,$3) ON CONFLICT(dedupe_key) DO UPDATE SET status=CASE WHEN workspace_jobs.status='failed' THEN 'queued' ELSE workspace_jobs.status END,available_at=now(),updated_at=now() RETURNING id";
  return client
    ? (await client.query(sql, [kind, dedupe, JSON.stringify(payload)])).rows[0]
    : (await query(sql, [kind, dedupe, JSON.stringify(payload)]))[0];
}
export async function deliverEvent(
  client: pg.PoolClient,
  input: {
    userId: string;
    spaceId: string;
    kind: string;
    title: string;
    resourceId?: string;
    taskId?: string;
    dedupe: string;
  },
) {
  const {
    rows: [access],
  } = await client.query("SELECT axiom_space_role($1,$2) AS role", [
    input.userId,
    input.spaceId,
  ]);
  if (!access.role) return;
  const {
    rows: [settings],
  } = await client.query(
    "SELECT data FROM notification_preferences WHERE user_id=$1",
    [input.userId],
  );
  if (settings?.data?.[input.kind] === false) return;
  const {
    rows: [event],
  } = await client.query(
    "INSERT INTO inbox_events(user_id,space_id,kind,title,resource_id,task_id,dedupe_key) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id",
    [
      input.userId,
      input.spaceId,
      input.kind,
      input.title.slice(0, 300),
      input.resourceId ?? null,
      input.taskId ?? null,
      input.dedupe,
    ],
  );
  if (event && settings?.data?.email === true)
    await enqueueJob(
      "notification",
      "email:" + event.id,
      { id: event.id },
      client,
    );
}
export function assertRevision(actual: number, expected: number) {
  if (actual !== expected)
    throw new HttpError(
      409,
      "This item changed elsewhere. Your draft has been kept; refresh before applying it again.",
    );
}

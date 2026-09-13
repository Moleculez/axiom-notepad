import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { query, transaction } from "./db";
import { HttpError } from "./access";
import {
  lifecycleSpace,
  spaceImpact,
  transitionSpace,
} from "./space-lifecycle";
import { installAuditContext } from "./audit-context";
import { spaceLifecycleActions, type Space } from "./workspace";
import {
  workspaceJson as json,
  workspaceMutation,
  requireScope,
  recordActivity,
  enqueueJob,
} from "./workspace-service";
import { cleanupLock, deleteVersions } from "./resource-operations";
import { notifyWorkspace, flushPendingReferenceIndex } from "./documents";
import {
  trashComponents,
  trashSelectionSchema,
  type TrashItem,
  type TrashOperation,
} from "./trash";

const summary = `count(i.resource_id)::int AS total, count(*) FILTER(WHERE i.status='done')::int AS done,
 count(*) FILTER(WHERE i.status='pending')::int AS pending,count(*) FILTER(WHERE i.status='blocked')::int AS blocked,
 count(*) FILTER(WHERE i.status='skipped')::int AS skipped,count(*) FILTER(WHERE i.status='cancelled')::int AS cancelled,
 coalesce(sum(i.bytes),0)::float8 AS bytes`;
const visibleItem =
  "(axiom_base_space_role($2,coalesce((SELECT space_id FROM resources WHERE id=i.resource_id),i.space_id)) IS NOT NULL OR (i.kind='workspace' AND axiom_manage_space($2,i.space_id)))";

async function checkItems(
  client: PoolClient,
  operation: {
    action: string;
    user_id: string;
    restore_policy?: string;
    target_kind?: string;
    destination_id?: string | null;
    conflict_policy?: string;
  },
  items: TrashItem[],
  lock: boolean,
) {
  const reasons = new Map<
    string,
    { status: "blocked" | "skipped"; reason: string }
  >();
  const block = (
    id: string,
    reason: string,
    status: "blocked" | "skipped" = "blocked",
  ) => {
    if (!reasons.has(id)) reasons.set(id, { status, reason });
  };
  if (operation.target_kind === "workspaces") {
    for (const item of items) {
      try {
        const space = await lifecycleSpace(
          client,
          operation.user_id,
          item.space_id,
        );
        if (
          space.version !== item.version ||
          !["trashed", "purging"].includes(space.effective_status)
        ) {
          block(
            item.resource_id,
            "Workspace changed after preview. Create a new preview.",
            "skipped",
          );
        } else if (
          !space.lifecycle_actions.includes(
            operation.action as "purge" | "restore",
          )
        ) {
          block(
            item.resource_id,
            space.parent_status && space.parent_status !== "active"
              ? "Restore the parent group first."
              : "Your role no longer permits this workspace action.",
          );
        } else if (operation.action === "purge") {
          const impact = await spaceImpact(client, space);
          if (impact.blockers.length)
            block(
              item.resource_id,
              impact.blockers.map((b) => `${b.label}: ${b.count}`).join(". "),
            );
        }
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        block(
          item.resource_id,
          "Workspace unavailable with your current access.",
        );
      }
    }
    return reasons;
  }
  // Scope fences precede resource row locks; membership changes serialize here.
  for (const spaceId of [...new Set(items.map((i) => i.space_id))].sort()) {
    if (lock) {
      await client.query("SAVEPOINT trash_scope");
      try {
        const scope = await requireScope(
          client,
          operation.user_id,
          spaceId,
          operation.action === "purge" ? "manage" : "edit",
        );
        if (!scope.role)
          throw new HttpError(
            403,
            "Management permission does not grant access to private files.",
          );
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT trash_scope");
        if (!(error instanceof HttpError)) throw error;
        for (const item of items.filter((i) => i.space_id === spaceId))
          block(item.resource_id, error.message);
      }
      await client.query("RELEASE SAVEPOINT trash_scope");
    } else {
      const {
        rows: [scope],
      } = await client.query(
        "SELECT axiom_space_state($2) AS state,axiom_space_role($1,$2) AS role,axiom_manage_space($1,$2) AS manage",
        [operation.user_id, spaceId],
      );
      if (
        scope.state !== "active" ||
        (operation.action === "purge"
          ? !scope.manage || !scope.role
          : scope.role !== "editor")
      )
        for (const item of items.filter((i) => i.space_id === spaceId))
          block(
            item.resource_id,
            "This action requires an active workspace and the appropriate permissions.",
          );
    }
  }
  const ids = items.map((i) => i.resource_id);
  const { rows: current } = await client.query(
    `SELECT id,space_id,parent_id,deleted_at,version FROM resources WHERE id=ANY($1::uuid[]) ORDER BY id ${lock ? "FOR UPDATE" : ""}`,
    [ids],
  );
  const byId = new Map(current.map((i) => [i.id, i]));
  for (const item of items) {
    const row = byId.get(item.resource_id);
    if (
      !row ||
      !row.deleted_at ||
      row.version !== item.version ||
      row.space_id !== item.space_id ||
      row.parent_id !== item.parent_id ||
      new Date(row.deleted_at).getTime() !== new Date(item.deleted_at).getTime()
    )
      block(
        item.resource_id,
        "Changed, moved, restored or removed after preview. Create a new preview to include it.",
        "skipped",
      );
  }
  if (operation.action === "restore") {
    if (operation.destination_id) {
      const {
        rows: [destination],
      } = await client.query(
        `SELECT id,space_id,kind,deleted_at FROM resources WHERE id=$1 ${lock ? "FOR SHARE" : ""}`,
        [operation.destination_id],
      );
      if (
        !destination ||
        destination.kind !== "folder" ||
        destination.deleted_at ||
        items.some((i) => i.space_id !== destination.space_id)
      )
        for (const item of items)
          block(
            item.resource_id,
            "Choose an active folder in the same workspace, then create a new preview.",
          );
    } else if (operation.restore_policy === "retain") {
      // A retained/changed parent also retains its descendants. Repeat because
      // permissions or revision checks may have removed a parent from this batch.
      while (true) {
        const eligible = ids.filter((id) => !reasons.has(id));
        if (!eligible.length) break;
        const { rows: unavailable } = await client.query(
          `SELECT r.id FROM resources r WHERE r.id=ANY($1::uuid[]) AND EXISTS(
            WITH RECURSIVE parents AS (
              SELECT id,parent_id,deleted_at FROM resources WHERE id=r.parent_id
              UNION SELECT p.id,p.parent_id,p.deleted_at FROM resources p JOIN parents a ON p.id=a.parent_id
            ) SELECT 1 FROM parents WHERE deleted_at IS NOT NULL AND NOT(id=ANY($1::uuid[]))
          )`,
          [eligible],
        );
        if (!unavailable.length) break;
        for (const row of unavailable)
          block(
            row.id,
            "The original folder is still in Trash. Restore it first, or create a new preview choosing workspace root.",
          );
      }
    }
    return reasons;
  }
  if ((await client.query("SELECT 1 FROM document_updates LIMIT 1")).rowCount) {
    for (const item of items)
      block(
        item.resource_id,
        "Some edits are still synchronizing. Wait for Cloud saved, then retry cleanup.",
      );
    return reasons;
  }
  const { rows: protectedItems } = await client.query(
    `SELECT r.id, CASE
    WHEN EXISTS(SELECT 1 FROM review_requests WHERE note_id=r.note_id OR resource_id=r.id) THEN 'Formal review evidence must be retained.'
    WHEN EXISTS(SELECT 1 FROM upload_sessions WHERE (resource_id=r.id OR parent_id=r.id) AND status IN ('uploading','verifying','failed')) THEN 'Finish or cancel transfers targeting this item.'
    WHEN EXISTS(SELECT 1 FROM file_versions v JOIN paper_annotations a ON a.attachment_id=v.id WHERE v.resource_id=r.id AND NOT a.deleted) THEN 'This file has annotations.'
    WHEN EXISTS(SELECT 1 FROM file_versions v JOIN reading_items a ON a.target_id=v.id AND a.target_type='attachment' WHERE v.resource_id=r.id AND NOT a.deleted) THEN 'This file is in a reading list or bookmark.'
    WHEN EXISTS(SELECT 1 FROM file_versions v JOIN reference_attachments a ON a.attachment_id=v.id WHERE v.resource_id=r.id) THEN 'This file is attached to a research reference.'
    END AS reason FROM resources r WHERE r.id=ANY($1::uuid[])`,
    [ids],
  );
  for (const row of protectedItems) if (row.reason) block(row.id, row.reason);
  // Fixed point: keeping a note keeps every file referenced by its source or
  // snapshots; keeping a descendant also keeps the parent (no dangling tree).
  while (true) {
    const eligible = ids.filter((id) => !reasons.has(id));
    if (!eligible.length) break;
    const { rows } = await client.query(
      `SELECT r.id,CASE
      WHEN EXISTS(SELECT 1 FROM resources child WHERE child.parent_id=r.id AND NOT(child.id=ANY($1::uuid[]))) THEN 'A descendant is protected, restored or outside the frozen selection.'
      WHEN EXISTS(SELECT 1 FROM file_versions v JOIN resource_references rr ON rr.version_id=v.id WHERE v.resource_id=r.id AND NOT(rr.source_id=ANY($1::uuid[]))) THEN 'Referenced by a retained note or saved revision.'
      END AS reason FROM resources r WHERE r.id=ANY($1::uuid[])`,
      [eligible],
    );
    const found = rows.filter((r) => r.reason);
    if (!found.length) break;
    for (const row of found) block(row.id, row.reason);
  }
  return reasons;
}

async function report(userId: string, id: string, offset = 0) {
  const [operation] = await query<TrashOperation>(
    `SELECT o.*,${summary} FROM trash_operations o LEFT JOIN trash_operation_items i ON i.operation_id=o.id WHERE o.id=$1 AND o.user_id=$2 GROUP BY o.id`,
    [id, userId],
  );
  if (!operation) throw new HttpError(404, "Trash operation unavailable.");
  const items = await query(
    `SELECT i.*,i.bytes::float8 AS bytes,
    CASE WHEN ${visibleItem} THEN i.name ELSE 'Unavailable item' END AS name,
    CASE WHEN ${visibleItem} THEN i.original_path ELSE '' END AS original_path,
    CASE WHEN ${visibleItem} THEN i.reason ELSE 'Workspace access changed.' END AS reason
    FROM trash_operation_items i WHERE i.operation_id=$1 ORDER BY i.resource_id LIMIT 50 OFFSET $3`,
    [id, userId, offset],
  );
  return {
    operation,
    items,
    nextOffset:
      offset + items.length < operation.total ? offset + items.length : null,
  };
}

export async function trashApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  if (path[0] !== "trash") return null;
  const [, id, action] = path,
    method = request.method,
    url = new URL(request.url);
  if (id === "workspaces" && method === "GET") {
    const rows = await query<
      Space & { parent_id: string | null; resources: number; bytes: number }
    >(
      `SELECT s.*,coalesce(p.name,g.name,'Personal space') AS name,g.name AS group_name,m.role AS group_role,
       axiom_base_space_role($1,s.id) AS role,axiom_manage_space($1,s.id) AS can_manage,axiom_space_state(s.id) AS effective_status,
       parent.id AS parent_id,parent.status AS parent_status,
       (SELECT count(*)::int FROM resources r JOIN spaces own ON own.id=r.space_id WHERE own.id=s.id OR (s.kind='team' AND own.group_id=s.group_id)) AS resources,
       (SELECT coalesce(sum(a.bytes),0)::float8 FROM resources r JOIN spaces own ON own.id=r.space_id JOIN file_versions v ON v.resource_id=r.id JOIN attachments a ON a.id=v.id WHERE own.id=s.id OR (s.kind='team' AND own.group_id=s.group_id)) AS bytes
       FROM spaces s LEFT JOIN groups g ON g.id=s.group_id LEFT JOIN projects p ON p.id=s.project_id
       LEFT JOIN members m ON m.group_id=s.group_id AND m.user_id=$1
       LEFT JOIN spaces parent ON s.kind='project' AND parent.group_id=s.group_id AND parent.kind='team'
       WHERE axiom_space_state(s.id) IN ('trashed','purging') AND (axiom_base_space_role($1,s.id) IS NOT NULL OR axiom_manage_space($1,s.id))
       ORDER BY s.deleted_at DESC NULLS LAST,s.id`,
      [userId],
    );
    return json(
      rows.map((space) => ({
        ...space,
        lifecycle_actions: spaceLifecycleActions(space),
      })),
    );
  }
  if (id === "items" && method === "GET") {
    const spaces = z
      .array(z.uuid())
      .min(1)
      .max(500)
      .parse((url.searchParams.get("spaces") ?? "").split(","));
    const offset = z.coerce
        .number()
        .int()
        .min(0)
        .max(1000000)
        .parse(url.searchParams.get("offset") ?? 0),
      search = z
        .string()
        .max(200)
        .parse(url.searchParams.get("q") ?? ""),
      kind = z
        .enum(["", "note", "file", "folder", "shortcut"])
        .parse(url.searchParams.get("kind") ?? "");
    const after = z.iso
        .date()
        .optional()
        .parse(url.searchParams.get("after") ?? undefined),
      before = z.iso
        .date()
        .optional()
        .parse(url.searchParams.get("before") ?? undefined),
      parent = z
        .uuid()
        .optional()
        .parse(url.searchParams.get("parent") ?? undefined),
      tree = url.searchParams.get("tree") === "1",
      sort = z
        .enum(["deleted", "name", "size"])
        .parse(url.searchParams.get("sort") ?? "deleted"),
      direction = z
        .enum(["asc", "desc"])
        .parse(url.searchParams.get("direction") ?? "desc");
    const args = [
      userId,
      spaces,
      `%${search.replace(/[\\%_]/g, "\\$&")}%`,
      kind,
      after ?? null,
      before ?? null,
      parent ?? null,
      tree && !search && !kind && !after && !before,
    ];
    const where =
      "r.deleted_at IS NOT NULL AND r.space_id=ANY($2::uuid[]) AND axiom_space_role($1,r.space_id) IS NOT NULL AND r.name ILIKE $3 AND ($4='' OR r.kind=$4) AND ($5::date IS NULL OR r.deleted_at>=$5::date) AND ($6::date IS NULL OR r.deleted_at<$6::date+interval '1 day') AND (CASE WHEN $7::uuid IS NOT NULL THEN r.parent_id=$7 ELSE NOT $8::boolean OR NOT EXISTS(SELECT 1 FROM resources parent WHERE parent.id=r.parent_id AND parent.deleted_at IS NOT NULL) END)";
    const [items, [count]] = await Promise.all([
      query(
        `SELECT r.*,coalesce(r.deleted_actor_name,(SELECT name FROM "user" WHERE id=r.deleted_by)) AS deleted_by_name,
        EXISTS(SELECT 1 FROM resources c WHERE c.parent_id=r.id AND c.deleted_at IS NOT NULL) AS has_children,
        axiom_space_role($1,r.space_id)='editor' AND axiom_space_state(r.space_id)='active' AS can_restore,
        axiom_manage_space($1,r.space_id) AND axiom_space_state(r.space_id)='active' AS can_purge,
        coalesce(r.deleted_path,(WITH RECURSIVE ancestors AS (SELECT id,parent_id,name,1 AS depth FROM resources WHERE id=r.parent_id UNION ALL SELECT p.id,p.parent_id,p.name,a.depth+1 FROM resources p JOIN ancestors a ON p.id=a.parent_id) SELECT string_agg(name,' / ' ORDER BY depth DESC) FROM ancestors),'Workspace root') AS original_path,
        coalesce((SELECT sum(a.bytes)::float8 FROM attachments a JOIN file_versions v ON v.id=a.id WHERE v.resource_id=r.id),0) AS bytes
        FROM resources r WHERE ${where} ORDER BY ${sort === "name" ? "r.name" : sort === "size" ? "bytes" : "r.deleted_at"} ${direction},r.id LIMIT 50 OFFSET $9`,
        [...args, offset],
      ),
      query(
        `SELECT count(*)::int AS total FROM resources r WHERE ${where}`,
        args,
      ),
    ]);
    return json({
      items,
      total: count.total,
      nextOffset:
        offset + items.length < count.total ? offset + items.length : null,
    });
  }
  if (!id && method === "GET")
    return json(
      await query(
        `SELECT o.*,${summary} FROM trash_operations o LEFT JOIN trash_operation_items i ON i.operation_id=o.id WHERE o.user_id=$1 GROUP BY o.id ORDER BY o.created_at DESC LIMIT 30`,
        [userId],
      ),
    );
  if (id === "preview" && method === "POST") {
    const input = trashSelectionSchema.parse(await request.json());
    if (input.target === "workspaces") {
      const result = await workspaceMutation(
        userId,
        input.mutationId,
        "workspace-trash-preview",
        input,
        async (client) => {
          const opId = randomUUID();
          const requested = input.allMatching ? input.spaceIds : input.ids;
          const { rows: selected } = await client.query(
            `SELECT s.id FROM spaces s WHERE s.id=ANY($1::uuid[]) AND axiom_space_state(s.id) IN ('trashed','purging')
           AND (axiom_base_space_role($2,s.id) IS NOT NULL OR axiom_manage_space($2,s.id))
           AND NOT(s.kind='project' AND EXISTS(SELECT 1 FROM spaces parent WHERE parent.kind='team' AND parent.group_id=s.group_id AND parent.id=ANY($1::uuid[]))) ORDER BY s.id`,
            [requested, userId],
          );
          if (!selected.length)
            throw new HttpError(409, "No matching workspaces remain in Trash.");
          const items: TrashItem[] = [];
          for (const entry of selected) {
            const space = await lifecycleSpace(client, userId, entry.id),
              impact = await spaceImpact(client, space);
            items.push({
              resource_id: space.id,
              space_id: space.id,
              component_id: space.id,
              version: space.version,
              deleted_at: space.deleted_at ?? new Date().toISOString(),
              parent_id: null,
              kind: "workspace",
              note_id: null,
              name: space.name,
              original_path: `${space.kind === "team" ? "Group and included projects" : (space.group_name ?? "Project")} · ${impact.counts.resources} resources`,
              bytes: impact.counts.bytes,
              status: "pending",
              reason: null,
            });
          }
          await client.query(
            "INSERT INTO trash_operations(id,user_id,action,scope_ids,target_kind) VALUES($1,$2,$3,$4,'workspaces')",
            [opId, userId, input.action, items.map((i) => i.space_id)],
          );
          const reasons = await checkItems(
            client,
            {
              user_id: userId,
              action: input.action,
              target_kind: "workspaces",
            },
            items,
            false,
          );
          for (const item of items)
            await client.query(
              "INSERT INTO trash_operation_items(operation_id,resource_id,space_id,component_id,version,deleted_at,kind,name,original_path,bytes,status,reason) VALUES($1,$2,$2,$2,$3,$4,'workspace',$5,$6,$7,$8,$9)",
              [
                opId,
                item.space_id,
                item.version,
                item.deleted_at,
                item.name,
                item.original_path,
                item.bytes,
                reasons.get(item.resource_id)?.status ?? "pending",
                reasons.get(item.resource_id)?.reason ?? null,
              ],
            );
          return { id: opId };
        },
      );
      return json(await report(userId, result.id), 201);
    }
    const result = await workspaceMutation(
      userId,
      input.mutationId,
      "trash-preview",
      input,
      async (client) => {
        const opId = randomUUID();
        const { rows: items } = await client.query(
          `WITH RECURSIVE tree AS (
        SELECT r.* FROM resources r WHERE r.deleted_at IS NOT NULL AND r.space_id=ANY($1::uuid[]) AND axiom_space_role($2,r.space_id) IS NOT NULL
        AND (CASE WHEN $3::boolean THEN (r.name ILIKE $5 AND ($6='' OR r.kind=$6) AND ($7::date IS NULL OR r.deleted_at>=$7::date) AND ($8::date IS NULL OR r.deleted_at<$8::date+interval '1 day')) ELSE r.id=ANY($4::uuid[]) END)
        UNION SELECT r.* FROM resources r JOIN tree t ON r.parent_id=t.id WHERE r.deleted_at IS NOT NULL AND r.space_id=ANY($1::uuid[])
      ) SELECT t.id AS resource_id,t.space_id,t.parent_id,t.note_id,t.kind,t.name,t.version,t.deleted_at,
        coalesce((SELECT sum(bytes)::float8 FROM attachments a JOIN file_versions v ON v.id=a.id WHERE v.resource_id=t.id),0) AS bytes,
        coalesce(t.deleted_path,(WITH RECURSIVE ancestors AS (SELECT id,parent_id,name,1 AS depth FROM resources WHERE id=t.parent_id UNION ALL SELECT r.id,r.parent_id,r.name,a.depth+1 FROM resources r JOIN ancestors a ON r.id=a.parent_id) SELECT string_agg(name,' / ' ORDER BY depth DESC) FROM ancestors),'Workspace root') AS original_path
        FROM tree t ORDER BY t.id`,
          [
            input.spaceIds,
            userId,
            input.allMatching,
            input.ids,
            `%${input.q.replace(/[\\%_]/g, "\\$&")}%`,
            input.kind,
            input.after ?? null,
            input.before ?? null,
          ],
        );
        if (!items.length)
          throw new HttpError(
            409,
            "No matching Trash items remain in this scope.",
          );
        const ids = items.map((i) => i.resource_id);
        const { rows: refs } = await client.query(
          "SELECT rr.source_id,v.resource_id FROM resource_references rr JOIN file_versions v ON v.id=rr.version_id WHERE rr.source_id=ANY($1::uuid[]) AND v.resource_id=ANY($1::uuid[])",
          [ids],
        );
        const components = trashComponents(ids, [
          ...items
            .filter((i) => i.parent_id)
            .map((i) => [i.resource_id, i.parent_id] as [string, string]),
          ...refs.map((r) => [r.source_id, r.resource_id] as [string, string]),
        ]);
        await client.query(
          "INSERT INTO trash_operations(id,user_id,action,scope_ids,restore_policy,destination_id,conflict_policy) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            opId,
            userId,
            input.action,
            [...new Set(input.spaceIds)],
            input.restorePolicy,
            input.destinationId,
            input.conflictPolicy,
          ],
        );
        const reasons = await checkItems(
          client,
          {
            user_id: userId,
            action: input.action,
            restore_policy: input.restorePolicy,
            destination_id: input.destinationId,
            conflict_policy: input.conflictPolicy,
          },
          items,
          false,
        );
        await client.query(
          `INSERT INTO trash_operation_items(operation_id,resource_id,space_id,component_id,version,deleted_at,parent_id,kind,note_id,name,original_path,bytes,status,reason)
        SELECT $1,x.resource_id,x.space_id,x.component_id,x.version,x.deleted_at,x.parent_id,x.kind,x.note_id,x.name,x.original_path,x.bytes,x.status,x.reason FROM jsonb_to_recordset($2::jsonb)
        AS x(resource_id uuid,space_id uuid,component_id uuid,version int,deleted_at timestamptz,parent_id uuid,kind text,note_id uuid,name text,original_path text,bytes bigint,status text,reason text)`,
          [
            opId,
            JSON.stringify(
              items.map((i) => ({
                ...i,
                component_id: components.get(i.resource_id),
                status: reasons.get(i.resource_id)?.status ?? "pending",
                reason: reasons.get(i.resource_id)?.reason ?? null,
              })),
            ),
          ],
        );
        return { id: opId };
      },
    );
    return json(await report(userId, result.id), 201);
  }
  z.uuid().parse(id);
  if (method === "GET")
    return json(
      await report(
        userId,
        id,
        z.coerce
          .number()
          .int()
          .min(0)
          .parse(url.searchParams.get("offset") ?? 0),
      ),
    );
  if (
    method !== "POST" ||
    !["confirm", "cancel", "retry", "recheck"].includes(action)
  )
    throw new HttpError(405, "Unsupported Trash operation.");
  const input = z
    .object({ mutationId: z.uuid(), confirmation: z.string().optional() })
    .parse(await request.json());
  if (["confirm", "retry", "recheck"].includes(action)) {
    if (
      !(
        await query(
          "SELECT id FROM trash_operations WHERE id=$1 AND user_id=$2",
          [id, userId],
        )
      ).length
    )
      throw new HttpError(404, "Trash operation unavailable.");
    try {
      await flushPendingReferenceIndex();
    } catch {
      /* The reference guard below keeps every unresolved item safe. */
    }
  }
  await workspaceMutation(
    userId,
    input.mutationId,
    `trash:${id}:${action}`,
    input,
    async (client) => {
      const {
        rows: [op],
      } = await client.query(
        "SELECT * FROM trash_operations WHERE id=$1 AND user_id=$2 FOR UPDATE",
        [id, userId],
      );
      if (!op) throw new HttpError(404, "Trash operation unavailable.");
      if (action === "recheck") {
        if (op.status !== "preview")
          throw new HttpError(
            409,
            "Only an unused preview can be rechecked. Retry retained items after an operation finishes.",
          );
        const { rows: items } = await client.query<TrashItem>(
          "SELECT * FROM trash_operation_items WHERE operation_id=$1",
          [id],
        );
        const reasons = await checkItems(client, op, items, false);
        for (const item of items) {
          const reason = reasons.get(item.resource_id);
          await client.query(
            "UPDATE trash_operation_items SET status=$3,reason=$4 WHERE operation_id=$1 AND resource_id=$2",
            [
              id,
              item.resource_id,
              reason?.status ?? "pending",
              reason?.reason ?? null,
            ],
          );
        }
        return { ok: true };
      }
      if (action === "cancel") {
        if (op.status === "completed") return { ok: true };
        await client.query(
          "UPDATE trash_operation_items SET status='cancelled',reason='Cancelled before execution.' WHERE operation_id=$1 AND status='pending'",
          [id],
        );
        await client.query(
          "UPDATE trash_operations SET status='cancelled',updated_at=now() WHERE id=$1",
          [id],
        );
      } else {
        if (op.action === "purge" && input.confirmation !== "DELETE FOREVER")
          throw new HttpError(
            400,
            "Type DELETE FOREVER to confirm permanent deletion.",
          );
        if (action === "confirm" && op.status !== "preview")
          throw new HttpError(409, "This preview has already been used.");
        if (
          action === "retry" &&
          !["completed", "cancelled"].includes(op.status)
        )
          throw new HttpError(
            409,
            "Wait for the current operation to finish before retrying.",
          );
        if (action === "retry")
          await client.query(
            "UPDATE trash_operation_items SET status='pending',reason=NULL WHERE operation_id=$1 AND status IN ('blocked','cancelled')",
            [id],
          );
        await client.query(
          "UPDATE trash_operations SET status='queued',attempt=attempt+1,confirmed_at=coalesce(confirmed_at,now()),updated_at=now() WHERE id=$1",
          [id],
        );
        await enqueueJob(
          "trash-operation",
          `trash:${id}:${op.attempt + 1}`,
          { id },
          client,
        );
      }
      return { ok: true };
    },
  );
  return json(await report(userId, id));
}

/** Each component commits its result with the deletion. A lost worker lease can
 * never replay it; cancellation takes effect between atomic components. */
export async function processTrashOperation(
  id: string,
  job?: { id: string; lease: string },
) {
  try {
    await flushPendingReferenceIndex();
  } catch {
    /* Unindexed edits remain protected by checkItems. */
  }
  while (
    await transaction(async (client) => {
      if (
        job &&
        !(
          await client.query(
            "SELECT 1 FROM workspace_jobs WHERE id=$1 AND lease_id=$2 AND status='running' AND leased_until>now() FOR UPDATE",
            [job.id, job.lease],
          )
        ).rowCount
      )
        throw new Error(
          "Trash worker lease changed or expired; resume with a fresh lease.",
        );
      const {
        rows: [op],
      } = await client.query(
        "SELECT * FROM trash_operations WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!op || !["queued", "running"].includes(op.status)) return false;
      await installAuditContext(client, {
        actorId: op.user_id,
        operationId: id,
      });
      const {
        rows: [next],
      } = await client.query(
        "SELECT component_id FROM trash_operation_items WHERE operation_id=$1 AND status='pending' ORDER BY component_id LIMIT 1",
        [id],
      );
      if (!next) {
        await client.query(
          "UPDATE trash_operations SET status='completed',updated_at=now() WHERE id=$1",
          [id],
        );
        return false;
      }
      await client.query(
        "UPDATE trash_operations SET status='running',updated_at=now() WHERE id=$1",
        [id],
      );
      const { rows: items } = await client.query<TrashItem>(
        "SELECT * FROM trash_operation_items WHERE operation_id=$1 AND component_id=$2 AND status='pending' ORDER BY resource_id",
        [id, next.component_id],
      );
      // Match all file/reference mutation paths' global lock order. Pending CRDT
      // journals become per-item blockers, never a reason to weaken the guard.
      if (op.action === "purge")
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext('axiom:file-references'))",
        );
      if (op.action === "restore" && op.target_kind !== "workspaces")
        for (const spaceId of [...new Set(items.map((i) => i.space_id))].sort())
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
            spaceId,
          ]);
      const reasons = await checkItems(client, op, items, true);
      for (const [resourceId, reason] of reasons)
        await client.query(
          "UPDATE trash_operation_items SET status=$3,reason=$4 WHERE operation_id=$1 AND resource_id=$2",
          [id, resourceId, reason.status, reason.reason],
        );
      const eligible = items.filter((item) => !reasons.has(item.resource_id));
      if (op.target_kind === "workspaces") {
        for (const item of eligible) {
          await client.query("SAVEPOINT workspace_target");
          try {
            await transitionSpace(
              client,
              op.user_id,
              item.space_id,
              op.action,
              item.version,
              item.name,
            );
            await client.query(
              "UPDATE trash_operation_items SET status='done',reason=$3 WHERE operation_id=$1 AND resource_id=$2",
              [
                id,
                item.resource_id,
                op.action === "purge"
                  ? "Permanent deletion queued. Cancel from the workspace Lifecycle page within 30 seconds."
                  : null,
              ],
            );
          } catch (error) {
            await client.query("ROLLBACK TO SAVEPOINT workspace_target");
            if (!(error instanceof HttpError)) throw error;
            await client.query(
              "UPDATE trash_operation_items SET status='blocked',reason=$3 WHERE operation_id=$1 AND resource_id=$2",
              [id, item.resource_id, error.message],
            );
          }
          await client.query("RELEASE SAVEPOINT workspace_target");
        }
        return true;
      }
      if (eligible.length) {
        let ids = eligible.map((i) => i.resource_id);
        const notes = eligible.filter((i) => i.note_id).map((i) => i.note_id);
        await client.query(
          "SELECT set_config('axiom.resource_write','1',true)",
        );
        if (op.action === "purge") {
          await cleanupLock(client);
          const { rows: versions } = await client.query(
            "SELECT id FROM file_versions WHERE resource_id=ANY($1::uuid[])",
            [ids],
          );
          await client.query(
            "DELETE FROM resource_references WHERE source_id=ANY($1::uuid[])",
            [ids],
          );
          await client.query(
            "UPDATE resources SET current_version_id=NULL WHERE id=ANY($1::uuid[])",
            [ids],
          );
          await client.query(
            "UPDATE attachments SET note_id=NULL WHERE note_id=ANY($1::uuid[])",
            [notes],
          );
          await deleteVersions(
            client,
            versions.map((v) => v.id),
          );
          await client.query(
            "UPDATE upload_sessions SET parent_id=CASE WHEN parent_id=ANY($1::uuid[]) THEN NULL ELSE parent_id END,resource_id=CASE WHEN resource_id=ANY($1::uuid[]) THEN NULL ELSE resource_id END,completed_resource_id=CASE WHEN completed_resource_id=ANY($1::uuid[]) THEN NULL ELSE completed_resource_id END WHERE parent_id=ANY($1::uuid[]) OR resource_id=ANY($1::uuid[]) OR completed_resource_id=ANY($1::uuid[])",
            [ids],
          );
          await client.query(
            "DELETE FROM reading_items WHERE target_type='note' AND target_id=ANY($1::uuid[])",
            [notes],
          );
          await client.query("DELETE FROM notes WHERE id=ANY($1::uuid[])", [
            notes,
          ]);
          await client.query("DELETE FROM resources WHERE id=ANY($1::uuid[])", [
            ids,
          ]);
        } else {
          ids = await restoreItems(client, op, eligible);
        }
        await client.query(
          "UPDATE trash_operation_items SET status='done',reason=NULL WHERE operation_id=$1 AND resource_id=ANY($2::uuid[])",
          [id, ids],
        );
        for (const spaceId of [...new Set(eligible.map((i) => i.space_id))])
          await recordActivity(client, {
            userId: op.user_id,
            spaceId,
            kind: op.action === "purge" ? "purged" : "restore",
            title: `${op.action === "purge" ? "Permanently removed" : "Restored"} ${eligible.filter((i) => i.space_id === spaceId && ids.includes(i.resource_id)).length} Trash items`,
          });
      }
      return true;
    })
  ) {
    await notifyWorkspace(true);
  }
}

async function restoreItems(
  client: PoolClient,
  op: {
    id: string;
    destination_id: string | null;
    restore_policy: string;
    conflict_policy: string;
  },
  items: TrashItem[],
) {
  const byId = new Map(items.map((i) => [i.resource_id, i]));
  const depth = (item: TrashItem) => {
    let n = 0,
      parent = item.parent_id;
    const seen = new Set<string>();
    while (parent && byId.has(parent) && !seen.has(parent)) {
      seen.add(parent);
      n++;
      parent = byId.get(parent)!.parent_id;
    }
    return n;
  };
  const done: string[] = [];
  for (const spaceId of [...new Set(items.map((i) => i.space_id))].sort())
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [spaceId]);
  for (const item of [...items].sort(
    (a, b) => depth(a) - depth(b) || a.resource_id.localeCompare(b.resource_id),
  )) {
    let parentId = item.parent_id,
      name = item.name;
    if (op.destination_id && (!parentId || !byId.has(parentId)))
      parentId = op.destination_id;
    const {
      rows: [parent],
    } = await client.query(
      "SELECT deleted_at,kind,space_id FROM resources WHERE id=$1",
      [parentId],
    );
    if (parentId && (!parent || parent.deleted_at)) {
      if (op.restore_policy === "root" && !byId.has(parentId)) parentId = null;
      else {
        await client.query(
          "UPDATE trash_operation_items SET status='blocked',reason='The original parent was retained in Trash. Restore it first or choose an active destination.' WHERE operation_id=$1 AND resource_id=$2",
          [op.id, item.resource_id],
        );
        continue;
      }
    }
    const exists = async (candidate: string) =>
      (
        await client.query(
          "SELECT 1 FROM resources WHERE space_id=$1 AND parent_id IS NOT DISTINCT FROM $2::uuid AND name=$3 AND deleted_at IS NULL AND id<>$4 LIMIT 1",
          [item.space_id, parentId, candidate, item.resource_id],
        )
      ).rowCount;
    if (await exists(name)) {
      if (op.conflict_policy === "skip") {
        await client.query(
          "UPDATE trash_operation_items SET status='skipped',reason='An active item already uses this name. Choose Keep both in a new preview.' WHERE operation_id=$1 AND resource_id=$2",
          [op.id, item.resource_id],
        );
        continue;
      }
      const dot = item.kind === "file" ? name.lastIndexOf(".") : -1,
        extension = dot > 0 ? name.slice(dot) : "",
        stem = dot > 0 ? name.slice(0, dot) : name;
      let suffix = 2;
      do {
        name = `${stem.slice(0, Math.max(1, 185 - extension.length))} (${suffix++})${extension}`;
      } while (await exists(name));
    }
    await client.query(
      "UPDATE resources SET deleted_at=NULL,parent_id=$2,name=$3,version=version+1,updated_at=now() WHERE id=$1",
      [item.resource_id, parentId, name],
    );
    if (item.note_id)
      await client.query(
        "UPDATE notes SET deleted_at=NULL,title=$2,parent_id=(SELECT note_id FROM resources WHERE id=$3),version=version+1 WHERE id=$1",
        [item.note_id, name, parentId],
      );
    done.push(item.resource_id);
  }
  return done;
}

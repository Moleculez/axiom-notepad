import { randomUUID } from "node:crypto";
import { z } from "zod";
import type pg from "pg";
import { query, transaction } from "./db";
import { HttpError } from "./access";
import { flushNote, notifyWorkspace } from "./documents";
import {
  resourceNameSchema,
  spaceLifecycleActions,
  type Space,
  type SpaceLifecycleAction,
} from "./workspace";
import {
  assertRevision,
  workspaceMutation,
  workspaceJson,
  recordActivity,
  enqueueJob,
} from "./workspace-service";
import { deleteVersions } from "./resource-operations";

const mutation = z.object({
  mutationId: z.uuid().default(() => randomUUID()),
  version: z.number().int().positive(),
});
const spaceFields = `s.*,CASE WHEN s.kind='personal' THEN 'Personal space' WHEN s.kind='team' THEN g.name ELSE p.name END AS name,
 (SELECT parent.status FROM spaces parent WHERE s.kind='project' AND parent.kind='team' AND parent.group_id=s.group_id) AS parent_status,
 coalesce(p.description,g.description,'') AS description,g.name AS group_name,p.audience,p.color,p.timezone,p.version AS project_version,p.archived_at,m.role AS group_role,
 axiom_space_state(s.id) AS effective_status,axiom_space_role($1,s.id) AS role,axiom_manage_space($1,s.id) AS can_manage`;
const spaceJoin = `LEFT JOIN groups g ON g.id=s.group_id LEFT JOIN projects p ON p.id=s.project_id LEFT JOIN members m ON m.group_id=s.group_id AND m.user_id=$1`;
function decorate<T extends Space>(space: T) {
  return { ...space, lifecycle_actions: spaceLifecycleActions(space) };
}
export async function lifecycleSpace(
  client: pg.PoolClient,
  userId: string,
  id: string,
): Promise<Space> {
  const {
    rows: [space],
  } = await client.query<Space>(
    `SELECT ${spaceFields} FROM spaces s ${spaceJoin} WHERE s.id=$2 AND (axiom_base_space_role($1,s.id) IS NOT NULL OR axiom_manage_space($1,s.id))`,
    [userId, id],
  );
  if (!space) throw new HttpError(404, "This workspace is unavailable.");
  return decorate(space);
}
async function lockLifecycle(
  client: pg.PoolClient,
  userId: string,
  id: string,
) {
  const scope = await lifecycleSpace(client, userId, id);
  if (scope.kind === "personal")
    throw new HttpError(
      400,
      "Personal space is protected and cannot be archived or deleted.",
    );
  // Same parent-first ordering as ownership transfer. Lock all project spaces
  // with a team transition so uploads and CRDT writes cannot race its state.
  await client.query("SELECT id FROM groups WHERE id=$1 FOR NO KEY UPDATE", [
    scope.group_id,
  ]);
  await client.query(
    "SELECT id FROM spaces WHERE (id=$1 OR ($2='team' AND group_id=$3)) ORDER BY id FOR UPDATE",
    [id, scope.kind, scope.group_id],
  );
  return lifecycleSpace(client, userId, id);
}
async function scopeIds(client: pg.PoolClient, space: Space) {
  const { rows } = await client.query(
    "SELECT id,project_id FROM spaces WHERE id=$1 OR ($2='team' AND group_id=$3)",
    [space.id, space.kind, space.group_id],
  );
  return {
    spaces: rows.map((row) => row.id as string),
    projects: rows.flatMap((row) =>
      row.project_id ? [row.project_id as string] : [],
    ),
  };
}
export async function spaceImpact(client: pg.PoolClient, space: Space) {
  const scope = await scopeIds(client, space);
  const { rows: resources } = await client.query(
    "SELECT id,note_id,kind FROM resources WHERE space_id=ANY($1::uuid[])",
    [scope.spaces],
  );
  const ids = resources.map((row) => row.id as string),
    notes = resources.flatMap((row) =>
      row.note_id ? [row.note_id as string] : [],
    );
  const { rows: files } = await client.query(
    "SELECT v.id,a.bytes FROM file_versions v JOIN attachments a ON a.id=v.id WHERE v.resource_id=ANY($1::uuid[])",
    [ids],
  );
  const versions = files.map((row) => row.id as string);
  const {
    rows: [uses],
  } = await client.query(
    `SELECT
   (SELECT count(*)::int FROM review_requests WHERE note_id=ANY($1::uuid[]) OR resource_id=ANY($3::uuid[]) OR file_version_id=ANY($2::uuid[]) OR project_id=ANY($4::uuid[])) AS reviews,
   (SELECT count(*)::int FROM resource_references WHERE version_id=ANY($2::uuid[]) AND NOT(source_id=ANY($3::uuid[]))) AS external_files,
   (SELECT count(*)::int FROM note_links WHERE target_id=ANY($1::uuid[]) AND NOT(source_id=ANY($1::uuid[]))) AS external_notes,
   (SELECT count(*)::int FROM paper_annotations WHERE attachment_id=ANY($2::uuid[]) AND NOT deleted) AS annotations,
   (SELECT count(*)::int FROM reference_attachments WHERE attachment_id=ANY($2::uuid[])) AS citations,
   (SELECT count(*)::int FROM reading_items WHERE target_id=ANY($2::uuid[]) AND target_type='attachment' AND NOT deleted) AS reading,
   (SELECT count(*)::int FROM upload_sessions WHERE space_id=ANY($5::uuid[]) AND status IN ('uploading','verifying','failed')) AS transfers,
   (SELECT count(*)::int FROM workspace_exports WHERE space_id=ANY($5::uuid[]) AND status IN ('queued','running')) AS exports`,
    [notes, versions, ids, scope.projects, scope.spaces],
  );
  const labels: Record<string, string> = {
    reviews: "Retained formal reviews",
    external_files: "File references outside this workspace",
    external_notes: "Note links outside this workspace",
    annotations: "Retained paper annotations",
    citations: "Linked citation evidence",
    reading: "Files in reading records",
    transfers: "Unfinished uploads",
    exports: "Unfinished exports",
  };
  return {
    scope,
    ids,
    notes,
    versions,
    counts: {
      projects: scope.projects.length,
      resources: ids.length,
      notes: notes.length,
      files: resources.filter((row) => row.kind === "file").length,
      versions: versions.length,
      bytes: files.reduce((sum, row) => sum + Number(row.bytes), 0),
    },
    blockers: Object.entries(labels).flatMap(([key, label]) =>
      uses[key] ? [{ kind: key, label, count: Number(uses[key]) }] : [],
    ),
  };
}

/** Shared transition used by both space actions and the legacy project API. */
export async function transitionSpace(
  client: pg.PoolClient,
  userId: string,
  id: string,
  action: SpaceLifecycleAction,
  expectedVersion?: number,
  confirmation?: string,
) {
  const space = await lockLifecycle(client, userId, id);
  if (expectedVersion !== undefined)
    assertRevision(space.version, expectedVersion);
  if (!space.lifecycle_actions.includes(action))
    throw new HttpError(
      403,
      "Your role or the parent workspace state does not allow this action.",
    );
  if (["trash", "purge"].includes(action) && confirmation !== space.name)
    throw new HttpError(
      400,
      "Type the workspace name exactly to confirm this action.",
    );
  if (space.status === "purging" && action === "restore")
    await client.query(
      "UPDATE workspace_jobs SET status='done',lease_id=NULL,leased_until=NULL,error='Cancelled by the workspace owner',updated_at=now() WHERE dedupe_key=$1",
      ["purge-space:" + id],
    );
  let details: Record<string, unknown> = {};
  if (action === "purge") {
    const impact = await spaceImpact(client, space);
    if (impact.blockers.length)
      throw new HttpError(
        409,
        impact.blockers
          .map((item) => `${item.label}: ${item.count}`)
          .join(". ") + ". Nothing was permanently deleted.",
      );
    details = impact.counts;
  }
  await client.query(
    `UPDATE spaces SET status=CASE $2 WHEN 'archive' THEN 'archived' WHEN 'unarchive' THEN 'active' WHEN 'trash' THEN 'trashed' WHEN 'restore' THEN restore_state ELSE 'purging' END,
    restore_state=CASE WHEN $2='trash' THEN status ELSE restore_state END,
    deleted_at=CASE WHEN $2='trash' THEN now() WHEN $2='restore' THEN NULL ELSE deleted_at END,version=version+1 WHERE id=$1`,
    [id, action],
  );
  const current = await lifecycleSpace(client, userId, id);
  if (space.project_id)
    await client.query(
      "UPDATE projects SET archived_at=CASE WHEN $2='archived' THEN coalesce(archived_at,now()) ELSE NULL END,version=version+1 WHERE id=$1",
      [space.project_id, current.status],
    );
  if (["unarchive", "restore"].includes(action)) {
    const scope = await scopeIds(client, space);
    await client.query(
      "UPDATE task_recurrences r SET last_date=greatest(coalesce(last_date,DATE '0001-01-01'),(now() AT TIME ZONE p.timezone)::date) FROM projects p WHERE r.project_id=p.id AND r.project_id=ANY($1::uuid[])",
      [scope.projects],
    );
  }
  await client.query(
    "INSERT INTO space_lifecycle_events(space_id,group_id,actor_id,action,name,details) VALUES($1,$2,$3,$4,$5,$6)",
    [id, space.group_id, userId, action, space.name, JSON.stringify(details)],
  );
  await recordActivity(client, {
    spaceId: id,
    userId,
    kind: "workspace-" + action,
    title: `${action}: ${space.name}`,
  });
  if (action === "purge") {
    // A cancelled/failed attempt must never keep a later, explicitly confirmed
    // request stuck in a completed job or reuse its old revision/lease.
    const {
      rows: [job],
    } = await client.query(
      `INSERT INTO workspace_jobs(kind,dedupe_key,payload,available_at) VALUES('purge-space',$1,$2,now()+interval '30 seconds')
      ON CONFLICT(dedupe_key) DO UPDATE SET payload=excluded.payload,status='queued',attempts=0,lease_id=NULL,leased_until=NULL,error=NULL,available_at=excluded.available_at,updated_at=now() RETURNING id`,
      [
        "purge-space:" + id,
        JSON.stringify({ spaceId: id, userId, version: current.version }),
      ],
    );
    return { space: current, jobId: job.id };
  }
  return { space: current };
}

export async function spaceLifecycleApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  const [endpoint, id, action] = path;
  if (endpoint !== "spaces") return null;
  const url = new URL(request.url);
  if (request.method === "GET" && !id) {
    const state = z
      .enum(["all", "active", "archived", "trashed"])
      .parse(url.searchParams.get("state") ?? "all");
    const management = url.searchParams.get("manage") === "1";
    const summary = url.searchParams.get("summary") === "1";
    const rows = await query<Space>(
      `SELECT ${spaceFields}${summary ? ", (SELECT coalesce(sum(a.bytes),0)::float8 FROM resources r JOIN file_versions v ON v.resource_id=r.id JOIN attachments a ON a.id=v.id WHERE r.space_id=s.id) AS stored_bytes" : ""} FROM spaces s ${spaceJoin}
      WHERE (axiom_space_role($1,s.id) IS NOT NULL OR ($3 AND axiom_manage_space($1,s.id)))
      AND ($2='all' OR axiom_space_state(s.id)=$2 OR ($2='trashed' AND axiom_space_state(s.id)='purging'))
      ORDER BY CASE s.kind WHEN 'personal' THEN 0 WHEN 'team' THEN 1 ELSE 2 END,g.name,p.name`,
      [userId, state, management],
    );
    return workspaceJson(rows.map(decorate));
  }
  if (!id) return null;
  z.uuid().parse(id);
  if (request.method === "GET" && !action) {
    return workspaceJson(
      await transaction(async (client) => {
        const space = await lifecycleSpace(client, userId, id);
        const {
          rows: [counts],
        } = await client.query(
          `SELECT count(*)::int AS resources,count(*) FILTER(WHERE deleted_at IS NOT NULL)::int AS trash,
         count(*) FILTER(WHERE kind='note')::int AS notes,count(*) FILTER(WHERE kind='folder')::int AS folders,
         count(*) FILTER(WHERE kind='file')::int AS files FROM resources WHERE space_id=$1`,
          [id],
        );
        const {
          rows: [storage],
        } = await client.query(
          "SELECT coalesce(sum(a.bytes),0)::float8 AS bytes FROM resources r JOIN file_versions v ON v.resource_id=r.id JOIN attachments a ON a.id=v.id WHERE r.space_id=$1",
          [id],
        );
        const {
          rows: [parent],
        } = await client.query(
          "SELECT id FROM spaces WHERE kind='team' AND group_id=$1",
          [space.group_id],
        );
        return {
          space,
          counts: { ...counts, bytes: storage.bytes },
          parentId: space.kind === "project" ? parent?.id : null,
          capabilities: {
            readContent: !!space.role,
            editSettings:
              space.kind !== "personal" &&
              space.can_manage &&
              space.effective_status === "active",
            managePeople: space.can_manage,
            integrations: ["owner", "admin"].includes(space.group_role ?? ""),
            lifecycle: space.lifecycle_actions,
          },
        };
      }),
    );
  }
  if (request.method === "GET" && action === "lifecycle") {
    return workspaceJson(
      await transaction(async (client) => {
        const space = await lifecycleSpace(client, userId, id);
        if (!space.can_manage)
          throw new HttpError(403, "Workspace management access is required.");
        const impact = await spaceImpact(client, space);
        const {
          rows: [job],
        } = await client.query(
          "SELECT id,status,error,updated_at FROM workspace_jobs WHERE dedupe_key=$1",
          ["purge-space:" + id],
        );
        return {
          space,
          counts: impact.counts,
          blockers: impact.blockers,
          job: job ?? null,
          policy:
            "Trash has no expiry. Only the group owner can request reference-safe permanent removal.",
        };
      }),
    );
  }
  if (request.method === "PATCH" && !action) {
    const input = mutation
      .extend({
        name: resourceNameSchema,
        description: z.string().max(3000).optional(),
      })
      .parse(await request.json());
    const result = await workspaceMutation(
      userId,
      input.mutationId,
      "space-metadata:" + id,
      input,
      async (client) => {
        const space = await lockLifecycle(client, userId, id);
        if (!space.can_manage || space.effective_status !== "active")
          throw new HttpError(
            403,
            "Restore this workspace and use a manager account to change its settings.",
          );
        assertRevision(space.version, input.version);
        if (space.kind === "team")
          await client.query(
            "UPDATE groups SET name=$2,description=coalesce($3,description) WHERE id=$1",
            [space.group_id, input.name, input.description],
          );
        else
          await client.query(
            "UPDATE projects SET name=$2,description=coalesce($3,description),version=version+1 WHERE id=$1",
            [space.project_id, input.name, input.description],
          );
        await client.query("UPDATE spaces SET version=version+1 WHERE id=$1", [
          id,
        ]);
        await recordActivity(client, {
          spaceId: id,
          userId,
          kind: "workspace-settings",
          title: "Renamed workspace",
        });
        return lifecycleSpace(client, userId, id);
      },
    );
    await notifyWorkspace();
    return workspaceJson(result);
  }
  if (
    request.method === "POST" &&
    ["archive", "unarchive", "trash", "restore", "purge"].includes(action)
  ) {
    const input = mutation
      .extend({ confirmation: z.string().optional() })
      .parse(await request.json());
    const result = await workspaceMutation(
      userId,
      input.mutationId,
      "space-" + action + ":" + id,
      input,
      (client) =>
        transitionSpace(
          client,
          userId,
          id,
          action as SpaceLifecycleAction,
          input.version,
          input.confirmation,
        ),
    );
    await notifyWorkspace(true);
    return workspaceJson(result, action === "purge" ? 202 : 200);
  }
  return null;
}

/** Idempotent database removal, followed by recoverable/retryable blob cleanup.
 * No physical file is removed before all reference and ownership checks pass. */
export async function purgeSpace(id: string, userId: string, version: number) {
  z.uuid().parse(id);
  // Flush accepted CRDT updates after the workspace has become inaccessible.
  const pending = await query(
    "SELECT DISTINCT n.id,n.generation FROM notes n JOIN resources r ON r.note_id=n.id JOIN spaces s ON s.id=r.space_id JOIN document_updates u ON u.room=n.id::text||':'||n.generation::text WHERE s.id=$1 OR (s.group_id=(SELECT group_id FROM spaces WHERE id=$1 AND kind='team'))",
    [id],
  );
  for (const note of pending)
    await flushNote(note as { id: string; generation: number });
  await transaction(async (client) => {
    const {
      rows: [existing],
    } = await client.query("SELECT id FROM spaces WHERE id=$1", [id]);
    if (!existing) return;
    const space = await lockLifecycle(client, userId, id);
    if (space.status !== "purging" || space.group_role !== "owner")
      throw new HttpError(
        409,
        "Permanent deletion is no longer authorized. The workspace remains recoverable.",
      );
    assertRevision(space.version, version);
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('axiom:file-references'))",
    );
    if ((await client.query("SELECT 1 FROM document_updates LIMIT 1")).rowCount)
      throw new HttpError(
        409,
        "Edits are still synchronizing; permanent deletion will retry.",
      );
    const impact = await spaceImpact(client, space);
    if (impact.blockers.length)
      throw new HttpError(
        409,
        impact.blockers.map((item) => item.label).join("; "),
      );
    const { scope, ids, notes, versions } = impact;
    await client.query(
      "INSERT INTO space_tombstones(space_id,group_id,project_id,deleted_by,counts) SELECT id,group_id,project_id,$2,$3 FROM spaces WHERE id=ANY($1::uuid[]) ON CONFLICT DO NOTHING",
      [scope.spaces, userId, JSON.stringify(impact.counts)],
    );
    await client.query(
      "INSERT INTO space_lifecycle_events(space_id,group_id,actor_id,action,name,details) VALUES($1,$2,$3,'purged',$4,$5)",
      [id, space.group_id, userId, space.name, JSON.stringify(impact.counts)],
    );
    await client.query(
      "DELETE FROM resource_references WHERE source_id=ANY($1::uuid[])",
      [ids],
    );
    await client.query(
      "UPDATE resources SET current_version_id=NULL WHERE id=ANY($1::uuid[])",
      [ids],
    );
    // Old note_id is provenance, not ownership: moved files must survive.
    await client.query(
      "UPDATE attachments SET note_id=NULL WHERE note_id=ANY($1::uuid[])",
      [notes],
    );
    await deleteVersions(client, versions);
    const { rows: blobs } = await client.query(
      "SELECT storage_key::text AS key FROM workspace_exports WHERE space_id=ANY($1::uuid[]) AND storage_key IS NOT NULL UNION SELECT storage_key::text FROM upload_sessions WHERE space_id=ANY($1::uuid[])",
      [scope.spaces],
    );
    for (const blob of blobs)
      await enqueueJob(
        "delete-blob",
        "space-blob:" + id + ":" + blob.key,
        { key: blob.key },
        client,
      );
    await client.query(
      "DELETE FROM upload_sessions WHERE space_id=ANY($1::uuid[])",
      [scope.spaces],
    );
    await client.query(
      "DELETE FROM reading_items WHERE (target_type='note' AND target_id=ANY($1::uuid[])) OR group_id=ANY($2::uuid[])",
      [notes, scope.spaces],
    );
    await client.query("DELETE FROM notes WHERE id=ANY($1::uuid[])", [notes]);
    await client.query("DELETE FROM resources WHERE space_id=ANY($1::uuid[])", [
      scope.spaces,
    ]);
    if (space.kind === "team") {
      // Preserve citation metadata used by personal notes whose group provenance
      // will be detached by the FK; no personal Markdown or CRDT is changed.
      await client.query(
        "INSERT INTO personal_citations(note_id,cite_key,data) SELECT n.id,b.cite_key,to_jsonb(b) FROM notes n JOIN bibliography b ON b.group_id=n.group_id WHERE n.group_id=$1 AND n.visibility='private' ON CONFLICT DO NOTHING",
        [space.group_id],
      );
      await client.query("DELETE FROM reading_items WHERE group_id=$1", [
        space.group_id,
      ]);
      await client.query(
        "UPDATE tasks SET parent_id=NULL WHERE project_id=ANY($1::uuid[])",
        [scope.projects],
      );
      await client.query("DELETE FROM groups WHERE id=$1", [space.group_id]);
    } else {
      await client.query(
        "UPDATE tasks SET parent_id=NULL WHERE project_id=$1",
        [space.project_id],
      );
      await client.query("DELETE FROM projects WHERE id=$1", [
        space.project_id,
      ]);
    }
  });
  await notifyWorkspace(true);
}

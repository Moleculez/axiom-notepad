import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { HttpError } from "./access";
import { transaction } from "./db";
import {
  cleanupLock,
  deleteVersions,
  releaseUploadTargets,
} from "./resource-operations";
import { notifyWorkspace } from "./documents";
import {
  recordActivity,
  requireScope,
  workspaceMutation,
} from "./workspace-service";
import { trashProtectionTarget } from "./trash-protection";
import { trashQuickPurgeSchema, type TrashQuickPurgePlan } from "./trash";

/** This explicit override removes attachment retention, never note/revision
 * content. Normal Trash deletion still preserves all references. */
async function inspect(
  client: PoolClient,
  userId: string,
  operationId: string,
  resourceId: string,
  lock: boolean,
) {
  const resource = await trashProtectionTarget(
    client,
    userId,
    operationId,
    resourceId,
    lock,
  );
  if (resource.kind !== "file")
    throw new HttpError(
      400,
      "Quick purge is available for stored files only. Use ordinary Trash cleanup for notes and folders.",
    );
  if (lock) {
    await cleanupLock(client);
    // Fence annotation/link FK insertions while inspecting and purging. Reading
    // writes share the global file-reference lock because their target has no FK.
    await client.query(
      "SELECT a.id FROM attachments a JOIN file_versions v ON v.id=a.id WHERE v.resource_id=$1 ORDER BY a.id FOR UPDATE OF a",
      [resourceId],
    );
  }
  const { rows: versions } = await client.query(
    "SELECT v.id,a.bytes::float8 AS bytes FROM file_versions v JOIN attachments a ON a.id=v.id WHERE v.resource_id=$1 ORDER BY v.id",
    [resourceId],
  );
  const ids = versions.map((v) => v.id);
  const { rows: reading } = await client.query(
    `SELECT id,version,user_id,kind,target_id FROM reading_items WHERE target_type='attachment' AND target_id=ANY($1::uuid[]) AND NOT deleted ORDER BY id ${lock ? "FOR UPDATE" : ""}`,
    [ids],
  );
  const { rows: sources } = await client.query(
    `SELECT rr.id,rr.source_id,rr.snapshot_id,rr.suggestion_id,rr.decision_id,r.space_id,r.version,
     axiom_space_role($2,r.space_id)='editor' AND axiom_manage_space($2,r.space_id) AND axiom_space_state(r.space_id)='active' AS allowed
     FROM resource_references rr JOIN resources r ON r.id=rr.source_id WHERE rr.version_id=ANY($1::uuid[]) ORDER BY rr.id`,
    [ids, userId],
  );
  const { rows: references } = await client.query(
    `SELECT a.reference_id,a.attachment_id,b.space_id,b.version,
     axiom_space_role($2,b.space_id)='editor' AND axiom_space_state(b.space_id)='active' AS allowed
     FROM reference_attachments a JOIN bibliography b ON b.id=a.reference_id WHERE a.attachment_id=ANY($1::uuid[]) ORDER BY a.reference_id,a.attachment_id`,
    [ids, userId],
  );
  const {
    rows: [guards],
  } = await client.query(
    `SELECT
    EXISTS(SELECT 1 FROM paper_annotations WHERE attachment_id=ANY($2::uuid[]) AND NOT deleted) AS annotations,
    EXISTS(SELECT 1 FROM task_resources WHERE resource_id=$1) OR EXISTS(SELECT 1 FROM task_paper_links WHERE version_id=ANY($2::uuid[])) AS tasks,
    EXISTS(SELECT 1 FROM review_requests WHERE resource_id=$1 OR file_version_id=ANY($2::uuid[]) OR snapshot_id IN (SELECT snapshot_id FROM resource_references WHERE version_id=ANY($2::uuid[])) OR note_id IN (SELECT source_id FROM resource_references WHERE version_id=ANY($2::uuid[])) OR resource_id IN (SELECT source_id FROM resource_references WHERE version_id=ANY($2::uuid[]))) AS reviews,
    EXISTS(SELECT 1 FROM snippet_asset_references WHERE version_id=ANY($2::uuid[])) AS snippets,
    EXISTS(SELECT 1 FROM image_cloud_drafts WHERE base_version=ANY($2::uuid[]) OR previous_base_version=ANY($2::uuid[])) AS drafts,
    EXISTS(SELECT 1 FROM upload_sessions WHERE (resource_id=$1 OR parent_id=$1) AND status IN ('uploading','verifying','failed')) AS transfers,
    EXISTS(SELECT 1 FROM resources WHERE parent_id=$1) AS children,
    EXISTS(SELECT 1 FROM document_updates) AS syncing`,
    [resourceId, ids],
  );
  const blockers: string[] = [];
  if (
    !resource.can_manage ||
    resource.role !== "editor" ||
    resource.state !== "active"
  )
    blockers.push(
      "Editor and manager access to this active workspace is required.",
    );
  if (reading.some((r) => r.user_id !== userId))
    blockers.push(
      "Another reader's private bookmarks or reading data still protect this file.",
    );
  if (sources.some((r) => !r.allowed))
    blockers.push(
      "You need editor and manager access to every workspace whose notes or history retain this file.",
    );
  if (references.some((r) => !r.allowed))
    blockers.push(
      "You cannot detach a reference-library association outside your editing access.",
    );
  if (guards.annotations)
    blockers.push(
      "PDF annotations must be reviewed and removed in the reader first.",
    );
  if (guards.tasks) blockers.push("Unlink task evidence from its task first.");
  if (guards.reviews)
    blockers.push("Formal review evidence cannot be overridden here.");
  if (guards.snippets)
    blockers.push(
      "Remove this attachment from its reusable editor snippet first.",
    );
  if (guards.drafts)
    blockers.push("Finish or discard the image draft using this file first.");
  if (guards.transfers)
    blockers.push("Finish or cancel the upload targeting this file first.");
  if (guards.children)
    blockers.push("Move this item's children before purging it.");
  if (guards.syncing)
    blockers.push(
      "Save open notes and wait for synchronization to finish, then refresh this preview.",
    );
  const live = sources.filter(
    (r) => !r.snapshot_id && !r.suggestion_id && !r.decision_id,
  );
  const impacts = [
    {
      label: "Your bookmarks, reading-list entries and saved positions",
      count: reading.filter((r) => r.user_id === userId).length,
    },
    {
      label: "Current note attachment protections",
      count: live.filter((r) => r.allowed).length,
    },
    {
      label: "Saved revision, suggestion and undo attachment protections",
      count: sources.filter(
        (r) => r.allowed && (r.snapshot_id || r.suggestion_id || r.decision_id),
      ).length,
    },
    {
      label: "Reference-library file associations (references are kept)",
      count: references.filter((r) => r.allowed).length,
    },
    {
      label: "Stored file versions permanently deleted",
      count: versions.length,
    },
  ].filter((item) => item.count);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        userId,
        operationId,
        resourceId,
        version: resource.version,
        versions,
        reading,
        sources,
        references,
        guards,
      }),
    )
    .digest("hex");
  const plan: TrashQuickPurgePlan = {
    resourceId,
    name: resource.name,
    bytes: versions.reduce((n, v) => n + v.bytes, 0),
    fingerprint,
    canPurge: !blockers.length,
    breaksLinks: sources.some((r) => r.allowed),
    impacts,
    blockers,
  };
  return { plan, resource, ids, reading, sources, references };
}

export async function previewQuickPurge(
  userId: string,
  operationId: string,
  resourceId: string,
) {
  return transaction(
    async (client) =>
      (await inspect(client, userId, operationId, resourceId, false)).plan,
  );
}

export async function quickPurge(
  userId: string,
  operationId: string,
  resourceId: string,
  body: unknown,
) {
  const input = trashQuickPurgeSchema.parse(body);
  const result = await workspaceMutation(
    userId,
    input.mutationId,
    `trash-quick-purge:${operationId}:${resourceId}`,
    input,
    async (client) => {
      const current = await inspect(
        client,
        userId,
        operationId,
        resourceId,
        true,
      );
      if (!current.plan.canPurge)
        throw new HttpError(
          409,
          "Protection or access changed. Refresh the preview. Nothing was removed.",
        );
      if (input.fingerprint !== current.plan.fingerprint)
        throw new HttpError(
          409,
          "This file or its protection changed. Refresh and confirm the updated preview. Nothing was removed.",
        );
      if (current.plan.breaksLinks && !input.acknowledgeBrokenLinks)
        throw new HttpError(
          400,
          "Acknowledge that existing attachment links will stop working.",
        );
      for (const space of [
        ...new Set(current.sources.map((r) => r.space_id)),
      ].sort()) {
        const scope = await requireScope(client, userId, space, "manage");
        if (scope.role !== "editor")
          throw new HttpError(
            403,
            "Editing access to the retaining notes is required.",
          );
      }
      for (const space of [
        ...new Set(current.references.map((r) => r.space_id)),
      ].sort())
        await requireScope(client, userId, space, "edit");
      await client.query(
        "UPDATE reading_items SET deleted=true,version=version+1,mutation_id=$2,updated_at=now() WHERE id=ANY($1::uuid[])",
        [current.reading.map((r) => r.id), randomUUID()],
      );
      await client.query(
        "DELETE FROM resource_references WHERE version_id=ANY($1::uuid[])",
        [current.ids],
      );
      await client.query(
        "DELETE FROM reference_attachments WHERE attachment_id=ANY($1::uuid[])",
        [current.ids],
      );
      await client.query(
        "UPDATE bibliography SET version=version+1,updated_at=now() WHERE id=ANY($1::uuid[])",
        [[...new Set(current.references.map((r) => r.reference_id))]],
      );
      await client.query("SELECT set_config('axiom.resource_write','1',true)");
      await client.query(
        "UPDATE resources SET current_version_id=NULL WHERE id=$1",
        [resourceId],
      );
      await deleteVersions(client, current.ids);
      await releaseUploadTargets(client, [resourceId]);
      await client.query("DELETE FROM resources WHERE id=$1", [resourceId]);
      await client.query(
        "UPDATE trash_operation_items SET status='done',reason='Removed protection and permanently deleted after explicit confirmation.' WHERE operation_id=$1 AND resource_id=$2",
        [operationId, resourceId],
      );
      await client.query(
        "UPDATE trash_operations SET status=CASE WHEN NOT EXISTS(SELECT 1 FROM trash_operation_items WHERE operation_id=$1 AND status<>'done') THEN 'completed' ELSE status END,updated_at=now() WHERE id=$1",
        [operationId],
      );
      await recordActivity(client, {
        userId,
        spaceId: current.resource.space_id,
        kind: "purged",
        title: `Permanently deleted ${current.resource.name}; explicitly removed ${current.reading.length} reading records, ${current.sources.length} attachment protections and ${current.references.length} library links`,
      });
      return { purged: true, name: current.resource.name };
    },
  );
  await notifyWorkspace(true);
  return result;
}

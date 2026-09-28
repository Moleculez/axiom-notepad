import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { HttpError } from "./access";
import { transaction } from "./db";
import {
  requireScope,
  workspaceMutation,
  recordActivity,
} from "./workspace-service";
import { workspaceResearchRoute } from "./research-navigation";
import { trashReadingCleanupSchema, type TrashProtection } from "./trash";

/** Only an operation's owner may inspect its frozen targets. Resource access is
 * checked again: previews are not a capability to inspect a former workspace. */
export async function trashProtectionTarget(
  client: PoolClient,
  userId: string,
  operationId: string,
  resourceId: string,
  lock = false,
) {
  const {
    rows: [op],
  } = await client.query(
    `SELECT * FROM trash_operations WHERE id=$1 AND user_id=$2 ${lock ? "FOR UPDATE" : ""}`,
    [operationId, userId],
  );
  if (!op || op.target_kind !== "files" || op.action !== "purge")
    throw new HttpError(404, "File deletion preview unavailable.");
  if (lock && ["queued", "running"].includes(op.status))
    throw new HttpError(
      409,
      "Wait for the operation to finish before removing protection.",
    );
  const {
    rows: [item],
  } = await client.query(
    "SELECT * FROM trash_operation_items WHERE operation_id=$1 AND resource_id=$2",
    [operationId, resourceId],
  );
  if (!item) throw new HttpError(404, "This item is not in the preview.");
  if (lock) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('axiom:file-references'))",
    );
    const scope = await requireScope(client, userId, item.space_id, "manage");
    if (!scope.role) throw new HttpError(403, "File access is required.");
  }
  const {
    rows: [resource],
  } = await client.query(
    `SELECT r.*,axiom_space_role($2,r.space_id) AS role,
     axiom_manage_space($2,r.space_id) AS can_manage,axiom_space_state(r.space_id) AS state
     FROM resources r WHERE r.id=$1 ${lock ? "FOR UPDATE OF r" : ""}`,
    [resourceId, userId],
  );
  if (!resource?.role)
    throw new HttpError(404, "File unavailable with your current access.");
  const unchanged =
    resource.space_id === item.space_id &&
    resource.version === item.version &&
    resource.parent_id === item.parent_id &&
    resource.deleted_at &&
    new Date(resource.deleted_at).getTime() ===
      new Date(item.deleted_at).getTime();
  if (!unchanged)
    throw new HttpError(
      409,
      "This item changed after preview. Close this preview and select it again.",
    );
  return resource;
}

export async function trashProtection(
  userId: string,
  operationId: string,
  resourceId: string,
): Promise<TrashProtection> {
  return transaction(async (client) => {
    const resource = await trashProtectionTarget(
      client,
      userId,
      operationId,
      resourceId,
    );
    const { rows: reading } = await client.query(
      `SELECT a.id,a.version,a.kind,coalesce(a.data->>'label','') AS label FROM reading_items a
       JOIN file_versions v ON v.id=a.target_id WHERE v.resource_id=$1 AND a.target_type='attachment'
       AND a.user_id=$2 AND NOT a.deleted ORDER BY a.kind,a.id LIMIT 501`,
      [resourceId, userId],
    );
    const { rows: sources } = await client.query(
      `SELECT r.id,r.name,r.space_id,r.deleted_at IS NOT NULL AS deleted,
       bool_or(rr.snapshot_id IS NULL AND rr.suggestion_id IS NULL AND rr.decision_id IS NULL) AS current,
       bool_or(rr.snapshot_id IS NOT NULL OR rr.suggestion_id IS NOT NULL OR rr.decision_id IS NOT NULL) AS history
       FROM file_versions v JOIN resource_references rr ON rr.version_id=v.id JOIN resources r ON r.id=rr.source_id
       WHERE v.resource_id=$1 AND axiom_space_role($2,r.space_id) IS NOT NULL
       AND NOT EXISTS(SELECT 1 FROM trash_operation_items i WHERE i.operation_id=$3 AND i.resource_id=r.id AND i.status='pending')
       GROUP BY r.id ORDER BY r.name,r.id LIMIT 51`,
      [resourceId, userId, operationId],
    );
    const { rows: references } = await client.query(
      `SELECT DISTINCT b.id,b.cite_key AS name,b.space_id FROM reference_attachments a
       JOIN file_versions v ON v.id=a.attachment_id JOIN bibliography b ON b.id=a.reference_id
       WHERE v.resource_id=$1 AND axiom_space_role($2,b.space_id) IS NOT NULL ORDER BY b.cite_key,b.id LIMIT 51`,
      [resourceId, userId],
    );
    const {
      rows: [flags],
    } = await client.query(
      `SELECT
       EXISTS(SELECT 1 FROM file_versions v JOIN reading_items a ON a.target_id=v.id AND a.target_type='attachment' WHERE v.resource_id=$1 AND a.user_id<>$2 AND NOT a.deleted) AS other_reading,
       EXISTS(SELECT 1 FROM file_versions v JOIN resource_references rr ON rr.version_id=v.id JOIN resources r ON r.id=rr.source_id WHERE v.resource_id=$1 AND axiom_space_role($2,r.space_id) IS NULL) OR
       EXISTS(SELECT 1 FROM file_versions v JOIN reference_attachments a ON a.attachment_id=v.id JOIN bibliography b ON b.id=a.reference_id WHERE v.resource_id=$1 AND axiom_space_role($2,b.space_id) IS NULL) AS restricted,
       EXISTS(SELECT 1 FROM file_versions v JOIN paper_annotations a ON a.attachment_id=v.id WHERE v.resource_id=$1 AND NOT a.deleted) AS annotations,
       EXISTS(SELECT 1 FROM task_resources WHERE resource_id=$1) AS tasks,
       EXISTS(SELECT 1 FROM review_requests WHERE resource_id=$1 OR note_id=$3 OR file_version_id IN (SELECT id FROM file_versions WHERE resource_id=$1)) AS reviews,
       EXISTS(SELECT 1 FROM upload_sessions WHERE (resource_id=$1 OR parent_id=$1) AND status IN ('uploading','verifying','failed')) AS transfers,
       EXISTS(SELECT 1 FROM resources child WHERE child.parent_id=$1 AND NOT EXISTS(SELECT 1 FROM trash_operation_items i WHERE i.operation_id=$4 AND i.resource_id=child.id AND i.status='pending')) AS children,
       EXISTS(SELECT 1 FROM file_versions v JOIN snippet_asset_references a ON a.version_id=v.id WHERE v.resource_id=$1) AS snippets,
       EXISTS(SELECT 1 FROM file_versions v JOIN image_cloud_drafts d ON v.id=d.base_version OR v.id=d.previous_base_version WHERE v.resource_id=$1 AND d.resource_id<>$1) AS drafts,
       EXISTS(SELECT 1 FROM document_updates) AS syncing`,
      [resourceId, userId, resource.note_id, operationId],
    );
    const safeguards: TrashProtection["safeguards"] = [];
    if (flags.annotations)
      safeguards.push({
        label: "PDF annotations",
        description:
          "Restore the file to review its annotations. Trash never discards research annotations for you.",
      });
    if (flags.tasks)
      safeguards.push({
        label: "Task attachment",
        description: "Unlink this file from its task before deleting it.",
        href: `/workspaces/${resource.space_id}/planning`,
        action: "Open planning",
      });
    if (flags.reviews)
      safeguards.push({
        label: "Formal review evidence",
        description:
          "This file is part of a formal review and must be retained. Restore it or leave it in Trash.",
      });
    if (flags.transfers)
      safeguards.push({
        label: "Unfinished transfer",
        description:
          "Finish or cancel the upload targeting this item in Transfers before rechecking.",
      });
    if (flags.children)
      safeguards.push({
        label: "Folder contents",
        description:
          "A child is protected or outside this selection. Review its protection, or close this preview and select the whole folder again.",
      });
    if (flags.snippets)
      safeguards.push({
        label: "Reusable editor snippet",
        description:
          "An editor snippet still embeds this file. Remove that attachment from the snippet before rechecking.",
      });
    if (flags.drafts)
      safeguards.push({
        label: "Image editing draft",
        description:
          "Another image project has a draft based on this file. Finish or discard that draft in Image studio first.",
      });
    if (flags.syncing)
      safeguards.push({
        label: "Saved edits awaiting indexing",
        description:
          "Wait for open notes to show Cloud saved, then recheck. Rechecking indexes saved server edits; it does not upload unsaved changes from your devices.",
      });
    return {
      resourceId,
      name: resource.name,
      version: resource.version,
      canRestore: resource.role === "editor" && resource.state === "active",
      canClearReading: !!resource.can_manage && resource.state === "active",
      reading: reading.slice(0, 500),
      moreReading: reading.length > 500,
      otherReading: flags.other_reading,
      sources: sources.slice(0, 50).map((r) => ({
        id: r.id,
        name: r.name,
        current: r.current,
        history: r.history,
        deleted: r.deleted,
        href: r.deleted ? `/trash?space=${r.space_id}` : `/notes/${r.id}`,
      })),
      moreSources: sources.length > 50,
      restrictedSources: flags.restricted,
      references: references.slice(0, 50).map((r) => ({
        id: r.id,
        name: r.name,
        href: workspaceResearchRoute(r.space_id, {
          view: "library",
          reference: r.id,
        }),
      })),
      moreReferences: references.length > 50,
      safeguards,
    };
  });
}

export async function clearTrashReading(
  userId: string,
  operationId: string,
  resourceId: string,
  body: unknown,
) {
  const input = trashReadingCleanupSchema.parse(body);
  const result = await workspaceMutation(
    userId,
    input.mutationId,
    `trash-reading:${operationId}:${resourceId}`,
    input,
    async (client) => {
      const resource = await trashProtectionTarget(
        client,
        userId,
        operationId,
        resourceId,
        true,
      );
      // Share the normal reading writer's per-target locks. Explicit IDs and
      // revisions prevent clearing new bookmarks or edits made since review.
      const { rows: locks } = await client.query(
        `SELECT DISTINCT a.kind,a.target_id FROM reading_items a JOIN file_versions v ON v.id=a.target_id
       WHERE v.resource_id=$1 AND a.user_id=$2 AND a.target_type='attachment' ORDER BY a.kind,a.target_id`,
        [resourceId, userId],
      );
      for (const item of locks)
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          userId + item.kind + item.target_id,
        ]);
      const { rows: records } = await client.query(
        `SELECT a.* FROM reading_items a JOIN file_versions v ON v.id=a.target_id WHERE v.resource_id=$1
       AND a.user_id=$2 AND a.target_type='attachment' AND NOT a.deleted AND a.id=ANY($3::uuid[]) FOR UPDATE OF a`,
        [resourceId, userId, input.records.map((r) => r.id)],
      );
      const expectedVersions = new Map(
        input.records.map((r) => [r.id, r.version]),
      );
      if (
        records.length !== input.records.length ||
        records.some((r) => expectedVersions.get(r.id) !== r.version)
      )
        throw new HttpError(
          409,
          "Reading data changed. Refresh the protection details and review it again. Nothing was removed.",
        );
      await client.query(
        "UPDATE reading_items SET deleted=true,version=version+1,mutation_id=$2,updated_at=now() WHERE id=ANY($1::uuid[])",
        [records.map((r) => r.id), randomUUID()],
      );
      await recordActivity(client, {
        userId,
        spaceId: resource.space_id,
        resourceId,
        kind: "update",
        title: `Removed ${records.length} personal reading records from a trashed file`,
      });
      return { removed: records.length };
    },
  );
  return result;
}

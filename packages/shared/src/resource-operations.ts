import { randomUUID } from "node:crypto";
import { z } from "zod";
import type pg from "pg";
import { query, transaction } from "./db";
import { HttpError, fileAccess, resourceAccess } from "./access";
import {
  workspaceJson as json,
  workspaceMutation,
  requireScope,
  assertRevision,
  enqueueJob,
  recordActivity,
} from "./workspace-service";
import { reserveCapacity } from "./uploads-api";
import { notifyWorkspace } from "./documents";
import { removeAttachment } from "./storage";

const uuid = z.uuid();
const mutation = z.object({
  mutationId: uuid.default(() => randomUUID()),
  version: z.number().int().positive(),
});

async function fileUsage(
  client: pg.PoolClient,
  versions: string[],
  ignoredSources: string[] = [],
) {
  const {
    rows: [counts],
  } = await client.query(
    `SELECT
    (SELECT count(*)::int FROM resource_references WHERE version_id=ANY($1::uuid[]) AND NOT(source_id=ANY($2::uuid[]))) AS references,
    (SELECT count(*)::int FROM paper_annotations WHERE attachment_id=ANY($1::uuid[]) AND NOT deleted) AS annotations,
    (SELECT count(*)::int FROM reading_items WHERE target_type='attachment' AND target_id=ANY($1::uuid[]) AND NOT deleted) AS reading,
    (SELECT count(*)::int FROM reference_attachments WHERE attachment_id=ANY($1::uuid[])) AS citations,
    (SELECT count(*)::int FROM image_cloud_drafts d WHERE (base_version=ANY($1::uuid[]) OR previous_base_version=ANY($1::uuid[])) AND NOT(resource_id=ANY($2::uuid[]))) AS drafts,
    (SELECT count(*)::int FROM review_requests WHERE file_version_id=ANY($1::uuid[])) AS reviews`,
    [versions, ignoredSources],
  );
  return counts as {
    references: number;
    annotations: number;
    reading: number;
    citations: number;
  };
}
export async function cleanupLock(client: pg.PoolClient) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('axiom:file-references'))",
  );
  // A journaled CRDT update may not yet have its Markdown reference index. Do
  // not mistake that brief interval for proof that a file is unreferenced.
  if ((await client.query("SELECT 1 FROM document_updates LIMIT 1")).rowCount)
    throw new HttpError(
      409,
      "Some edits are still synchronizing. Wait for Cloud saved, then retry cleanup.",
    );
}
export async function deleteVersions(
  client: pg.PoolClient,
  versions: string[],
) {
  // Whole-project cleanup releases its own draft heads before deleting the
  // versions they pin. A single-version cleanup is guarded by fileUsage.
  await client.query(
    "DELETE FROM image_cloud_drafts d WHERE EXISTS(SELECT 1 FROM file_versions v WHERE v.resource_id=d.resource_id AND v.id=ANY($1::uuid[])) AND NOT EXISTS(SELECT 1 FROM file_versions v WHERE v.resource_id=d.resource_id AND NOT(v.id=ANY($1::uuid[])))",
    [versions],
  );
  const { rows: blobs } = await client.query(
    "SELECT storage_key::text AS key FROM attachments WHERE id=ANY($1::uuid[]) UNION SELECT storage_key::text FROM file_derivatives WHERE version_id=ANY($1::uuid[])",
    [versions],
  );
  await client.query("DELETE FROM file_versions WHERE id=ANY($1::uuid[])", [
    versions,
  ]);
  await client.query("DELETE FROM attachments WHERE id=ANY($1::uuid[])", [
    versions,
  ]);
  for (const blob of blobs)
    await enqueueJob(
      "delete-blob",
      "delete:" + blob.key + ":" + randomUUID(),
      { key: blob.key },
      client,
    );
}

/** Destruction is explicit, reference-aware, and separate from recoverable trash. */
export async function resourceOperationsApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  const [endpoint, id, action] = path;
  if (
    endpoint === "files" &&
    id &&
    action === "usage" &&
    request.method === "GET"
  ) {
    const { resource } = await resourceAccess(
      userId,
      uuid.parse(id),
      "read",
      true,
    );
    if (resource.kind !== "file")
      throw new HttpError(400, "Choose a stored file.");
    const versions = await query(
      "SELECT id FROM file_versions WHERE resource_id=$1",
      [id],
    );
    return json(
      await transaction(async (client) => {
        const counts = await fileUsage(
          client,
          versions.map((v) => v.id),
        );
        const { rows: sources } = await client.query(
          "SELECT DISTINCT r.id,r.name,rr.snapshot_id IS NOT NULL AS snapshot FROM resource_references rr JOIN resources r ON r.id=rr.source_id WHERE rr.version_id=ANY($2::uuid[]) AND axiom_space_role($1,r.space_id) IS NOT NULL ORDER BY r.name LIMIT 100",
          [userId, versions.map((v) => v.id)],
        );
        return {
          ...counts,
          sources,
          policy:
            "Current versions and versions used by notes, saved revisions, annotations, reading records or references cannot be removed.",
        };
      }),
    );
  }
  if (
    endpoint === "files" &&
    id &&
    ["restore-version", "purge-version"].includes(action) &&
    request.method === "POST"
  ) {
    const input = mutation
      .extend({ versionId: uuid, confirmation: z.string().optional() })
      .parse(await request.json());
    const { resource, space } = await fileAccess(
      userId,
      input.versionId,
      action === "purge-version" ? "manage" : "edit",
    );
    if (resource.id !== uuid.parse(id))
      throw new HttpError(404, "This version belongs to another file.");
    const result = await workspaceMutation(
      userId,
      input.mutationId,
      action + id,
      input,
      async (client) => {
        await cleanupLock(client);
        await requireScope(
          client,
          userId,
          space.id,
          action === "purge-version" ? "manage" : "edit",
        );
        const {
          rows: [current],
        } = await client.query(
          "SELECT * FROM resources WHERE id=$1 FOR UPDATE",
          [id],
        );
        assertRevision(current.version, input.version);
        const {
          rows: [file],
        } = await client.query(
          "SELECT a.* FROM attachments a JOIN file_versions v ON v.id=a.id WHERE v.id=$1 AND v.resource_id=$2",
          [input.versionId, id],
        );
        if (!file) throw new HttpError(404, "Version unavailable.");
        if (action === "purge-version") {
          if (input.confirmation !== "DELETE VERSION")
            throw new HttpError(
              400,
              "Type DELETE VERSION to confirm permanent removal.",
            );
          if (current.current_version_id === file.id)
            throw new HttpError(
              409,
              "The current version cannot be removed. Move the entire file to trash instead.",
            );
          const usage = await fileUsage(client, [file.id]);
          if (Object.values(usage).some(Boolean))
            throw new HttpError(
              409,
              "This version is still used by a note, saved revision, annotation, reading record or reference. Nothing was deleted.",
            );
          await deleteVersions(client, [file.id]);
        } else {
          if (current.deleted_at)
            throw new HttpError(409, "Restore this file from trash first.");
          // The resource lock also serializes image lease/head writes. A generic
          // file restore cannot capture a newer layered draft as Before restore.
          const {
            rows: [imageDraft],
          } = await client.query(
            "SELECT EXISTS(SELECT 1 FROM image_cloud_drafts WHERE resource_id=$1) OR EXISTS(SELECT 1 FROM image_edit_leases WHERE resource_id=$1 AND expires_at>now()) AS active",
            [id],
          );
          if (imageDraft.active)
            throw new HttpError(
              409,
              "This image has a working draft or an active editor. Restore it from Image Studio history to preserve the draft first.",
            );
          const { rows: derivatives } = await client.query(
            "SELECT * FROM file_derivatives WHERE version_id=$1",
            [file.id],
          );
          await reserveCapacity(
            client,
            space.id,
            Number(file.bytes) +
              derivatives.reduce((n, d) => n + Number(d.bytes), 0),
            false,
          );
          const newId = randomUUID();
          await client.query(
            "INSERT INTO attachments(id,name,mime,bytes,storage_key,sha256) VALUES($1,$2,$3,$4,$5,$6)",
            [
              newId,
              file.name,
              file.mime,
              file.bytes,
              file.storage_key,
              file.sha256,
            ],
          );
          await client.query(
            "INSERT INTO file_versions(id,resource_id,ordinal,created_by) SELECT $1,$2,coalesce(max(ordinal),0)+1,$3 FROM file_versions WHERE resource_id=$2",
            [newId, id, userId],
          );
          for (const derivative of derivatives)
            await client.query(
              "INSERT INTO file_derivatives(version_id,kind,storage_key,mime,bytes) VALUES($1,$2,$3,$4,$5)",
              [
                newId,
                derivative.kind,
                derivative.storage_key,
                derivative.mime,
                derivative.bytes,
              ],
            );
          await client.query(
            "UPDATE resources SET current_version_id=$2 WHERE id=$1",
            [id, newId],
          );
          if (file.mime.startsWith("image/"))
            await enqueueJob(
              "thumbnail",
              "thumbnail:" + newId,
              { versionId: newId },
              client,
            );
        }
        await client.query(
          "UPDATE resources SET version=version+1,updated_at=now() WHERE id=$1",
          [id],
        );
        await recordActivity(client, {
          spaceId: space.id,
          userId,
          kind: action,
          title: `${action === "purge-version" ? "Permanently removed an unused version of" : "Restored a version of"} ${resource.name}`,
          resourceId: id,
        });
        return { ok: true };
      },
    );
    await notifyWorkspace();
    return json(result);
  }
  if (
    endpoint === "resources" &&
    id &&
    action === "purge" &&
    request.method === "POST"
  ) {
    const input = mutation
      .extend({ confirmation: z.literal("DELETE FOREVER") })
      .parse(await request.json());
    const { resource, space } = await resourceAccess(
      userId,
      uuid.parse(id),
      "manage",
      true,
    );
    const result = await workspaceMutation(
      userId,
      input.mutationId,
      "purge:" + id,
      input,
      async (client) => {
        await cleanupLock(client);
        await requireScope(client, userId, space.id, "manage");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          space.id,
        ]);
        const {
          rows: [root],
        } = await client.query(
          "SELECT * FROM resources WHERE id=$1 FOR UPDATE",
          [id],
        );
        assertRevision(root.version, input.version);
        if (!root.deleted_at)
          throw new HttpError(
            409,
            "Move this item to trash before permanently removing it.",
          );
        const { rows: tree } = await client.query(
          "WITH RECURSIVE tree AS (SELECT id,kind,deleted_at FROM resources WHERE id=$1 UNION ALL SELECT r.id,r.kind,r.deleted_at FROM resources r JOIN tree t ON r.parent_id=t.id) SELECT * FROM tree LIMIT 1001",
          [id],
        );
        if (tree.length > 1000)
          throw new HttpError(
            409,
            "Clean up smaller subfolders first (up to 1,000 items per operation).",
          );
        if (tree.some((r) => !r.deleted_at))
          throw new HttpError(
            409,
            "This folder contains restored items. Move them out before cleanup.",
          );
        const ids = tree.map((r) => r.id),
          notes = tree.filter((r) => r.kind === "note").map((r) => r.id);
        if (
          (
            await client.query(
              "SELECT 1 FROM review_requests WHERE note_id=ANY($1::uuid[]) LIMIT 1",
              [notes],
            )
          ).rowCount
        )
          throw new HttpError(
            409,
            "This selection includes a formal review record. Keep it in trash to preserve the review evidence.",
          );
        if (
          (
            await client.query(
              "SELECT 1 FROM upload_sessions WHERE (parent_id=ANY($1::uuid[]) OR resource_id=ANY($1::uuid[])) AND status IN ('uploading','verifying','failed') LIMIT 1",
              [ids],
            )
          ).rowCount
        )
          throw new HttpError(
            409,
            "Cancel or finish transfers targeting this selection before cleanup.",
          );
        const { rows: versions } = await client.query(
          "SELECT id FROM file_versions WHERE resource_id=ANY($1::uuid[])",
          [ids],
        );
        const usage = await fileUsage(
          client,
          versions.map((v) => v.id),
          ids,
        );
        if (Object.values(usage).some(Boolean))
          throw new HttpError(
            409,
            "Files in this selection are still referenced outside it, annotated, or in a reading list. Nothing was deleted.",
          );
        await client.query(
          "DELETE FROM resource_references WHERE source_id=ANY($1::uuid[])",
          [ids],
        );
        await client.query(
          "UPDATE resources SET current_version_id=NULL WHERE id=ANY($1::uuid[])",
          [ids],
        );
        // The old attachment note_id is provenance, not ownership. Never let its
        // cascading FK remove a file that has since been moved elsewhere.
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
        await recordActivity(client, {
          spaceId: space.id,
          userId,
          kind: "purged",
          title: `Permanently removed ${resource.name} (${ids.length} items)`,
        });
        return { ok: true, removed: ids.length };
      },
    );
    await notifyWorkspace(true);
    return json(result);
  }
  return null;
}

/** A manual cleanup request queues this job; there is no automatic user-file GC. */
export async function deleteUnusedBlob(key: string) {
  uuid.parse(key);
  await transaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('axiom:blob-backup'))",
    );
    const {
      rows: [used],
    } = await client.query(
      "SELECT EXISTS(SELECT 1 FROM attachments WHERE storage_key=$1) OR EXISTS(SELECT 1 FROM file_derivatives WHERE storage_key=$1::uuid) OR EXISTS(SELECT 1 FROM user_profiles WHERE avatar_key=$1::uuid) OR EXISTS(SELECT 1 FROM workspace_exports WHERE storage_key=$1::uuid) OR EXISTS(SELECT 1 FROM upload_sessions WHERE storage_key=$1::uuid AND status IN ('uploading','verifying')) OR EXISTS(SELECT 1 FROM image_draft_assets WHERE storage_key=$1::uuid) AS present",
      [key],
    );
    if (used.present) return;
    try {
      await removeAttachment(key);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  });
}

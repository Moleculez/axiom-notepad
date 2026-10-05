import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { query, transaction } from "./db";
import { HttpError, spaceAccess } from "./access";
import {
  workspaceJson as json,
  requireScope,
  enqueueJob,
  recordActivity,
} from "./workspace-service";
import { reserveCapacity, uploadsApi } from "./uploads-api";
import {
  attachmentStream,
  clearUploadStaging,
  startMultipart,
} from "./storage-streams";
import { createNote, indexNote, notifyWorkspace } from "./documents";
import { lockImportUpload } from "./workspace-import-access";
import {
  validateImportManifest,
  planImport,
  decodeImportMarkdown,
  IMPORT_LIMITS,
  importPathKey,
  importName,
  canonicalImportJson,
  type ImportManifest,
  type ImportExisting,
  type WorkspaceImportPreview,
  type WorkspaceImportEntry,
  type WorkspaceImportBatch,
} from "./workspace-import";
import {
  rewriteImportLinks,
  type ImportLinkTarget,
} from "./workspace-import-links";

const uuid = z.uuid(),
  hash = (value: unknown) =>
    createHash("sha256").update(canonicalImportJson(value)).digest("hex");
type BatchRow = {
  id: string;
  owner_id: string;
  space_id: string;
  manifest: ImportManifest;
  manifest_hash: string;
  preview_hash: string;
  plan: WorkspaceImportEntry[];
  status: WorkspaceImportBatch["status"];
  error: string | null;
  expires_at: Date;
  result: WorkspaceImportBatch["result"];
};
const inputSchema = z
  .object({
    manifest: z.unknown(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    id: uuid,
  })
  .strict();
async function manifestInput(value: unknown) {
  try {
    return validateImportManifest(value);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : "Invalid import inventory.",
    );
  }
}
async function ownedBatch(
  userId: string,
  spaceId: string,
  id: string,
  client?: pg.PoolClient,
  lock = false,
) {
  const sql = `SELECT * FROM workspace_imports WHERE id=$1 AND space_id=$2 AND owner_id=$3${lock ? " FOR UPDATE" : ""}`;
  const rows = client
    ? (await client.query<BatchRow>(sql, [id, spaceId, userId])).rows
    : await query<BatchRow>(sql, [id, spaceId, userId]);
  if (!rows[0]) throw new HttpError(404, "Import unavailable.");
  return rows[0];
}
function activeBatch(batch: BatchRow) {
  if (
    new Date(batch.expires_at).valueOf() <= Date.now() ||
    ["complete", "cancelled"].includes(batch.status)
  )
    throw new HttpError(
      409,
      "This import has finished, expired or was cancelled.",
    );
}
/** Preview is SELECT-only. Traverse only existing folders that can be merged, not the whole workspace. */
async function previewImport(
  client: pg.PoolClient,
  userId: string,
  spaceId: string,
  manifest: ImportManifest,
  publishing = false,
): Promise<WorkspaceImportPreview> {
  await requireScope(client, userId, spaceId, "edit");
  const {
    rows: [space],
  } = await client.query(
    "SELECT s.*,p.audience FROM spaces s LEFT JOIN projects p ON p.id=s.project_id WHERE s.id=$1",
    [spaceId],
  );
  const { rows: ancestors } = manifest.parentId
    ? await client.query<
        ImportExisting & { space_id: string; deleted_at: Date | null }
      >(
        `WITH RECURSIVE parents AS (SELECT id,parent_id,name,kind,version,space_id,deleted_at,0 AS depth FROM resources WHERE id=$1
     UNION ALL SELECT r.id,r.parent_id,r.name,r.kind,r.version,r.space_id,r.deleted_at,p.depth+1 FROM resources r JOIN parents p ON r.id=p.parent_id WHERE p.depth<64)
     SELECT * FROM parents ORDER BY depth DESC`,
        [manifest.parentId],
      )
    : { rows: [] };
  if (
    manifest.parentId &&
    (!ancestors.length ||
      ancestors.some((r) => r.deleted_at || r.space_id !== spaceId) ||
      ancestors.at(-1)!.kind !== "folder")
  )
    throw new HttpError(
      409,
      "Choose a live folder in this workspace. The destination may have moved or been deleted.",
    );
  if (publishing && ancestors.length)
    await client.query(
      "SELECT id FROM resources WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE",
      [ancestors.map((a) => a.id)],
    );
  const existing: ImportExisting[] = [],
    parents = new Map<string, string | null>([["", manifest.parentId]]);
  let frontier: string[] = [""];
  for (
    let depth = 0;
    frontier.length && depth <= IMPORT_LIMITS.depth;
    depth++
  ) {
    const ids = [...new Set(frontier.map((path) => parents.get(path) ?? null))];
    const { rows } = await client.query<ImportExisting>(
      `SELECT id,parent_id,name,kind,version FROM resources WHERE space_id=$1 AND deleted_at IS NULL AND (parent_id=ANY($2::uuid[]) OR ($3 AND parent_id IS NULL)) ORDER BY id LIMIT 50001${publishing ? " FOR SHARE" : ""}`,
      [spaceId, ids.filter(Boolean), ids.includes(null)],
    );
    existing.push(...rows);
    if (existing.length > 50000)
      throw new HttpError(
        413,
        "This destination is too large to safely preview. Choose a smaller folder.",
      );
    const next: string[] = [];
    const index = new Map<string, ImportExisting[]>();
    for (const row of rows) {
      const key = `${row.parent_id ?? ""}:${importPathKey(row.name)}`,
        matches = index.get(key);
      if (matches) matches.push(row);
      else index.set(key, [row]);
    }
    if (manifest.conflict === "merge")
      for (const entry of manifest.entries.filter(
        (e) =>
          e.kind === "folder" &&
          frontier.includes(e.path.split("/").slice(0, -1).join("/")),
      )) {
        const parentPath = entry.path.split("/").slice(0, -1).join("/");
        const matches =
          index.get(
            `${parents.get(parentPath) ?? ""}:${importPathKey(importName(entry.path, "folder"))}`,
          ) ?? [];
        if (matches.length === 1 && matches[0].kind === "folder") {
          parents.set(entry.path, matches[0].id);
          next.push(entry.path);
        }
      }
    frontier = next;
  }
  const entries = planImport(manifest, existing),
    created = entries.filter((e) => e.disposition === "create");
  return {
    entries,
    fingerprint: hash({
      manifest,
      entries,
      existing,
      ancestors,
      scope: {
        id: space.id,
        kind: space.kind,
        group: space.group_id,
        project: space.project_id,
        audience: space.audience,
      },
    }),
    destination: {
      spaceId,
      spaceName: space.name,
      audience:
        space.kind === "personal"
          ? "Only you"
          : space.audience === "restricted"
            ? "Workspace members"
            : "Group members",
      breadcrumbs: ancestors.map(({ id, name }) => ({ id, name })),
    },
    counts: {
      notes: created.filter((e) => e.kind === "note").length,
      files: created.filter((e) => e.kind === "file").length,
      folders: created.filter((e) => e.kind === "folder").length,
      skipped: entries.filter((e) => e.disposition === "skip").length,
      conflicts: entries.filter((e) => e.conflict).length,
      bytes: created.reduce((sum, e) => sum + e.bytes, 0),
    },
  };
}
async function allocateEntries(
  client: pg.PoolClient,
  batch: BatchRow,
  entries: WorkspaceImportEntry[],
) {
  const { rows: allocated } = await client.query<{ import_entry_id: string }>(
    "SELECT import_entry_id FROM upload_sessions WHERE import_entry_id IN (SELECT id FROM workspace_import_entries WHERE batch_id=$1)",
    [batch.id],
  );
  const present = new Set(allocated.map((u) => u.import_entry_id));
  const needed = entries.filter(
    (e) =>
      e.kind !== "folder" && e.disposition === "create" && !present.has(e.id),
  );
  await reserveCapacity(
    client,
    batch.space_id,
    needed.reduce((sum, e) => sum + e.bytes, 0),
  );
  for (const entry of needed)
    await client.query(
      "INSERT INTO upload_sessions(id,owner_id,space_id,name,bytes,storage_key,import_entry_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$1,$7)",
      [
        entry.id,
        batch.owner_id,
        batch.space_id,
        entry.path.split("/").at(-1),
        entry.bytes,
        randomUUID(),
        batch.expires_at,
      ],
    );
}
async function serializeBatch(batch: BatchRow): Promise<WorkspaceImportBatch> {
  const rows = await query<{
      id: string;
      status: string;
      error: string;
      received: string;
    }>(
      "SELECT u.id,u.status,u.error,coalesce((SELECT sum(bytes) FROM upload_chunks WHERE upload_id=u.id),0) AS received FROM upload_sessions u JOIN workspace_import_entries e ON e.id=u.import_entry_id WHERE e.batch_id=$1",
      [batch.id],
    ),
    uploads = new Map(rows.map((u) => [u.id, u]));
  return {
    id: batch.id,
    spaceId: batch.space_id,
    source: batch.manifest.source,
    parentId: batch.manifest.parentId,
    conflict: batch.manifest.conflict,
    status: batch.status,
    error: batch.error,
    expiresAt: batch.expires_at.toISOString(),
    result: batch.result,
    entries: batch.plan.map((entry) => {
      const u = uploads.get(entry.id);
      return {
        ...entry,
        uploadId: u?.id,
        status: u?.status ?? "ready",
        received: Number(u?.received ?? 0),
        error: u?.error,
      };
    }),
  };
}
export async function workspaceImportApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  const [endpoint, spaceId, category, id, action, entryId, transfer, part] =
    path;
  if (endpoint === "me" && spaceId === "imports" && request.method === "GET") {
    const batches = await query<BatchRow>(
      "SELECT * FROM workspace_imports WHERE owner_id=$1 AND (status NOT IN ('complete','cancelled') OR axiom_space_role($1,space_id)='editor') ORDER BY CASE WHEN status IN ('preparing','publishing','blocked') THEN 0 ELSE 1 END,created_at DESC LIMIT 30",
      [userId],
    );
    const compact = new URL(request.url).searchParams.get("compact") === "1";
    return json(
      await Promise.all(
        batches.map(async (batch) => {
          const value = await serializeBatch(batch);
          if (!compact) return value;
          const { result: _result, ...poll } = value;
          return {
            ...poll,
            entries: value.entries.map(({ id, status, received, error }) => ({
              id,
              status,
              received,
              error,
            })),
          };
        }),
      ),
    );
  }
  if (endpoint !== "spaces" || category !== "imports") return null;
  uuid.parse(spaceId);
  // An owner may discard their private preparation even after access is revoked.
  if (id && action === "cancel" && request.method === "POST") {
    const batch = await ownedBatch(userId, spaceId, uuid.parse(id));
    await cancelWorkspaceImport(batch.id, userId);
    return json(await serializeBatch(await ownedBatch(userId, spaceId, id)));
  }
  if (id && !action && request.method === "GET") {
    const batch = await ownedBatch(userId, spaceId, uuid.parse(id));
    // Preparation belongs to its author. Retain recovery/cancellation access,
    // but completed receipts still require current destination edit permission.
    if (["complete", "cancelled"].includes(batch.status))
      await spaceAccess(userId, spaceId, "edit");
    return json(await serializeBatch(batch));
  }
  await spaceAccess(userId, spaceId, "edit");
  if (!id && request.method === "GET") {
    const batches = await query<BatchRow>(
      "SELECT * FROM workspace_imports WHERE owner_id=$1 AND space_id=$2 ORDER BY created_at DESC LIMIT 30",
      [userId, spaceId],
    );
    return json(await Promise.all(batches.map(serializeBatch)));
  }
  if (id === "preview" && request.method === "POST") {
    const manifest = await manifestInput(await request.json());
    return json(
      await transaction((client) =>
        previewImport(client, userId, spaceId, manifest),
      ),
    );
  }
  if (!id && request.method === "POST") {
    const input = inputSchema.parse(await request.json()),
      manifest = await manifestInput(input.manifest),
      fingerprint = hash(manifest);
    const batch = await transaction(async (client) => {
      await requireScope(client, userId, spaceId, "edit");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "import:" + input.id,
      ]);
      const {
        rows: [prior],
      } = await client.query<BatchRow>(
        "SELECT * FROM workspace_imports WHERE id=$1",
        [input.id],
      );
      if (prior) {
        if (
          prior.owner_id !== userId ||
          prior.space_id !== spaceId ||
          prior.manifest_hash !== fingerprint
        )
          throw new HttpError(
            409,
            "This import identity belongs to a different selection.",
          );
        return prior;
      }
      const preview = await previewImport(client, userId, spaceId, manifest);
      const {
        rows: [occupied],
      } = await client.query(
        "SELECT EXISTS(SELECT 1 FROM resources WHERE id=ANY($1::uuid[])) OR EXISTS(SELECT 1 FROM upload_sessions WHERE id=ANY($1::uuid[])) OR EXISTS(SELECT 1 FROM workspace_import_entries WHERE id=ANY($1::uuid[])) AS present",
        [manifest.entries.map((e) => e.id)],
      );
      if (occupied.present)
        throw new HttpError(
          409,
          "These entry identities have already been used. Select the collection again to start a new import.",
        );
      if (preview.fingerprint !== input.fingerprint)
        throw new HttpError(
          409,
          "The destination changed. Refresh the preview before importing.",
        );
      const {
        rows: [created],
      } = await client.query<BatchRow>(
        "INSERT INTO workspace_imports(id,owner_id,space_id,manifest,manifest_hash,preview_hash,plan) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [
          input.id,
          userId,
          spaceId,
          JSON.stringify(manifest),
          fingerprint,
          preview.fingerprint,
          JSON.stringify(preview.entries),
        ],
      );
      for (const entry of manifest.entries)
        await client.query(
          "INSERT INTO workspace_import_entries(id,batch_id,path,kind,digest) VALUES($1,$2,$3,$4,$5)",
          [entry.id, input.id, entry.path, entry.kind, entry.digest],
        );
      await allocateEntries(client, created, preview.entries);
      await queueReadyWorkspaceImport(client, created.id);
      return created;
    });
    return json(await serializeBatch(batch), 201);
  }
  uuid.parse(id);
  const batch = await ownedBatch(userId, spaceId, id);
  if (action === "recheck" && request.method === "POST") {
    const input = z
      .object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(await request.json());
    await transaction(async (client) => {
      await requireScope(client, userId, spaceId, "edit");
      const current = await ownedBatch(userId, spaceId, id, client, true);
      activeBatch(current);
      if (current.status === "publishing")
        throw new HttpError(409, "Publication is already queued.");
      const preview = await previewImport(
        client,
        userId,
        spaceId,
        current.manifest,
      );
      if (preview.fingerprint !== input.fingerprint)
        throw new HttpError(
          409,
          "The destination changed again. Refresh the preview.",
        );
      await allocateEntries(client, current, preview.entries);
      await client.query(
        "UPDATE workspace_imports SET plan=$2,preview_hash=$3,status='preparing',error=NULL,updated_at=now() WHERE id=$1",
        [id, JSON.stringify(preview.entries), preview.fingerprint],
      );
      await queueReadyWorkspaceImport(client, id);
    });
    return json(await serializeBatch(await ownedBatch(userId, spaceId, id)));
  }
  if (action === "finalize" && request.method === "POST") {
    await transaction(async (client) => {
      await requireScope(client, userId, spaceId, "edit");
      const current = await ownedBatch(userId, spaceId, id, client, true);
      if (["complete", "publishing"].includes(current.status)) return;
      activeBatch(current);
      if (current.status === "blocked")
        throw new HttpError(
          409,
          "Review the destination and recheck this import first.",
        );
      const {
        rows: [pending],
      } = await client.query(
        "SELECT count(*)::int AS count FROM upload_sessions WHERE id=ANY($1::uuid[]) AND status<>'staged'",
        [
          current.plan
            .filter((e) => e.disposition === "create" && e.kind !== "folder")
            .map((e) => e.id),
        ],
      );
      if (pending.count)
        throw new HttpError(
          409,
          "Some files are not ready. Resume or retry their transfers first.",
        );
      await client.query(
        "UPDATE workspace_imports SET status='publishing',error=NULL,updated_at=now() WHERE id=$1",
        [id],
      );
      await enqueueJob("finalize-import", "import:" + id, { id }, client);
    });
    return json(
      await serializeBatch(await ownedBatch(userId, spaceId, id)),
      202,
    );
  }
  if (action === "entries" && entryId) {
    uuid.parse(entryId);
    if (
      !batch.plan.some(
        (e) =>
          e.id === entryId && e.disposition === "create" && e.kind !== "folder",
      )
    )
      throw new HttpError(404, "Import entry unavailable.");
    const [upload] = await query(
      "SELECT * FROM upload_sessions WHERE import_entry_id=$1 AND owner_id=$2",
      [entryId, userId],
    );
    if (!upload) throw new HttpError(404, "Import transfer unavailable.");
    if (transfer === "prepare" && request.method === "POST") {
      await transaction(async (client) => {
        await lockImportUpload(
          client,
          upload as Parameters<typeof lockImportUpload>[1],
        );
        const {
          rows: [current],
        } = await client.query(
          "SELECT * FROM upload_sessions WHERE id=$1 FOR UPDATE",
          [upload.id],
        );
        if (["staged", "verifying"].includes(current.status)) return;
        if (current.status === "cancelled")
          throw new HttpError(409, "This transfer was cancelled.");
        if (
          !current.multipart_id &&
          process.env.STORAGE_DRIVER === "s3" &&
          Number(current.bytes) > 0
        ) {
          const multipartId = await startMultipart(
            current.storage_key,
            current.id,
          );
          await client.query(
            "UPDATE upload_sessions SET multipart_id=$2 WHERE id=$1",
            [current.id, multipartId],
          );
        } else if (process.env.STORAGE_DRIVER !== "s3")
          await startMultipart(current.storage_key, current.id);
        await client.query(
          "UPDATE upload_sessions SET status='uploading',error=NULL,updated_at=now() WHERE id=$1",
          [current.id],
        );
      });
      return json({ ok: true });
    }
    if (
      (transfer === "chunks" && request.method === "PUT") ||
      (transfer === "complete" && request.method === "POST") ||
      (!transfer && request.method === "GET")
    )
      return uploadsApi(
        request,
        ["uploads", upload.id, transfer, part],
        userId,
        entryId,
      );
  }
  throw new HttpError(404, "Import operation unavailable.");
}

/** The user's confirmed batch is a publication intent, surviving page/worker restarts. */
export async function queueReadyWorkspaceImport(
  client: pg.PoolClient,
  id: string,
) {
  const {
    rows: [batch],
  } = await client.query<BatchRow>(
    "SELECT * FROM workspace_imports WHERE id=$1 FOR UPDATE",
    [id],
  );
  if (!batch || batch.status !== "preparing") return;
  const ids = batch.plan
    .filter((e) => e.kind !== "folder" && e.disposition === "create")
    .map((e) => e.id);
  const {
    rows: [pending],
  } = await client.query(
    "SELECT count(*)::int AS count FROM unnest($1::uuid[]) AS targets(entry_id) LEFT JOIN upload_sessions u ON u.id=targets.entry_id WHERE u.status IS DISTINCT FROM 'staged'",
    [ids],
  );
  if (pending.count) return;
  await client.query(
    "UPDATE workspace_imports SET status='publishing',updated_at=now() WHERE id=$1",
    [id],
  );
  await enqueueJob("finalize-import", "import:" + id, { id }, client);
}

async function importSource(key: string, expectedBytes: number) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of await attachmentStream(key)) {
    const value = Buffer.from(chunk);
    bytes += value.length;
    if (bytes > expectedBytes || bytes > IMPORT_LIMITS.markdownBytes)
      throw new HttpError(413, "Markdown exceeds its allocated size.");
    chunks.push(value);
  }
  if (bytes !== expectedBytes)
    throw new HttpError(409, "The prepared Markdown file changed.");
  try {
    return decodeImportMarkdown(Buffer.concat(chunks));
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
}
export async function validateStagedMarkdown(key: string, bytes: number) {
  await importSource(key, bytes);
}

/** Single commit publishes the entire hierarchy, documents, file versions, indexes and receipt. */
export async function finishWorkspaceImport(id: string) {
  const [found] = await query<BatchRow>(
    "SELECT * FROM workspace_imports WHERE id=$1",
    [id],
  );
  if (!found || ["complete", "cancelled"].includes(found.status)) return;
  try {
    await transaction(async (client) => {
      await requireScope(client, found.owner_id, found.space_id, "edit");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        found.space_id,
      ]);
      const batch = await ownedBatch(
        found.owner_id,
        found.space_id,
        id,
        client,
        true,
      );
      if (["complete", "cancelled"].includes(batch.status)) return;
      activeBatch(batch);
      if (batch.status !== "publishing")
        throw new HttpError(
          409,
          "This import needs an explicit review before publication.",
        );
      const preview = await previewImport(
        client,
        batch.owner_id,
        batch.space_id,
        batch.manifest,
        true,
      );
      if (preview.fingerprint !== batch.preview_hash)
        throw new HttpError(
          409,
          "The destination changed while files were preparing. Review and recheck; your prepared files are retained.",
        );
      await reserveCapacity(client, batch.space_id, 0, false);
      const {
        rows: [space],
      } = await client.query("SELECT * FROM spaces WHERE id=$1", [
        batch.space_id,
      ]);
      const { rows: uploads } = await client.query(
        "SELECT u.*,e.mime,e.sha256 AS verified_sha256 FROM upload_sessions u JOIN workspace_import_entries e ON e.id=u.import_entry_id WHERE e.batch_id=$1 ORDER BY u.id FOR UPDATE OF u",
        [id],
      );
      const byId = new Map(uploads.map((u) => [u.id, u])),
        targets = new Map<string, ImportLinkTarget>(),
        bodies = new Map<string, string>(),
        warnings: string[] = [];
      for (const entry of batch.plan.filter(
        (e) => e.disposition === "create" && e.kind !== "folder",
      )) {
        const upload = byId.get(entry.id);
        if (!upload || upload.status !== "staged")
          throw new HttpError(
            409,
            "An import transfer is not ready. Resume it before publishing.",
          );
        targets.set(importPathKey(entry.path), {
          kind: entry.kind as "note" | "file",
          id: entry.id,
        });
        if (entry.kind === "note")
          bodies.set(
            entry.id,
            await importSource(upload.storage_key, Number(upload.bytes)),
          );
      }
      const resources: NonNullable<
        WorkspaceImportBatch["result"]
      >["resources"] = [];
      for (const entry of batch.plan.filter(
        (e) => e.disposition === "create",
      )) {
        if (entry.kind === "note") {
          const rewritten = rewriteImportLinks(
            bodies.get(entry.id)!,
            entry.path,
            targets,
          );
          if (rewritten.body.length > IMPORT_LIMITS.noteChars)
            throw new HttpError(
              413,
              "Rewritten Markdown exceeds the note size limit.",
            );
          bodies.set(entry.id, rewritten.body);
          warnings.push(...rewritten.warnings);
          await createNote(
            {
              id: entry.id,
              groupId: space.group_id,
              projectId: space.project_id,
              userId: batch.owner_id,
              title: entry.name,
              visibility: space.kind === "personal" ? "private" : "shared",
              body: rewritten.body,
            },
            client,
          );
          await client.query("UPDATE resources SET parent_id=$2 WHERE id=$1", [
            entry.id,
            entry.parentId,
          ]);
        } else {
          await client.query(
            "INSERT INTO resources(id,space_id,parent_id,kind,name,owner_id) VALUES($1,$2,$3,$4,$5,$6)",
            [
              entry.id,
              batch.space_id,
              entry.parentId,
              entry.kind,
              entry.name,
              batch.owner_id,
            ],
          );
          if (entry.kind === "file") {
            const upload = byId.get(entry.id)!;
            await client.query(
              "INSERT INTO attachments(id,name,mime,bytes,storage_key,sha256) VALUES($1,$2,$3,$4,$5,$6)",
              [
                entry.id,
                entry.name,
                upload.mime,
                upload.bytes,
                upload.storage_key,
                upload.verified_sha256,
              ],
            );
            await client.query(
              "INSERT INTO file_versions(id,resource_id,ordinal,created_by) VALUES($1,$1,1,$2)",
              [entry.id, batch.owner_id],
            );
            await client.query(
              "UPDATE resources SET current_version_id=$1 WHERE id=$1",
              [entry.id],
            );
            if (upload.mime.startsWith("image/"))
              await enqueueJob(
                "thumbnail",
                "thumbnail:" + entry.id,
                { versionId: entry.id },
                client,
              );
          }
        }
        resources.push({
          id: entry.id,
          kind: entry.kind,
          name: entry.name,
          parentId: entry.parentId,
        });
      }
      for (const [noteId, body] of bodies)
        await indexNote(`${noteId}:1`, body, client);
      for (const upload of uploads) {
        const published = resources.find((r) => r.id === upload.id);
        await client.query(
          "UPDATE upload_sessions SET status='complete',completed_resource_id=$2,completed_version_id=$3,error=NULL,updated_at=now() WHERE id=$1",
          [
            upload.id,
            published?.id ?? null,
            published?.kind === "file" ? upload.id : null,
          ],
        );
        if (published?.kind !== "file")
          await enqueueJob(
            "delete-blob",
            "import-source:" + upload.id,
            { key: upload.storage_key },
            client,
          );
      }
      await client.query(
        "UPDATE workspace_imports SET status='complete',result=$2,error=NULL,updated_at=now() WHERE id=$1",
        [id, JSON.stringify({ resources, warnings: warnings.slice(0, 2000) })],
      );
      await recordActivity(client, {
        spaceId: batch.space_id,
        userId: batch.owner_id,
        kind: "imported",
        title: `Imported ${resources.length} items (${bodies.size} Markdown notes)`,
        resourceId: resources[0]?.id,
      });
    });
    await notifyWorkspace();
  } catch (error) {
    if (error instanceof HttpError)
      await blockWorkspaceImport(id, error.message);
    throw error;
  }
}
export async function blockWorkspaceImport(id: string, message: string) {
  await query(
    "UPDATE workspace_imports SET status='blocked',error=$2,updated_at=now() WHERE id=$1 AND status NOT IN ('complete','cancelled')",
    [id, message.slice(0, 500)],
  );
}
export async function cancelWorkspaceImport(id: string, ownerId?: string) {
  const uploads = await transaction(async (client) => {
    const {
      rows: [batch],
    } = await client.query<BatchRow>(
      "SELECT * FROM workspace_imports WHERE id=$1 AND ($2::text IS NULL OR owner_id=$2) FOR UPDATE",
      [id, ownerId ?? null],
    );
    if (!batch || batch.status === "complete") return [];
    await client.query(
      "UPDATE workspace_imports SET status='cancelled',error=NULL,updated_at=now() WHERE id=$1",
      [id],
    );
    const { rows } = await client.query(
      "UPDATE upload_sessions SET status='cancelled',updated_at=now() WHERE import_entry_id IN (SELECT id FROM workspace_import_entries WHERE batch_id=$1) AND status<>'complete' RETURNING *",
      [id],
    );
    for (const upload of rows)
      await enqueueJob(
        "clear-import-staging",
        "cancelled-import-staging:" + upload.id,
        { id: upload.id },
        client,
      );
    for (const upload of rows)
      await enqueueJob(
        "delete-blob",
        "cancelled-import:" + upload.id,
        { key: upload.storage_key },
        client,
      );
    return rows;
  });
  for (const upload of uploads)
    await clearUploadStaging(
      upload as Parameters<typeof clearUploadStaging>[0],
      true,
    );
}
export async function clearImportUploadStaging(id: string) {
  const [upload] = await query(
    "SELECT * FROM upload_sessions WHERE id=$1 AND import_entry_id IS NOT NULL AND status IN ('staged','complete','cancelled')",
    [id],
  );
  if (upload)
    await clearUploadStaging(
      upload as Parameters<typeof clearUploadStaging>[0],
      upload.status === "cancelled",
    );
}
export async function expireWorkspaceImports() {
  const expired = await query<{ id: string }>(
    "SELECT id FROM workspace_imports WHERE expires_at<now() AND status NOT IN ('complete','cancelled') ORDER BY expires_at LIMIT 50",
  );
  for (const batch of expired) await cancelWorkspaceImport(batch.id);
}

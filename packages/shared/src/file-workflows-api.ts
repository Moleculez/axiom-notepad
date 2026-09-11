import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, query, transaction } from "./db";
import { HttpError, resourceAccess } from "./access";
import {
  fileOperationSchema,
  folderColors,
  type FileOperation,
  type FileOperationItem,
  type FileOperationResult,
} from "./file-workflows";
import { workspaceApi } from "./workspace-api";
import { resourceTransferApi } from "./resource-transfer";
import {
  enqueueJob,
  requireScope,
  workspaceJson as json,
  workspaceMutation,
} from "./workspace-service";
import { notifyWorkspace } from "./documents";
import { resourceNameSchema } from "./workspace";
import { visibleFileOperation } from "./operation-visibility";

const minimal = (r: any) => ({
  id: r.id,
  name: r.name,
  version: r.version,
  space_id: r.space_id,
  parent_id: r.parent_id,
  kind: r.kind,
});
export async function fileWorkflowsApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  const [endpoint, id, action] = path;
  if (
    endpoint === "resources" &&
    id &&
    action === "color" &&
    request.method === "POST"
  ) {
    const { resource } = await resourceAccess(userId, z.uuid().parse(id));
    if (resource.kind !== "folder")
      throw new HttpError(400, "Only folders have personal colors.");
    const { color } = z
      .object({ color: z.enum(folderColors).nullable() })
      .parse(await request.json());
    await query(
      "INSERT INTO resource_personalization(user_id,resource_id,color) VALUES($1,$2,$3) ON CONFLICT(user_id,resource_id) DO UPDATE SET color=excluded.color",
      [userId, id, color],
    );
    await notifyWorkspace();
    return json({ color });
  }
  if (
    endpoint === "resources" &&
    id &&
    action === "resolve" &&
    request.method === "GET"
  ) {
    const { resource } = await resourceAccess(userId, z.uuid().parse(id));
    if (resource.kind !== "shortcut" || !resource.shortcut_target_id)
      throw new HttpError(
        404,
        "This shortcut’s target is unavailable. The original may have been removed.",
      );
    const { resource: target } = await resourceAccess(
      userId,
      resource.shortcut_target_id,
    );
    if (
      target.deleted_at ||
      target.space_id !== resource.space_id ||
      target.kind === "shortcut"
    )
      throw new HttpError(
        404,
        "This shortcut’s target moved or is in Trash. Restore it or create a new shortcut.",
      );
    return json(minimal(target));
  }
  if (endpoint === "shortcuts" && request.method === "POST") {
    const input = z
      .object({
        mutationId: z.uuid(),
        targetId: z.uuid(),
        parentId: z.uuid().nullable(),
        name: resourceNameSchema.optional(),
      })
      .parse(await request.json());
    const { resource: target } = await resourceAccess(userId, input.targetId);
    if (target.kind === "shortcut" || target.deleted_at)
      throw new HttpError(
        400,
        "Choose an available original item, not another shortcut.",
      );
    const result = await workspaceMutation(
      userId,
      input.mutationId,
      "shortcut",
      input,
      async (client) => {
        await requireScope(client, userId, target.space_id, "edit");
        return (
          await client.query(
            "INSERT INTO resources(space_id,parent_id,kind,name,owner_id,shortcut_target_id) VALUES($1,$2,'shortcut',$3,$4,$5) RETURNING *",
            [
              target.space_id,
              input.parentId,
              input.name ?? target.name,
              userId,
              target.id,
            ],
          )
        ).rows[0];
      },
    );
    await notifyWorkspace();
    return json(result, 201);
  }
  if (endpoint === "folder-upload-plan" && request.method === "POST") {
    const input = z
      .object({
        mutationId: z.uuid(),
        spaceId: z.uuid(),
        parentId: z.uuid().nullable(),
        paths: z
          .array(z.array(resourceNameSchema).min(1).max(33))
          .min(1)
          .max(2000),
        conflict: z.enum(["keepBoth", "merge", "skip"]),
      })
      .parse(await request.json());
    const result = await workspaceMutation(
      userId,
      input.mutationId,
      "folder-upload-plan",
      input,
      async (client) => {
        await requireScope(client, userId, input.spaceId, "edit");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          input.spaceId,
        ]);
        const folders = new Map<string, string | null>([["", input.parentId]]),
          skipped = new Set<string>();
        const paths = [
          ...new Set(
            input.paths.flatMap((parts) =>
              parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/")),
            ),
          ),
        ].sort(
          (a, b) =>
            a.split("/").length - b.split("/").length || a.localeCompare(b),
        );
        if (paths.length > 2000)
          throw new HttpError(
            400,
            "Upload at most 2,000 folders in one batch. Choose a smaller part of this directory.",
          );
        for (const path of paths) {
          const parts = path.split("/"),
            name = parts.at(-1)!,
            parent = parts.slice(0, -1).join("/");
          if (skipped.has(parent)) {
            skipped.add(path);
            continue;
          }
          const parentId = folders.get(parent) ?? null;
          const { rows: existing } = await client.query(
            "SELECT id,kind FROM resources WHERE space_id=$1 AND parent_id IS NOT DISTINCT FROM $2::uuid AND name=$3 AND deleted_at IS NULL",
            [input.spaceId, parentId, name],
          );
          if (existing.length && input.conflict === "skip") {
            skipped.add(path);
            continue;
          }
          if (existing.length && input.conflict === "merge") {
            if (existing.length !== 1 || existing[0].kind !== "folder")
              throw new HttpError(
                409,
                `“${name}” is ambiguous or is not a folder. Choose Keep both or Skip existing.`,
              );
            folders.set(path, existing[0].id);
            continue;
          }
          let actual = name;
          if (existing.length) {
            let suffix = 2;
            do {
              actual = resourceNameSchema.parse(
                `${name.slice(0, 185)} (${suffix++})`,
              );
            } while (
              (
                await client.query(
                  "SELECT 1 FROM resources WHERE space_id=$1 AND parent_id IS NOT DISTINCT FROM $2::uuid AND name=$3 AND deleted_at IS NULL",
                  [input.spaceId, parentId, actual],
                )
              ).rowCount
            );
          }
          const {
            rows: [folder],
          } = await client.query(
            "INSERT INTO resources(space_id,parent_id,kind,name,owner_id) VALUES($1,$2,'folder',$3,$4) RETURNING id",
            [input.spaceId, parentId, actual, userId],
          );
          folders.set(path, folder.id);
        }
        return { folders: Object.fromEntries(folders), skipped: [...skipped] };
      },
    );
    await notifyWorkspace();
    return json(result);
  }
  if (endpoint !== "file-operations") return null;
  if (!id && request.method === "GET")
    return json(
      await Promise.all(
        (
          await query<FileOperation>(
            "SELECT * FROM file_operations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30",
            [userId],
          )
        ).map((op) => visibleFileOperation(op, userId)),
      ),
    );
  if (!id && request.method === "POST") {
    const input = fileOperationSchema.parse(await request.json());
    if (["move", "copy"].includes(input.command) && !input.destination)
      throw new HttpError(400, "Choose a destination folder.");
    if (input.command === "rename" && input.items.some((r) => !r.name))
      throw new HttpError(400, "Every item needs a valid new name.");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const result = await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        input.id,
      ]);
      const {
        rows: [previous],
      } = await client.query("SELECT * FROM file_operations WHERE id=$1", [
        input.id,
      ]);
      if (previous) {
        if (previous.user_id !== userId || previous.fingerprint !== fingerprint)
          throw new HttpError(
            409,
            "This operation ID belongs to a different request.",
          );
        return previous;
      }
      if (input.destination)
        await requireScope(client, userId, input.destination.spaceId, "edit");
      const items: FileOperationItem[] = [];
      const ids = [...new Set(input.items.map((r) => r.id))];
      for (const requested of input.items.filter(
        (r, i, a) => a.findIndex((t) => t.id === r.id) === i,
      )) {
        const { resource } = await resourceAccess(
          userId,
          requested.id,
          input.command === "copy" ? "read" : "edit",
          input.command === "restore",
        );
        if (resource.version !== requested.version)
          throw new HttpError(
            409,
            `${resource.name} changed. Refresh your selection.`,
          );
        // A selected parent already covers its descendants for move/copy/trash.
        if (["move", "copy", "trash"].includes(input.command)) {
          const { rowCount } = await client.query(
            "WITH RECURSIVE parents AS (SELECT id,parent_id FROM resources WHERE id=$1 UNION SELECT r.id,r.parent_id FROM resources r JOIN parents p ON r.id=p.parent_id) SELECT 1 FROM parents WHERE id=ANY($2::uuid[]) AND id<>$1 LIMIT 1",
            [requested.id, ids],
          );
          if (rowCount) continue;
        }
        if (
          input.destination &&
          input.destination.spaceId !== resource.space_id
        ) {
          if (!input.confirmAudience)
            throw new HttpError(409, "Confirm the destination audience first.");
          if (input.command === "move")
            await requireScope(client, userId, resource.space_id, "manage");
        }
        items.push({
          ...requested,
          mutationId: randomUUID(),
          original: minimal(resource),
        });
      }
      const {
        rows: [created],
      } = await client.query(
        "INSERT INTO file_operations(id,user_id,command,input,fingerprint) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [
          input.id,
          userId,
          input.command,
          JSON.stringify({ ...input, items }),
          fingerprint,
        ],
      );
      await enqueueJob(
        "file-operation",
        "file-operation:" + input.id,
        { id: input.id },
        client,
      );
      return created;
    });
    return json(await visibleFileOperation(result, userId), 202);
  }
  z.uuid().parse(id);
  const [operation] = await query<FileOperation & { user_id: string }>(
    "SELECT * FROM file_operations WHERE id=$1 AND user_id=$2",
    [id, userId],
  );
  if (!operation)
    throw new HttpError(404, "This file operation is unavailable.");
  if (!action && request.method === "GET")
    return json(await visibleFileOperation(operation, userId));
  if (action === "cancel" && request.method === "POST") {
    await query(
      "UPDATE file_operations SET status='cancelled',updated_at=now() WHERE id=$1 AND status IN ('queued','running')",
      [id],
    );
    return json({ ok: true });
  }
  if (action === "retry" && request.method === "POST") {
    await transaction(async (client) => {
      await client.query(
        "UPDATE file_operations SET status='queued',results=(SELECT coalesce(jsonb_agg(r),'[]') FROM jsonb_array_elements(results) r WHERE (r->>'ok')::boolean),updated_at=now() WHERE id=$1 AND status IN ('completed','cancelled')",
        [id],
      );
      await enqueueJob(
        "file-operation",
        `file-operation:${id}:${randomUUID()}`,
        { id },
        client,
      );
    });
    return json({ ok: true });
  }
  // A user-triggered fallback also works when the background worker is offline.
  if (action === "run" && request.method === "POST") {
    try {
      await processFileOperation(id);
    } catch (error) {
      if (error instanceof HttpError && error.status === 409)
        return json({ ok: true, processing: true }, 202);
      throw error;
    }
    return json({ ok: true });
  }
  throw new HttpError(404, "Unknown file operation action.");
}

export async function processFileOperation(id: string) {
  const lock = await pool.connect();
  let locked = false;
  try {
    locked = (
      await lock.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [
        "file-operation:" + id,
      ])
    ).rows[0].locked;
    if (!locked)
      throw new HttpError(
        409,
        "This operation is already processing. Its progress will refresh shortly.",
      );
    const [operation] = await query<FileOperation & { user_id: string }>(
      "SELECT * FROM file_operations WHERE id=$1",
      [id],
    );
    if (!operation || !["queued", "running"].includes(operation.status)) return;
    await query(
      "UPDATE file_operations SET status='running',updated_at=now() WHERE id=$1 AND status='queued'",
      [id],
    );
    for (const item of operation.input.items) {
      if (operation.results.some((r) => r.id === item.id)) continue;
      const [current] = await query(
        "SELECT status FROM file_operations WHERE id=$1",
        [id],
      );
      if (current?.status === "cancelled") break;
      let result: FileOperationResult;
      try {
        const [receipt] = await query(
          "SELECT result FROM workspace_mutations WHERE user_id=$1 AND id=$2",
          [operation.user_id, item.mutationId],
        );
        let resource = receipt?.result;
        if (!receipt) {
          const destination = operation.input.destination;
          const method =
            operation.command === "rename" ||
            (operation.command === "move" &&
              destination?.spaceId === item.original.space_id)
              ? "PATCH"
              : "POST";
          const action =
            operation.command === "copy"
              ? "copy"
              : operation.command === "move" && method === "POST"
                ? "transfer"
                : ["trash", "restore"].includes(operation.command)
                  ? operation.command
                  : undefined;
          const body = {
            mutationId: item.mutationId,
            version: item.version,
            ...(operation.command === "rename" ? { name: item.name } : {}),
            ...(destination
              ? {
                  parentId: destination.parentId,
                  destinationSpaceId: destination.spaceId,
                  confirmAudience: operation.input.confirmAudience,
                }
              : {}),
          };
          const path = ["resources", item.id, ...(action ? [action] : [])];
          const request = new Request("http://internal.invalid/api", {
            method,
            body: JSON.stringify(body),
          });
          const response =
            action === "copy" || action === "transfer"
              ? await resourceTransferApi(request, path, operation.user_id)
              : await workspaceApi(request, path, operation.user_id);
          if (!response?.ok)
            throw new Error("File operation failed. Refresh and retry.");
          resource = await response.json();
        }
        resource = resource?.resource ?? resource;
        result = {
          id: item.id,
          ok: true,
          ...(resource?.id ? { resource: minimal(resource) } : {}),
        };
      } catch (error) {
        result = {
          id: item.id,
          ok: false,
          error:
            error instanceof HttpError
              ? error.message
              : "The operation was interrupted. Retry to recover its saved result; originals are protected.",
        };
      }
      operation.results.push(result);
      await query(
        "UPDATE file_operations SET results=$2,updated_at=now() WHERE id=$1",
        [id, JSON.stringify(operation.results)],
      );
    }
    await query(
      "UPDATE file_operations SET status='completed',updated_at=now() WHERE id=$1 AND status='running'",
      [id],
    );
    await notifyWorkspace();
  } finally {
    if (locked)
      await lock.query("SELECT pg_advisory_unlock(hashtext($1))", [
        "file-operation:" + id,
      ]);
    lock.release();
  }
}

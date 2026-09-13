import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { query, transaction } from "./db";
import { fileAccess, HttpError, resourceAccess, spaceAccess } from "./access";
import {
  MAX_FILE_BYTES,
  UPLOAD_CHUNK_BYTES,
  resourceNameSchema,
} from "./workspace";
import {
  workspaceJson as json,
  requireScope,
  enqueueJob,
  recordActivity,
} from "./workspace-service";
import {
  availableStorageBytes,
  startMultipart,
  storeChunk,
  completeMultipart,
  verifyStoredFile,
  clearUploadStaging,
  fileResponse,
  detectStoredMime,
} from "./storage-streams";
import { notifyWorkspace } from "./documents";

const uuid = z.uuid();
type Upload = {
  id: string;
  owner_id: string;
  space_id: string;
  parent_id: string | null;
  resource_id: string | null;
  name: string;
  bytes: number;
  status: string;
  storage_key: string;
  multipart_id: string | null;
  sha256: string | null;
  completed_resource_id: string | null;
  expires_at: Date;
};
async function uploadAccess(userId: string, id: string) {
  const [upload] = await query<Upload>(
    "SELECT * FROM upload_sessions WHERE id=$1 AND owner_id=$2",
    [uuid.parse(id), userId],
  );
  if (!upload) throw new HttpError(404, "Upload unavailable.");
  await spaceAccess(userId, upload.space_id, "edit");
  return upload;
}
export async function reserveCapacity(
  client: import("pg").PoolClient,
  spaceId: string,
  newBytes: number,
  checkDisk = true,
  excludeUploadId: string | null = null,
) {
  if (checkDisk)
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('axiom:disk-reservations'))",
    );
  const {
    rows: [scope],
  } = await client.query("SELECT * FROM spaces WHERE id=$1", [spaceId]);
  const {
    rows: [budget],
  } = await client.query(
    "SELECT * FROM spaces WHERE id=CASE WHEN $2::uuid IS NULL THEN $1::uuid ELSE (SELECT id FROM spaces WHERE kind='team' AND group_id=$2) END FOR NO KEY UPDATE",
    [spaceId, scope.group_id],
  );
  if (budget.quota_bytes !== null) {
    const {
      rows: [usage],
    } = await client.query(
      `SELECT (SELECT coalesce(sum(a.bytes),0) FROM attachments a JOIN file_versions v ON v.id=a.id JOIN resources r ON r.id=v.resource_id JOIN spaces s ON s.id=r.space_id WHERE CASE WHEN $2::uuid IS NULL THEN s.id=$1::uuid ELSE s.group_id=$2 END)+(SELECT coalesce(sum(d.bytes),0) FROM file_derivatives d JOIN file_versions v ON v.id=d.version_id JOIN resources r ON r.id=v.resource_id JOIN spaces s ON s.id=r.space_id WHERE CASE WHEN $2::uuid IS NULL THEN s.id=$1::uuid ELSE s.group_id=$2 END)+(SELECT coalesce(sum(u.bytes),0) FROM upload_sessions u JOIN spaces s ON s.id=u.space_id WHERE u.status IN ('uploading','verifying','failed') AND u.expires_at>now() AND u.id IS DISTINCT FROM $3::uuid AND CASE WHEN $2::uuid IS NULL THEN s.id=$1::uuid ELSE s.group_id=$2 END)+(SELECT coalesce(sum(a.bytes),0) FROM image_draft_assets a JOIN resources r ON r.id=a.resource_id JOIN spaces s ON s.id=r.space_id WHERE CASE WHEN $2::uuid IS NULL THEN s.id=$1::uuid ELSE s.group_id=$2 END) AS bytes`,
      [spaceId, scope.group_id, excludeUploadId],
    );
    if (Number(usage.bytes) + newBytes > Number(budget.quota_bytes))
      throw new HttpError(
        413,
        "This space's storage limit would be exceeded. Existing files have not been changed.",
      );
  }
  const free = checkDisk ? await availableStorageBytes() : null;
  if (free !== null) {
    const {
      rows: [reservations],
    } = await client.query(
      "SELECT coalesce(sum(bytes),0) AS bytes FROM upload_sessions WHERE status IN ('uploading','verifying','failed') AND expires_at>now() AND id IS DISTINCT FROM $1::uuid",
      [excludeUploadId],
    );
    if (free < (newBytes + Number(reservations.bytes)) * 2 + 256 * 1024 * 1024)
      throw new HttpError(
        507,
        "There is not enough unreserved server disk space to safely receive and verify this upload.",
      );
  }
}
export async function uploadsApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  const [endpoint, id, action, partId] = path,
    method = request.method;
  if (endpoint === "uploads" && !id && method === "GET")
    return json(
      await query(
        "SELECT u.id,u.space_id,u.parent_id,u.resource_id,u.name,u.bytes,u.status,u.error,u.completed_resource_id,u.created_at,u.expires_at,coalesce((SELECT sum(c.bytes) FROM upload_chunks c WHERE c.upload_id=u.id),0) AS received FROM upload_sessions u WHERE u.owner_id=$1 AND axiom_space_role($1,u.space_id)='editor' ORDER BY u.created_at DESC LIMIT 100",
        [userId],
      ),
    );
  if (endpoint === "uploads" && !id && method === "POST") {
    const input = z
      .object({
        id: uuid,
        spaceId: uuid,
        parentId: uuid.nullable().default(null),
        resourceId: uuid.nullable().default(null),
        name: resourceNameSchema,
        bytes: z.number().int().min(1).max(MAX_FILE_BYTES),
        sha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .parse(await request.json());
    await spaceAccess(userId, input.spaceId, "edit");
    const result = await transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        input.id,
      ]);
      const {
        rows: [existing],
      } = await client.query<Upload>(
        "SELECT * FROM upload_sessions WHERE id=$1",
        [input.id],
      );
      if (existing) {
        if (
          existing.owner_id !== userId ||
          existing.space_id !== input.spaceId ||
          existing.parent_id !== input.parentId ||
          existing.resource_id !== input.resourceId ||
          existing.name !== input.name ||
          Number(existing.bytes) !== input.bytes ||
          (input.sha256 && existing.sha256 !== input.sha256)
        )
          throw new HttpError(
            409,
            "This upload identifier is already associated with a different file.",
          );
        return existing;
      }
      await reserveCapacity(client, input.spaceId, input.bytes);
      await requireScope(client, userId, input.spaceId, "edit");
      if (input.parentId) {
        const { resource } = await resourceAccess(
          userId,
          input.parentId,
          "edit",
        );
        if (resource.space_id !== input.spaceId || resource.kind === "file")
          throw new HttpError(400, "Choose a folder or note in this space.");
      }
      if (input.resourceId) {
        const { resource } = await resourceAccess(
          userId,
          input.resourceId,
          "edit",
        );
        if (resource.space_id !== input.spaceId || resource.kind !== "file")
          throw new HttpError(400, "Choose a file in this space to replace.");
      }
      const key = randomUUID(),
        multipartId = await startMultipart(key, input.id);
      const {
        rows: [upload],
      } = await client.query<Upload>(
        "INSERT INTO upload_sessions(id,owner_id,space_id,parent_id,resource_id,name,bytes,storage_key,multipart_id,sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
        [
          input.id,
          userId,
          input.spaceId,
          input.parentId,
          input.resourceId,
          input.name,
          input.bytes,
          key,
          multipartId,
          input.sha256 ?? null,
        ],
      );
      return upload;
    });
    return json(
      {
        id: result.id,
        status: result.status,
        chunkBytes: UPLOAD_CHUNK_BYTES,
        expiresAt: result.expires_at,
      },
      201,
    );
  }
  if (endpoint === "uploads" && id) {
    const upload = await uploadAccess(userId, id);
    if (!action && method === "GET") {
      const chunks = await query(
        "SELECT part,bytes,sha256 FROM upload_chunks WHERE upload_id=$1 ORDER BY part",
        [id],
      );
      return json({
        id,
        name: upload.name,
        bytes: upload.bytes,
        status: upload.status,
        resourceId: upload.completed_resource_id,
        expiresAt: upload.expires_at,
        chunkBytes: UPLOAD_CHUNK_BYTES,
        chunks,
      });
    }
    if (action === "chunks" && method === "PUT") {
      const part = z.coerce
        .number()
        .int()
        .min(1)
        .max(Math.ceil(Number(upload.bytes) / UPLOAD_CHUNK_BYTES))
        .parse(partId);
      if (
        upload.status !== "uploading" ||
        new Date(upload.expires_at).valueOf() <= Date.now()
      )
        throw new HttpError(409, "This upload is no longer accepting parts.");
      const expected = Math.min(
        UPLOAD_CHUNK_BYTES,
        Number(upload.bytes) - (part - 1) * UPLOAD_CHUNK_BYTES,
      );
      if (
        Number(request.headers.get("content-length") ?? expected) !== expected
      )
        throw new HttpError(400, "Upload part size mismatch.");
      const reader = request.body?.getReader();
      if (!reader) throw new HttpError(400, "Upload part is empty.");
      const data = Buffer.alloc(expected);
      let count = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (count + value.byteLength > expected) {
            await reader.cancel();
            throw new HttpError(413, "Upload part exceeds its allocated size.");
          }
          data.set(value, count);
          count += value.byteLength;
        }
      } finally {
        reader.releaseLock();
      }
      if (count !== expected)
        throw new HttpError(400, "Upload part was interrupted. Retry it.");
      const sha256 = createHash("sha256").update(data).digest("hex");
      const claimed = request.headers.get("x-content-sha256");
      if (claimed && claimed !== sha256)
        throw new HttpError(400, "Upload part checksum mismatch.");
      await transaction(async (client) => {
        const {
          rows: [current],
        } = await client.query<Upload>(
          "SELECT * FROM upload_sessions WHERE id=$1 FOR UPDATE",
          [id],
        );
        await requireScope(client, userId, current.space_id, "edit");
        if (current.status !== "uploading")
          throw new HttpError(409, "This upload is no longer accepting parts.");
        const {
          rows: [previous],
        } = await client.query(
          "SELECT * FROM upload_chunks WHERE upload_id=$1 AND part=$2",
          [id, part],
        );
        if (previous) {
          if (previous.sha256 !== sha256)
            throw new HttpError(
              409,
              "This part contains different data. Reselect the original file or start a new upload.",
            );
          return;
        }
        const etag = await storeChunk(current, part, data, sha256);
        await client.query(
          "INSERT INTO upload_chunks(upload_id,part,bytes,sha256,etag) VALUES($1,$2,$3,$4,$5)",
          [id, part, count, sha256, etag],
        );
        await client.query(
          "UPDATE upload_sessions SET updated_at=now() WHERE id=$1",
          [id],
        );
      });
      return json({ part, bytes: count, sha256 });
    }
    if (action === "complete" && method === "POST") {
      await transaction(async (client) => {
        const {
          rows: [current],
        } = await client.query<Upload>(
          "SELECT * FROM upload_sessions WHERE id=$1 FOR UPDATE",
          [id],
        );
        await requireScope(client, userId, current.space_id, "edit");
        if (current.status === "complete" || current.status === "verifying")
          return;
        if (
          !["uploading", "failed"].includes(current.status) ||
          new Date(current.expires_at).valueOf() <= Date.now()
        )
          throw new HttpError(409, "This upload has expired or was cancelled.");
        const {
          rows: [parts],
        } = await client.query(
          "SELECT count(*)::int AS count,coalesce(sum(bytes),0) AS bytes FROM upload_chunks WHERE upload_id=$1",
          [id],
        );
        if (
          parts.count !==
            Math.ceil(Number(current.bytes) / UPLOAD_CHUNK_BYTES) ||
          Number(parts.bytes) !== Number(current.bytes)
        )
          throw new HttpError(
            409,
            "Some file parts are missing. Resume the upload first.",
          );
        await client.query(
          "UPDATE upload_sessions SET status='verifying',error=NULL,updated_at=now() WHERE id=$1",
          [id],
        );
        await enqueueJob("complete-upload", "upload:" + id, { id }, client);
      });
      return json(
        {
          status: upload.status === "complete" ? "complete" : "verifying",
          resourceId: upload.completed_resource_id,
        },
        202,
      );
    }
    if (action === "cancel" && method === "POST") {
      const rows = await query(
        "UPDATE upload_sessions SET status='cancelled',updated_at=now() WHERE id=$1 AND owner_id=$2 AND status IN ('uploading','failed') RETURNING *",
        [id, userId],
      );
      if (!rows.length)
        throw new HttpError(
          409,
          "Verification has begun or this upload already finished. Completed files can be moved to trash.",
        );
      await clearUploadStaging(upload, true);
      await enqueueJob("delete-blob", "cancelled-upload:" + id, {
        key: upload.storage_key,
      });
      return json({ ok: true });
    }
  }
  if (endpoint === "files" && id) {
    const { resource } = await resourceAccess(
      userId,
      uuid.parse(id),
      "read",
      true,
    );
    if (resource.kind !== "file")
      throw new HttpError(400, "Choose a stored file.");
    if (action === "versions" && method === "GET")
      return json(
        await query(
          'SELECT a.id,a.name,a.mime,a.bytes,a.sha256,v.ordinal,v.created_at,u.name AS created_by FROM file_versions v JOIN attachments a ON a.id=v.id LEFT JOIN "user" u ON u.id=v.created_by WHERE v.resource_id=$1 ORDER BY v.ordinal DESC',
          [id],
        ),
      );
    if (
      ["content", "download"].includes(action) &&
      ["GET", "HEAD"].includes(method)
    ) {
      const versionId =
        new URL(request.url).searchParams.get("version") ??
        resource.current_version_id;
      if (!versionId) throw new HttpError(404, "File content is not ready.");
      const { file } = await fileAccess(userId, uuid.parse(versionId));
      if (file.resource_id !== id)
        throw new HttpError(404, "This version belongs to another file.");
      return fileResponse(
        request,
        {
          ...file,
          name: resource.name,
          mime:
            file.mime === "application/octet-stream"
              ? await detectStoredMime(
                  file.storage_key,
                  resource.name,
                  Number(file.bytes),
                )
              : file.mime,
        } as Parameters<typeof fileResponse>[1],
        action === "download",
      );
    }
  }
  return null;
}

export async function finishUpload(id: string) {
  const [upload] = await query<Upload>(
    "SELECT * FROM upload_sessions WHERE id=$1",
    [id],
  );
  if (!upload || upload.status === "complete" || upload.status === "cancelled")
    return;
  await spaceAccess(upload.owner_id, upload.space_id, "edit");
  const chunks = await query<{ part: number; etag: string; sha256: string }>(
    "SELECT * FROM upload_chunks WHERE upload_id=$1 ORDER BY part",
    [id],
  );
  await completeMultipart(upload, chunks);
  const verified = await verifyStoredFile(upload.storage_key, upload.name);
  if (
    verified.bytes !== Number(upload.bytes) ||
    (upload.sha256 && verified.sha256 !== upload.sha256)
  )
    throw new Error(
      "The completed file failed size or checksum verification. Your existing files were not changed.",
    );
  await transaction(async (client) => {
    const {
      rows: [current],
    } = await client.query<Upload>(
      "SELECT * FROM upload_sessions WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (current.status === "complete") return;
    if (current.status !== "verifying")
      throw new HttpError(409, "Upload is no longer awaiting verification.");
    if (new Date(current.expires_at).valueOf() <= Date.now())
      throw new HttpError(
        409,
        "This upload expired. Start a new transfer of the original file.",
      );
    await reserveCapacity(
      client,
      upload.space_id,
      Number(upload.bytes),
      false,
      upload.id,
    );
    await requireScope(client, upload.owner_id, upload.space_id, "edit");
    let resourceId = upload.resource_id;
    if (resourceId) {
      const {
        rows: [target],
      } = await client.query("SELECT * FROM resources WHERE id=$1 FOR UPDATE", [
        resourceId,
      ]);
      if (!target || target.deleted_at || target.space_id !== upload.space_id)
        throw new Error(
          "The destination file moved or was deleted. Choose a new destination.",
        );
    } else {
      resourceId = randomUUID();
      await client.query(
        "INSERT INTO resources(id,space_id,parent_id,kind,name,owner_id) VALUES($1,$2,$3,'file',$4,$5)",
        [
          resourceId,
          upload.space_id,
          upload.parent_id,
          upload.name,
          upload.owner_id,
        ],
      );
    }
    const versionId = randomUUID();
    await client.query(
      "INSERT INTO attachments(id,name,mime,bytes,storage_key,sha256) VALUES($1,$2,$3,$4,$5,$6)",
      [
        versionId,
        upload.name,
        verified.mime,
        verified.bytes,
        upload.storage_key,
        verified.sha256,
      ],
    );
    await client.query(
      "INSERT INTO file_versions(id,resource_id,ordinal,created_by) SELECT $1,$2,coalesce(max(ordinal),0)+1,$3 FROM file_versions WHERE resource_id=$2",
      [versionId, resourceId, upload.owner_id],
    );
    await client.query(
      "UPDATE resources SET current_version_id=$2,version=version+1,updated_at=now() WHERE id=$1",
      [resourceId, versionId],
    );
    await client.query(
      "UPDATE upload_sessions SET status='complete',completed_resource_id=$2,sha256=$3,error=NULL,updated_at=now() WHERE id=$1",
      [id, resourceId, verified.sha256],
    );
    await recordActivity(client, {
      spaceId: upload.space_id,
      userId: upload.owner_id,
      kind: "uploaded",
      title: `${upload.resource_id ? "Added a version of" : "Uploaded"} ${upload.name}`,
      resourceId,
    });
    if (verified.mime.startsWith("image/"))
      await enqueueJob(
        "thumbnail",
        "thumbnail:" + versionId,
        { versionId },
        client,
      );
  });
  await clearUploadStaging(upload);
  await notifyWorkspace();
}

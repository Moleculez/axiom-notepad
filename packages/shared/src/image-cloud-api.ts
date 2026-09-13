import { z } from "zod";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import JSZip from "jszip";
import type pg from "pg";
import { query, transaction } from "./db";
import { resourceAccess, HttpError } from "./access";
import {
  workspaceJson as json,
  workspaceMutation,
  requireScope,
} from "./workspace-service";
import { putAttachment, removeAttachment, getAttachment } from "./storage";
import { reserveCapacity } from "./uploads-api";
import { cloudImageManifest } from "./image-cloud-drafts";
const leaseInput = z.object({
  token: z.uuid(),
  fence: z.number().int().positive(),
});
async function authorized(
  client: pg.PoolClient,
  id: string,
  userId: string,
  spaceId: string,
  lease: z.infer<typeof leaseInput>,
) {
  await requireScope(client, userId, spaceId, "edit");
  const {
    rows: [resource],
  } = await client.query("SELECT * FROM resources WHERE id=$1 FOR UPDATE", [
    id,
  ]);
  if (!resource || resource.space_id !== spaceId || resource.deleted_at)
    throw new HttpError(
      409,
      "Project moved or was deleted. Your local draft is retained.",
    );
  const {
    rows: [current],
  } = await client.query(
    "SELECT * FROM image_edit_leases WHERE resource_id=$1 FOR UPDATE",
    [id],
  );
  if (
    !current ||
    current.owner_id !== userId ||
    current.token !== lease.token ||
    Number(current.fence) !== lease.fence ||
    new Date(current.expires_at).valueOf() <= Date.now()
  )
    throw new HttpError(
      409,
      "Editing lease changed. Keep the local draft and reacquire editing access.",
    );
  return resource;
}
async function boundedBody(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Image asset is empty.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(
          413,
          "Image asset exceeds 36 MB. Export a local project copy.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
export async function imageCloudApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  const [endpoint, id, action, child, assetId] = path;
  if (endpoint !== "tools" || action !== "draft") return null;
  const { resource } = await resourceAccess(
    userId,
    z.uuid().parse(id),
    request.method === "GET" ? "read" : "edit",
  );
  const [project] = await query(
    "SELECT kind FROM tool_projects WHERE resource_id=$1",
    [id],
  );
  if (project?.kind !== "image")
    throw new HttpError(400, "Choose an image project.");
  if (request.method === "GET") {
    if (child === "download") {
      const revision = z.coerce
        .number()
        .int()
        .positive()
        .parse(new URL(request.url).searchParams.get("revision"));
      const data = await transaction(async (client) => {
        await client.query(
          "SELECT pg_advisory_xact_lock_shared(hashtext('axiom:file-references'))",
        );
        await requireScope(client, userId, resource.space_id);
        const {
          rows: [head],
        } = await client.query(
          "SELECT manifest FROM image_cloud_drafts WHERE resource_id=$1 AND revision=$2",
          [id, revision],
        );
        if (!head)
          throw new HttpError(
            409,
            "The working draft changed. Refresh before exporting it.",
          );
        const manifest = cloudImageManifest.parse(head.manifest),
          zip = new JSZip();
        const entries = [
            ...Object.entries(manifest.assets),
            ["preview.png", manifest.preview],
          ],
          ids = [...new Set(entries.map((e) => e[1]))];
        const { rows: assets } = await client.query(
          "SELECT id,storage_key,bytes FROM image_draft_assets WHERE resource_id=$1 AND id=ANY($2::uuid[])",
          [id, ids],
        );
        if (
          assets.length !== ids.length ||
          assets.reduce((n, a) => n + Number(a.bytes), 0) > 36_000_000
        )
          throw new HttpError(
            409,
            "The working draft assets are unavailable or oversized.",
          );
        const blobs = new Map<string, Uint8Array>();
        for (const asset of assets)
          blobs.set(asset.id, await getAttachment(asset.storage_key));
        for (const [path, asset] of entries) zip.file(path, blobs.get(asset)!);
        zip.file("manifest.json", JSON.stringify(manifest.project));
        return zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
      });
      return new Response(new Uint8Array(data), {
        headers: {
          "content-type": "application/vnd.axiom.image+zip",
          "content-disposition":
            "attachment; filename=working-draft.axiom-image",
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    if (child === "assets") {
      const [asset] = await query(
        "SELECT storage_key FROM image_draft_assets WHERE id=$1 AND resource_id=$2",
        [z.uuid().parse(assetId), id],
      );
      if (!asset) throw new HttpError(404, "Draft asset is unavailable.");
      return new Response(
        new Uint8Array(await getAttachment(asset.storage_key)),
        {
          headers: {
            "content-type": "image/png",
            "cache-control": "private, no-store",
            "x-content-type-options": "nosniff",
          },
        },
      );
    }
    const [head] = await query(
      'SELECT d.*,u.name AS owner FROM image_cloud_drafts d JOIN "user" u ON u.id=d.owner_id WHERE resource_id=$1',
      [id],
    );
    const hashes = head
      ? await query(
          "SELECT id,sha256 FROM image_draft_assets WHERE resource_id=$1 AND id=ANY($2::uuid[])",
          [id, [...Object.values(head.manifest.assets), head.manifest.preview]],
        )
      : [];
    return json(
      head
        ? {
            revision: Number(head.revision),
            assetHashes: Object.fromEntries(
              hashes.map((a) => [a.sha256, a.id]),
            ),
            baseVersion: head.base_version,
            manifest: head.manifest,
            previousManifest: head.previous_manifest,
            previousBaseVersion: head.previous_base_version,
            owner: head.owner,
            updatedAt: head.updated_at,
          }
        : null,
    );
  }
  if (request.method !== "POST")
    throw new HttpError(405, "Unsupported draft action.");
  if (child === "assets") {
    const lease = leaseInput.parse({
      token: request.headers.get("x-axiom-image-token"),
      fence: Number(request.headers.get("x-axiom-image-fence")),
    });
    const hash = z
      .string()
      .regex(/^[a-f\d]{64}$/)
      .parse(assetId);
    await transaction((client) =>
      authorized(client, id, userId, resource.space_id, lease),
    );
    const bytes = await boundedBody(request, 36_000_000);
    if (createHash("sha256").update(bytes).digest("hex") !== hash)
      throw new HttpError(400, "Image checksum does not match.");
    const metadata = await sharp(bytes, {
      limitInputPixels: 16_000_000,
    }).metadata();
    if (metadata.format !== "png" || !metadata.width || !metadata.height)
      throw new HttpError(400, "Draft assets must be valid PNG images.");
    const key = randomUUID();
    let retained = false;
    await putAttachment(key, bytes, "image/png");
    try {
      const result = await transaction(async (client) => {
        await authorized(client, id, userId, resource.space_id, lease);
        await client.query(
          "SELECT pg_advisory_xact_lock_shared(hashtext('axiom:file-references'))",
        );
        const {
          rows: [existing],
        } = await client.query(
          "SELECT id FROM image_draft_assets WHERE resource_id=$1 AND sha256=$2",
          [id, hash],
        );
        if (existing) return existing;
        await reserveCapacity(client, resource.space_id, bytes.length);
        const result = await client.query(
          "INSERT INTO image_draft_assets(id,resource_id,sha256,bytes,storage_key,width,height) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
          [
            randomUUID(),
            id,
            hash,
            bytes.length,
            key,
            metadata.width,
            metadata.height,
          ],
        );
        return { ...result.rows[0], storageKey: key };
      });
      retained = result.storageKey === key;
      return json(result, 201);
    } finally {
      if (!retained) await removeAttachment(key).catch(() => {});
    }
  }
  const input = leaseInput
    .extend({
      mutationId: z.uuid(),
      revision: z.number().int().nonnegative(),
      baseVersion: z.uuid().nullable(),
      manifest: cloudImageManifest,
    })
    .parse(await request.json());
  return json(
    await workspaceMutation(
      userId,
      input.mutationId,
      "image-cloud-draft",
      { id, ...input },
      async (client) => {
        const target = await authorized(
          client,
          id,
          userId,
          resource.space_id,
          input,
        );
        await client.query(
          "SELECT pg_advisory_xact_lock_shared(hashtext('axiom:file-references'))",
        );
        if (target.current_version_id !== input.baseVersion)
          throw new HttpError(
            409,
            "A milestone changed. The local draft is retained; open the latest project or save a copy.",
          );
        const {
          rows: [current],
        } = await client.query(
          "SELECT * FROM image_cloud_drafts WHERE resource_id=$1 FOR UPDATE",
          [id],
        );
        if (Number(current?.revision ?? 0) !== input.revision)
          throw new HttpError(
            409,
            "The shared working draft changed. Reload it before saving.",
          );
        const ids = [
          ...new Set([
            ...Object.values(input.manifest.assets),
            input.manifest.preview,
          ]),
        ];
        const { rows: assets } = await client.query(
          "SELECT id,storage_key,bytes,width,height FROM image_draft_assets WHERE id=ANY($1::uuid[]) AND resource_id=$2",
          [ids, id],
        );
        if (assets.length !== ids.length)
          throw new HttpError(
            409,
            "A draft asset is missing. Reopen the project to retry uploading.",
          );
        if (assets.reduce((n, a) => n + Number(a.bytes), 0) > 36_000_000)
          throw new HttpError(
            413,
            "Draft exceeds the 36 MB project budget. Export your local project.",
          );
        for (const a of assets) {
          const metadata =
            a.width && a.height
              ? a
              : await sharp(await getAttachment(a.storage_key), {
                  limitInputPixels: 16_000_000,
                }).metadata();
          if (
            metadata.width !== input.manifest.project.width ||
            metadata.height !== input.manifest.project.height
          )
            throw new HttpError(
              400,
              "Asset dimensions do not match the artboard.",
            );
          if (!a.width)
            await client.query(
              "UPDATE image_draft_assets SET width=$2,height=$3 WHERE id=$1",
              [a.id, metadata.width, metadata.height],
            );
        }
        const result = await client.query(
          "INSERT INTO image_cloud_drafts(resource_id,revision,owner_id,base_version,manifest) VALUES($1,1,$2,$3,$4) ON CONFLICT(resource_id) DO UPDATE SET revision=image_cloud_drafts.revision+1,owner_id=$2,base_version=$3,previous_manifest=image_cloud_drafts.manifest,previous_base_version=image_cloud_drafts.base_version,manifest=$4,updated_at=now() RETURNING revision",
          [id, userId, input.baseVersion, JSON.stringify(input.manifest)],
        );
        return { revision: Number(result.rows[0].revision) };
      },
    ),
  );
}
/** Unreferenced upload leftovers expire; both recovery heads are retained. */
export async function pruneImageDraftAssets() {
  await transaction(pruneImageDraftAssetsInTransaction);
}
/** Caller-owned transaction also allows rollback-only retention rehearsals. */
export async function pruneImageDraftAssetsInTransaction(client: {
  query: (sql: string, values?: any[]) => Promise<any>;
}) {
  await client.query(
    "DELETE FROM revision_read_cursors WHERE (user_id,resource_id) IN (SELECT user_id,resource_id FROM revision_read_cursors WHERE seen_at<now()-interval '30 days' LIMIT 500)",
  );
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('axiom:file-references'))",
  );
  await client.query(
    "DELETE FROM image_draft_assets a WHERE a.id IN (SELECT x.id FROM image_draft_assets x LEFT JOIN image_cloud_drafts d ON d.resource_id=x.resource_id WHERE x.created_at<now()-interval '24 hours' AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(coalesce(d.manifest->'assets','{}')) e WHERE e.value=x.id::text) AND NOT EXISTS (SELECT 1 FROM jsonb_each_text(coalesce(d.previous_manifest->'assets','{}')) e WHERE e.value=x.id::text) AND x.id::text IS DISTINCT FROM d.manifest->>'preview' AND x.id::text IS DISTINCT FROM d.previous_manifest->>'preview' LIMIT 100)",
  );
}

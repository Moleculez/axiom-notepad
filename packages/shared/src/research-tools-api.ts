import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { query, transaction } from "./db";
import { resourceAccess, spaceAccess, HttpError } from "./access";
import { createNote, notifyWorkspace } from "./documents";
import {
  workspaceJson as json,
  workspaceMutation,
  requireScope,
  recordActivity,
} from "./workspace-service";
import { resourceNameSchema } from "./workspace";
import { reserveCapacity } from "./uploads-api";
import { putAttachment, removeAttachment } from "./storage";
import JSZip from "jszip";
import { blankImageProject } from "./blank-image";
import {
  mathProjectSettings,
  imageProjectManifest,
  isProjectPng,
} from "./research-tools";

const uuid = z.uuid();
const settings = z
  .record(z.string().max(100), z.unknown())
  .refine((v) => JSON.stringify(v).length < 30000, "Settings are too large.");
export async function researchToolsApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  const [endpoint, id, action] = path,
    method = request.method;
  if (endpoint !== "tools") return null;
  if (!id && method === "GET")
    return json(
      await query(
        "SELECT p.*,r.name,r.space_id,r.current_version_id,r.updated_at,axiom_space_role($1,r.space_id) AS role FROM tool_projects p JOIN resources r ON r.id=p.resource_id WHERE r.deleted_at IS NULL AND axiom_space_role($1,r.space_id) IS NOT NULL ORDER BY r.updated_at DESC LIMIT 200",
        [userId],
      ),
    );
  if (!id && method === "POST") {
    const input = z
      .object({
        spaceId: uuid,
        name: resourceNameSchema,
        kind: z.enum(["math", "image", "canvas", "text"]),
        mutationId: uuid,
        source: z.string().max(5_000_000).default(""),
        parentId: uuid.nullable().default(null),
        id: uuid.optional(),
        initialState: z.string().max(8_000_000).optional(),
      })
      .parse(await request.json());
    const space = await spaceAccess(userId, input.spaceId, "edit");
    const initialImage =
      input.kind === "image"
        ? {
            ...(await blankImageProject()),
            key: randomUUID(),
            previewKey: randomUUID(),
          }
        : null;
    let initialPublished = false;
    try {
      if (initialImage) {
        await putAttachment(
          initialImage.key,
          initialImage.data,
          "application/vnd.axiom.image+zip",
        );
        await putAttachment(
          initialImage.previewKey,
          initialImage.preview,
          "image/png",
        );
      }
      const result = await workspaceMutation(
        userId,
        input.mutationId,
        "tool-create",
        input,
        async (client) => {
          await requireScope(client, userId, space.id, "edit");
          const resourceId = input.id ?? randomUUID();
          if (input.parentId) {
            const {
              rows: [parent],
            } = await client.query(
              "SELECT * FROM resources WHERE id=$1 FOR SHARE",
              [input.parentId],
            );
            if (
              !parent ||
              parent.kind !== "folder" ||
              parent.space_id !== space.id ||
              parent.deleted_at
            )
              throw new HttpError(
                400,
                "Choose an available folder in this workspace.",
              );
          }
          if (input.kind !== "image") {
            if (input.kind === "math" && input.source.length > 30000)
              throw new HttpError(
                413,
                "Math projects are limited to 30,000 characters at creation.",
              );
            if (input.kind === "text" && input.source.length > 1_000_000)
              throw new HttpError(413, "Text exceeds one million characters.");
            await createNote(
              {
                id: resourceId,
                groupId: space.group_id,
                projectId: space.project_id,
                userId,
                title: input.name,
                body: input.source,
                sourceFormat: input.kind === "math" ? "latex" : input.kind,
                initialState: input.initialState,
                visibility: space.kind === "personal" ? "private" : "shared",
              },
              client,
            );
          } else
            await client.query(
              "INSERT INTO resources(id,space_id,kind,name,owner_id) VALUES($1,$2,'file',$3,$4)",
              [
                resourceId,
                space.id,
                input.name.endsWith(".axiom-image")
                  ? input.name
                  : input.name + ".axiom-image",
                userId,
              ],
            );
          await client.query("UPDATE resources SET parent_id=$2 WHERE id=$1", [
            resourceId,
            input.parentId,
          ]);
          if (initialImage) {
            const versionId = randomUUID();
            await reserveCapacity(
              client,
              space.id,
              initialImage.data.length + initialImage.preview.length,
            );
            await client.query(
              "INSERT INTO attachments(id,name,mime,bytes,storage_key,sha256) VALUES($1,$2,'application/vnd.axiom.image+zip',$3,$4,$5)",
              [
                versionId,
                input.name.endsWith(".axiom-image")
                  ? input.name
                  : input.name + ".axiom-image",
                initialImage.data.length,
                initialImage.key,
                createHash("sha256").update(initialImage.data).digest("hex"),
              ],
            );
            await client.query(
              "INSERT INTO file_versions(id,resource_id,ordinal,created_by) VALUES($1,$2,1,$3)",
              [versionId, resourceId, userId],
            );
            await client.query(
              "INSERT INTO file_derivatives(version_id,kind,storage_key,mime,bytes) VALUES($1,'image-project-v1',$2,'image/png',$3)",
              [versionId, initialImage.previewKey, initialImage.preview.length],
            );
            await client.query(
              "UPDATE resources SET current_version_id=$2 WHERE id=$1",
              [resourceId, versionId],
            );
          }
          await client.query(
            "INSERT INTO tool_projects(resource_id,kind) VALUES($1,$2)",
            [resourceId, input.kind],
          );
          await recordActivity(client, {
            spaceId: space.id,
            userId,
            kind: "created",
            title: `Created ${input.kind} studio project`,
            resourceId,
          });
          return {
            id: resourceId,
            kind: input.kind,
            initialKey: initialImage?.key,
          };
        },
      );
      initialPublished =
        !!initialImage && result.initialKey === initialImage.key;
      await notifyWorkspace();
      return json({ id: result.id, kind: result.kind }, 201);
    } finally {
      if (initialImage && !initialPublished)
        await Promise.all([
          removeAttachment(initialImage.key).catch(() => {}),
          removeAttachment(initialImage.previewKey).catch(() => {}),
        ]);
    }
  }
  if (!id || !uuid.safeParse(id).success) return null;
  const { resource, space } = await resourceAccess(
    userId,
    id,
    method === "GET" ? "read" : "edit",
  );
  const [project] = await query(
    "SELECT p.*,n.generation FROM tool_projects p LEFT JOIN notes n ON n.id=p.resource_id WHERE resource_id=$1",
    [id],
  );
  if (!project) throw new HttpError(404, "This studio project is unavailable.");
  if (!action && method === "GET")
    return json({
      ...project,
      name: resource.name,
      parent_id: resource.parent_id,
      space_id: resource.space_id,
      current_version_id: resource.current_version_id,
      role: space.role,
      updated_at: resource.updated_at,
    });
  if (action === "settings" && method === "PATCH") {
    const input = z
      .object({ settings, version: z.number().int().positive() })
      .parse(await request.json());
    await transaction(async (client) => {
      await requireScope(client, userId, resource.space_id, "edit");
      const r = await client.query(
        "UPDATE tool_projects SET settings=$2,version=version+1 WHERE resource_id=$1 AND version=$3 RETURNING version",
        [
          id,
          JSON.stringify(
            project.kind === "math"
              ? mathProjectSettings.parse(input.settings)
              : input.settings,
          ),
          input.version,
        ],
      );
      if (!r.rowCount)
        throw new HttpError(
          409,
          "Studio settings changed elsewhere. Reload before applying your changes.",
        );
    });
    return json({ ok: true });
  }
  if (action === "history") {
    if (method === "GET")
      return json(
        await query(
          'SELECT h.*,u.name AS author FROM tool_history h JOIN "user" u ON u.id=h.author_id WHERE resource_id=$1 ORDER BY created_at DESC LIMIT 100',
          [id],
        ),
      );
    if (method === "POST") {
      const input = z
        .object({
          source: z.string().max(30000),
          label: z.string().trim().min(1).max(120),
          mutationId: uuid,
        })
        .parse(await request.json());
      return json(
        await workspaceMutation(
          userId,
          input.mutationId,
          "tool-snapshot",
          input,
          async (client) => {
            await requireScope(client, userId, resource.space_id, "edit");
            return (
              await client.query(
                "INSERT INTO tool_history(resource_id,author_id,label,source) VALUES($1,$2,$3,$4) RETURNING id",
                [id, userId, input.label, input.source],
              )
            ).rows[0];
          },
        ),
        201,
      );
    }
  }
  if (action === "lease" && project.kind === "image") {
    if (method === "GET")
      return json(
        (
          await query(
            'SELECT l.owner_id,l.expires_at,u.name FROM image_edit_leases l JOIN "user" u ON u.id=l.owner_id WHERE resource_id=$1 AND expires_at>now()',
            [id],
          )
        )[0] ?? null,
      );
    const input = z
      .object({ token: uuid.optional(), release: z.boolean().default(false) })
      .parse(await request.json());
    const lease = await transaction(async (client) => {
      await requireScope(client, userId, resource.space_id, "edit");
      await client.query(
        "SELECT resource_id FROM tool_projects WHERE resource_id=$1 FOR UPDATE",
        [id],
      );
      const {
        rows: [current],
      } = await client.query(
        "SELECT * FROM image_edit_leases WHERE resource_id=$1 FOR UPDATE",
        [id],
      );
      if (input.release) {
        if (current?.owner_id === userId && current.token === input.token)
          await client.query(
            "UPDATE image_edit_leases SET expires_at=now() WHERE resource_id=$1",
            [id],
          );
        return null;
      }
      const active =
        current && new Date(current.expires_at).valueOf() > Date.now();
      if (
        active &&
        (current.owner_id !== userId || current.token !== input.token)
      )
        throw new HttpError(
          409,
          "This image is open for editing in another session. You can view the saved version or make a copy.",
        );
      const token = active ? current.token : randomUUID();
      const {
        rows: [saved],
      } = await client.query(
        "INSERT INTO image_edit_leases(resource_id,owner_id,token,fence,expires_at) VALUES($1,$2,$3,1,now()+interval '90 seconds') ON CONFLICT(resource_id) DO UPDATE SET owner_id=$2,token=$3,fence=CASE WHEN image_edit_leases.token=$3 THEN image_edit_leases.fence ELSE image_edit_leases.fence+1 END,expires_at=now()+interval '90 seconds',updated_at=now() RETURNING *",
        [id, userId, token],
      );
      return {
        token: saved.token,
        fence: Number(saved.fence),
        expiresAt: saved.expires_at,
        ownerId: saved.owner_id,
      };
    });
    return json(lease);
  }
  if (action === "save" && method === "POST" && project.kind === "image") {
    const input = z
      .object({
        token: uuid,
        fence: z.number().int().positive(),
        expectedVersion: uuid.nullable(),
        mutationId: uuid,
        bundle: z.string().max(48_000_000),
      })
      .parse(await request.json());
    const data = Buffer.from(input.bundle, "base64");
    if (data.length > 36_000_000)
      throw new HttpError(
        413,
        "Project exceeds the 36 MB save limit. Export it locally to preserve your work.",
      );
    const zip = await JSZip.loadAsync(data);
    let total = 0;
    if (Object.keys(zip.files).length > 300)
      throw new HttpError(400, "Too many project assets.");
    for (const entry of Object.values(zip.files)) {
      total +=
        (entry as typeof entry & { _data?: { uncompressedSize: number } })._data
          ?.uncompressedSize ?? 0;
      if (
        total > 200_000_000 ||
        (!/^manifest\.json$|^preview\.png$|^layers\/[\da-f-]+\.png$/.test(
          entry.name,
        ) &&
          !entry.dir)
      )
        throw new HttpError(400, "Unsafe or oversized image bundle.");
    }
    const manifestFile = zip.file("manifest.json") as
      (JSZip.JSZipObject & { _data?: { uncompressedSize: number } }) | null;
    if (
      !manifestFile ||
      (manifestFile._data?.uncompressedSize ?? 0) > 1_000_000
    )
      throw new HttpError(400, "Image manifest is missing or too large.");
    const manifest = imageProjectManifest.parse(
      JSON.parse((await zip.file("manifest.json")?.async("string")) ?? "null"),
    );
    if (
      manifest?.format !== "axiom-image" ||
      manifest.version !== 1 ||
      !Number.isInteger(manifest.width) ||
      manifest.width < 1 ||
      manifest.width > 8192 ||
      !Number.isInteger(manifest.height) ||
      manifest.height < 1 ||
      manifest.height > 8192 ||
      manifest.width * manifest.height > 16_000_000 ||
      !Array.isArray(manifest.layers) ||
      manifest.layers.length > 100
    )
      throw new HttpError(400, "Invalid image project manifest.");
    if (manifest.layers.length * manifest.width * manifest.height > 64_000_000)
      throw new HttpError(400, "Image project exceeds the layer pixel budget.");
    for (const layer of manifest.layers) {
      for (const name of [layer.asset, layer.mask].filter(
        (value): value is string => !!value,
      )) {
        const asset = zip.file(name);
        if (
          !asset ||
          !isProjectPng(
            await asset.async("uint8array"),
            manifest.width,
            manifest.height,
          )
        )
          throw new HttpError(
            400,
            "Layer or mask dimensions do not match the project.",
          );
      }
    }
    const previewFile = zip.file("preview.png") as
      (JSZip.JSZipObject & { _data?: { uncompressedSize: number } }) | null;
    if (!previewFile || (previewFile._data?.uncompressedSize ?? 0) > 64_000_000)
      throw new HttpError(400, "Image preview is missing or too large.");
    const preview = await previewFile.async("nodebuffer");
    if (
      preview.length < 24 ||
      !preview
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      preview.readUInt32BE(16) !== manifest.width ||
      preview.readUInt32BE(20) !== manifest.height
    )
      throw new HttpError(
        400,
        "Image preview dimensions do not match the project.",
      );
    const key = randomUUID();
    await putAttachment(key, data, "application/vnd.axiom.image+zip");
    const previewKey = randomUUID();
    let published = false;
    try {
      await putAttachment(previewKey, preview, "image/png");
      const result = await workspaceMutation(
        userId,
        input.mutationId,
        "image-save",
        {
          id,
          sha256: createHash("sha256").update(data).digest("hex"),
          token: input.token,
          fence: input.fence,
          expectedVersion: input.expectedVersion,
        },
        async (client) => {
          await requireScope(client, userId, resource.space_id, "edit");
          const {
            rows: [target],
          } = await client.query(
            "SELECT * FROM resources WHERE id=$1 FOR UPDATE",
            [id],
          );
          if (
            !target ||
            target.deleted_at ||
            target.space_id !== resource.space_id
          )
            throw new HttpError(
              409,
              "This project moved or was deleted. Save a copy of your local draft.",
            );
          const {
            rows: [lease],
          } = await client.query(
            "SELECT * FROM image_edit_leases WHERE resource_id=$1 FOR UPDATE",
            [id],
          );
          if (
            !lease ||
            lease.owner_id !== userId ||
            lease.token !== input.token ||
            Number(lease.fence) !== input.fence ||
            new Date(lease.expires_at).valueOf() <= Date.now()
          )
            throw new HttpError(
              409,
              "Your edit lease expired. Your local draft is retained; reacquire editing access or save a copy.",
            );
          if (target.current_version_id !== input.expectedVersion)
            throw new HttpError(
              409,
              "A newer version was saved. Keep your draft and save it as a copy.",
            );
          await reserveCapacity(
            client,
            target.space_id,
            data.length + preview.length,
          );
          const version = randomUUID();
          await client.query(
            "INSERT INTO attachments(id,name,mime,bytes,storage_key,sha256) VALUES($1,$2,'application/vnd.axiom.image+zip',$3,$4,$5)",
            [
              version,
              target.name,
              data.length,
              key,
              createHash("sha256").update(data).digest("hex"),
            ],
          );
          await client.query(
            "INSERT INTO file_versions(id,resource_id,ordinal,created_by) SELECT $1,$2,coalesce(max(ordinal),0)+1,$3 FROM file_versions WHERE resource_id=$2",
            [version, id, userId],
          );
          await client.query(
            "INSERT INTO file_derivatives(version_id,kind,storage_key,mime,bytes) VALUES($1,'image-project-v1',$2,'image/png',$3)",
            [version, previewKey, preview.length],
          );
          await client.query(
            "UPDATE resources SET current_version_id=$2,version=version+1,updated_at=now() WHERE id=$1",
            [id, version],
          );
          await recordActivity(client, {
            spaceId: target.space_id,
            userId,
            resourceId: id,
            kind: "uploaded",
            title: "Saved an image project version",
          });
          return { versionId: version, storageKey: key };
        },
      );
      published = result.storageKey === key;
      await notifyWorkspace();
      return json({ versionId: result.versionId });
    } finally {
      if (!published) {
        await removeAttachment(key).catch(() => {});
        await removeAttachment(previewKey).catch(() => {});
      }
    }
  }
  return null;
}

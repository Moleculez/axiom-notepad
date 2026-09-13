import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { fileTypeIds, fileTypes, sourceForNewFile } from "./file-types";
import { resourceNameSchema } from "./workspace";
import { workspaceApi } from "./workspace-api";
import { researchToolsApi } from "./research-tools-api";
import { officeTemplate } from "./office-templates";
import { putAttachment, removeAttachment } from "./storage";
import {
  workspaceMutation,
  requireScope,
  recordActivity,
  workspaceJson,
} from "./workspace-service";
import { reserveCapacity } from "./uploads-api";
import { HttpError, spaceAccess } from "./access";
import { notifyWorkspace } from "./documents";
export async function fileCreateApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  if (path.join("/") !== "files/new" || request.method !== "POST") return null;
  const input = z
    .object({
      type: z.enum(fileTypeIds),
      id: z.uuid().optional(),
      name: resourceNameSchema,
      spaceId: z.uuid(),
      parentId: z.uuid().nullable().default(null),
      mutationId: z.uuid(),
      source: z.string().max(5_000_000).optional(),
      initialState: z.string().max(8_000_000).optional(),
      settings: z.record(z.string(), z.unknown()).optional(),
    })
    .parse(await request.json());
  const type = fileTypes.find((t) => t.id === input.type)!,
    name =
      ["markdown", "math", "canvas"].includes(input.type) ||
      input.name.toLowerCase().endsWith("." + type.extension)
        ? input.name
        : input.name + "." + type.extension;
  const body = {
    ...input,
    name,
    source: input.source ?? sourceForNewFile(input.type),
  };
  const forward = (value: object) =>
    new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(value),
    });
  if (input.type === "markdown")
    return workspaceApi(
      forward({ ...body, kind: "note", body: body.source }),
      ["resources"],
      userId,
    );
  if (!["docx", "xlsx", "pptx"].includes(input.type))
    return researchToolsApi(
      forward({
        ...body,
        kind: ["csv", "json", "yaml"].includes(input.type)
          ? "text"
          : input.type,
      }),
      ["tools"],
      userId,
    );
  await spaceAccess(userId, input.spaceId, "edit");
  const template = await officeTemplate(input.type as "docx" | "xlsx" | "pptx"),
    storageKey = randomUUID();
  await putAttachment(storageKey, template.data, template.mime);
  let published = false;
  try {
    const result = await workspaceMutation(
      userId,
      input.mutationId,
      "file-template-create",
      input,
      async (client) => {
        await requireScope(client, userId, input.spaceId, "edit");
        if (input.parentId) {
          const {
            rows: [parent],
          } = await client.query(
            "SELECT kind,space_id,deleted_at FROM resources WHERE id=$1 FOR SHARE",
            [input.parentId],
          );
          if (
            !parent ||
            parent.kind !== "folder" ||
            parent.space_id !== input.spaceId ||
            parent.deleted_at
          )
            throw new HttpError(409, "Destination folder is unavailable.");
        }
        await reserveCapacity(client, input.spaceId, template.data.length);
        const id = input.id ?? randomUUID(),
          version = randomUUID();
        await client.query(
          "INSERT INTO resources(id,space_id,parent_id,kind,name,owner_id) VALUES($1,$2,$3,'file',$4,$5)",
          [id, input.spaceId, input.parentId, name, userId],
        );
        await client.query(
          "INSERT INTO attachments(id,name,mime,bytes,storage_key,sha256) VALUES($1,$2,$3,$4,$5,$6)",
          [
            version,
            name,
            template.mime,
            template.data.length,
            storageKey,
            createHash("sha256").update(template.data).digest("hex"),
          ],
        );
        await client.query(
          "INSERT INTO file_versions(id,resource_id,ordinal,created_by) VALUES($1,$2,1,$3)",
          [version, id, userId],
        );
        await client.query(
          "UPDATE resources SET current_version_id=$2 WHERE id=$1",
          [id, version],
        );
        await recordActivity(client, {
          spaceId: input.spaceId,
          userId,
          resourceId: id,
          kind: "created",
          title: `Created ${name}`,
        });
        return { id, kind: "file", name, versionId: version, storageKey };
      },
    );
    published = result.storageKey === storageKey;
    await notifyWorkspace();
    return workspaceJson(
      {
        id: result.id,
        kind: result.kind,
        name: result.name,
        versionId: result.versionId,
      },
      201,
    );
  } finally {
    if (!published) await removeAttachment(storageKey).catch(() => {});
  }
}

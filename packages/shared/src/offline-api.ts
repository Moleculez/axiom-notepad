import { z } from "zod";
import * as Y from "yjs";
import { query } from "./db";
import {
  HttpError,
  fileAccess,
  noteAccess,
  resourceAccess,
  spaceAccessEpoch,
} from "./access";
import { flushNote } from "./documents";
import { documentSource } from "./document-format";
import { workspaceApi } from "./workspace-api";
import { researchToolsApi } from "./research-tools-api";
import { filePreviewApi } from "./file-preview-api";
import { researchApi } from "./research-api";
import { uploadsApi } from "./uploads-api";
import { parseCanvas } from "./canvas";
import { getAttachment } from "./storage";
import { createHash } from "node:crypto";
import { workspaceJson as json } from "./workspace-service";
import type { OfflineManifest } from "./offline";
export async function offlineApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  if (path.join("/") !== "offline/manifest" || request.method !== "POST")
    return null;
  const { id } = z.object({ id: z.uuid() }).parse(await request.json()),
    { resource, space } = await resourceAccess(userId, id);
  const items = await query<{
    id: string;
    kind: string;
    current_version_id: string | null;
    name: string;
  }>(
    `WITH RECURSIVE tree AS (SELECT id,kind,current_version_id,name FROM resources WHERE id=$1 AND deleted_at IS NULL UNION SELECT r.id,r.kind,r.current_version_id,r.name FROM resources r JOIN tree t ON r.parent_id=t.id WHERE r.space_id=$2 AND r.deleted_at IS NULL) SELECT * FROM tree LIMIT 501`,
    [id, space.id],
  );
  if (items.length > 500)
    throw new HttpError(
      413,
      "Choose a smaller folder: each offline package supports 500 items.",
    );
  const manifest: OfflineManifest = {
    spaceId: space.id,
    rootId: id,
    name: resource.name,
    epoch: await spaceAccessEpoch(space.id),
    entries: [],
    documents: [],
    files: [],
    resourceIds: items.map((i) => i.id),
  };
  const fetchEntry = async (key: string) => {
    const req = new Request(new URL(`/api/v1/${key}`, request.url)),
      p = key.split("?", 1)[0].split("/");
    const response =
      (await workspaceApi(req, p, userId)) ??
      (await researchToolsApi(req, p, userId)) ??
      (await uploadsApi(req, p, userId)) ??
      (await filePreviewApi(req, p, userId));
    if (!response?.ok)
      throw new HttpError(
        409,
        "Offline metadata changed while preparing. Retry this package.",
      );
    manifest.entries.push({ key, value: await response.json() });
  };
  const versions = new Set(
    items.map((i) => i.current_version_id).filter((id): id is string => !!id),
  );
  for (const item of items) {
    await fetchEntry(`resources/${item.id}`);
    await fetchEntry(`resources/${item.id}/location`);
    if (item.kind === "note") {
      const before = await noteAccess(userId, item.id);
      await flushNote(before);
      const note = await noteAccess(userId, item.id);
      const [saved] = await query("SELECT state FROM documents WHERE room=$1", [
        `${note.id}:${note.generation}`,
      ]);
      if (!saved)
        throw new HttpError(
          409,
          "Document state is unavailable. Reconnect and retry.",
        );
      const doc = new Y.Doc();
      try {
        Y.applyUpdate(doc, new Uint8Array(saved.state));
        for (const u of await query(
          "SELECT data FROM document_updates WHERE room=$1 ORDER BY id",
          [`${note.id}:${note.generation}`],
        ))
          Y.applyUpdate(doc, new Uint8Array(u.data));
        manifest.documents.push({
          id: note.id,
          generation: note.generation,
          state: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64"),
          source: documentSource(doc, note.source_format),
          format: note.source_format ?? "markdown",
          editable: space.role === "editor",
        });
      } finally {
        doc.destroy();
      }
      manifest.entries.push({ key: `notes/${item.id}`, value: note });
      if (note.source_format === "canvas")
        for (const node of parseCanvas(note.body).nodes) {
          if (
            node.type === "file" &&
            node.resourceId &&
            !manifest.entries.some(
              (e) => e.key === `resources/${node.resourceId}`,
            )
          ) {
            try {
              await fetchEntry(`resources/${node.resourceId}`);
            } catch (error) {
              if (
                !(error instanceof HttpError) ||
                ![403, 404].includes(error.status)
              )
                throw error;
            }
          }
        }
      await fetchEntry(`notes/${item.id}/context`);
      for (const r of await query(
        "SELECT f AS id FROM axiom_file_references($1) f",
        [note.body],
      ))
        versions.add(r.id);
    }
    const [tool] = await query(
      "SELECT kind FROM tool_projects WHERE resource_id=$1",
      [item.id],
    );
    if (tool) await fetchEntry(`tools/${item.id}`);
    if (item.kind === "file" && item.current_version_id) {
      await fetchEntry(`files/${item.id}/versions`);
      await fetchEntry(`files/${item.id}/preview`);
      await fetchEntry(
        `files/${item.id}/preview?version=${item.current_version_id}`,
      );
    }
  }
  for (const version of versions) {
    await fileAccess(userId, version);
    const [file] = await query(
      "SELECT a.mime,a.bytes,a.sha256,v.resource_id,r.current_version_id FROM attachments a JOIN file_versions v ON v.id=a.id JOIN resources r ON r.id=v.resource_id WHERE a.id=$1",
      [version],
    );
    if (file) {
      const aliases = [
        `files/${file.resource_id}/content?version=${version}`,
        `files/${file.resource_id}/download?version=${version}`,
        ...(file.current_version_id === version
          ? [
              `files/${file.resource_id}/content`,
              `files/${file.resource_id}/download`,
            ]
          : []),
      ];
      manifest.files.push({
        key: `attachments/${version}`,
        mime: file.mime,
        bytes: Number(file.bytes),
        sha256: file.sha256,
        aliases,
      });
      for (const action of ["meta", "annotations"]) {
        const key = `attachments/${version}/${action}`,
          response = await researchApi(
            new Request(new URL(`/api/v1/${key}`, request.url)),
            key.split("/"),
            userId,
          );
        if (response?.ok)
          manifest.entries.push({ key, value: await response.json() });
      }
      const derivatives = await query(
        "SELECT storage_key,mime,bytes FROM file_derivatives WHERE version_id=$1 AND kind IN ('image-project-v1','office-pdf-v1')",
        [version],
      );
      for (const derivative of derivatives) {
        const bytes = await getAttachment(derivative.storage_key);
        manifest.files.push({
          key: `files/${file.resource_id}/preview-content?version=${version}`,
          bytes: Number(derivative.bytes),
          mime: derivative.mime,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }
    }
  }
  if (manifest.files.reduce((sum, f) => sum + f.bytes, 0) > 512 * 1024 * 1024)
    throw new HttpError(
      413,
      "Choose a smaller package: offline file downloads are limited to 512 MB per selection.",
    );
  // Recheck after preparing, before returning any content to the client.
  await resourceAccess(userId, id);
  if ((await spaceAccessEpoch(space.id)) !== manifest.epoch)
    throw new HttpError(
      409,
      "Workspace access changed while preparing. Retry online.",
    );
  return json(manifest);
}

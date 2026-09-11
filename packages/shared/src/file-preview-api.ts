import { z } from "zod";
import { fileAccess, resourceAccess, HttpError } from "./access";
import { detectStoredMime } from "./storage-streams";
import { previewKind, type FilePreviewManifest } from "./file-preview";
import { workspaceJson as json } from "./workspace-service";
import { query, transaction } from "./db";
import { requireScope } from "./workspace-service";
import { fileResponse } from "./storage-streams";

export async function previewAccess(
  userId: string,
  id: string,
  version: string | null,
) {
  const { resource } = await resourceAccess(
    userId,
    z.uuid().parse(id),
    "read",
    true,
  );
  if (resource.kind !== "file")
    throw new HttpError(400, "Choose a stored file.");
  const versionId = version ?? resource.current_version_id;
  if (!versionId)
    throw new HttpError(404, "This file has no saved version yet.");
  const { file, space } = await fileAccess(userId, z.uuid().parse(versionId));
  if (file.resource_id !== resource.id)
    throw new HttpError(404, "This version belongs to another file.");
  const mime =
    file.mime === "application/octet-stream" || file.mime === "application/zip"
      ? await detectStoredMime(
          file.storage_key,
          resource.name,
          Number(file.bytes),
        )
      : file.mime;
  return { file, resource, space, mime };
}

export async function filePreviewApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  const [endpoint, id, action] = path;
  if (
    endpoint !== "files" ||
    !id ||
    !["preview", "preview-convert", "preview-content"].includes(action)
  )
    return null;
  const { file, resource, mime, space } = await previewAccess(
    userId,
    id,
    new URL(request.url).searchParams.get("version"),
  );
  const kind = previewKind(mime, resource.name);
  const [derivative] = await query(
    "SELECT * FROM file_derivatives WHERE version_id=$1 AND kind=$2",
    [file.id,kind==="image-project"?"image-project-v1":"office-pdf-v1"],
  );
  if (
    action === "preview-content" &&
    ["GET", "HEAD"].includes(request.method)
  ) {
    if (!derivative)
      throw new HttpError(404, "The converted preview is not ready.");
    return fileResponse(request, {
      storage_key:derivative.storage_key,bytes:Number(derivative.bytes),mime:derivative.mime,
      name: resource.name + (kind==="image-project"?".png":".pdf"),
      sha256: file.sha256,
    });
  }
  if (action === "preview-convert" && request.method === "POST") {
    if (kind !== "office")
      throw new HttpError(400, "This file does not require Office conversion.");
    if (
      !process.env.OFFICE_CONVERTER_URL ||
      !process.env.OFFICE_CONVERTER_TOKEN
    )
      throw new HttpError(
        503,
        "Private Office conversion has not been configured by the server administrator.",
      );
    if (Number(file.bytes) > 50_000_000)
      throw new HttpError(
        413,
        "Office previews are limited to 50 MB. Download the original instead.",
      );
    const job = await transaction(async (client) => {
      await requireScope(client, userId, resource.space_id, "read");
      if (space.effective_status !== "active" || resource.deleted_at)
        throw new HttpError(
          409,
          "Restore this resource before generating a new preview.",
        );
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        file.id,
      ]);
      const {
        rows: [existing],
      } = await client.query(
        "SELECT id,status FROM tool_jobs WHERE version_id=$1 AND kind='office-preview' AND status IN ('queued','running','complete')",
        [file.id],
      );
      if (existing) return existing;
      return (
        await client.query(
          "INSERT INTO tool_jobs(resource_id,version_id,owner_id,kind,input) VALUES($1,$2,$3,'office-preview',$4) RETURNING id,status",
          [
            id,
            file.id,
            userId,
            JSON.stringify({
              extension: mime.includes("wordprocessing") ? "docx" : "pptx",
            }),
          ],
        )
      ).rows[0];
    });
    return json(job, 202);
  }
  if (action !== "preview" || request.method !== "GET") return null;
  const manifest: FilePreviewManifest = {
    resourceId: id,
    versionId: file.id,
    name: resource.name,
    bytes: Number(file.bytes),
    mime,
    kind,
    source: `/api/v1/files/${id}/content?version=${file.id}`,
    status: "ready",
  };
  if (kind === "office") {
    if (derivative) {
      manifest.kind = "pdf";
      manifest.source = `/api/v1/files/${id}/preview-content?version=${file.id}`;
      manifest.message =
        "Private Office conversion · formatting may differ from the original.";
    } else {
      const [job] = await query(
        "SELECT id,status,error FROM tool_jobs WHERE version_id=$1 AND kind='office-preview' ORDER BY created_at DESC LIMIT 1",
        [file.id],
      );
      manifest.status =
        job && ["queued", "running"].includes(job.status)
          ? "queued"
          : job?.status === "failed"
            ? "failed"
            : "unavailable";
      manifest.jobId = job?.id;
      manifest.message =
        manifest.status === "queued"
          ? "Private conversion is in progress…"
          : (job?.error ??
            (process.env.OFFICE_CONVERTER_URL
              ? "Generate a private PDF preview. The source document stays unchanged."
              : "Office preview needs the private conversion service. Download the unchanged original in the meantime."));
    }
  }
  if(kind==="image-project"&&derivative){manifest.kind="image";manifest.source=`/api/v1/files/${id}/preview-content?version=${file.id}`;manifest.message="Saved image project preview · open Image Studio to edit layers.";}
  if (kind === "download") {
    manifest.status = "unavailable";
    manifest.message =
      "This format has no safe browser preview. Download the original to open it in its native application.";
  }
  return json(manifest);
}

import { z } from "zod";
import { resourceAccess, HttpError } from "./access";
import { query } from "./db";
import { filePreviewApi } from "./file-preview-api";
import { workspaceJson } from "./workspace-service";
import type { ResourceCardPreview } from "./canvas-preview";

export async function canvasPreviewApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  const [endpoint, id, action] = path;
  if (
    endpoint !== "resources" ||
    action !== "card-preview" ||
    request.method !== "GET"
  )
    return null;
  const { resource } = await resourceAccess(userId, z.uuid().parse(id), "read");
  if (resource.kind === "folder")
    throw new HttpError(400, "Folders are not preview cards.");
  if (resource.kind === "file") {
    const response = await filePreviewApi(
      request,
      ["files", id, "preview"],
      userId,
    );
    if (!response?.ok) return response;
    const file = await response.json();
    return workspaceJson({
      resource,
      kind: "file",
      file,
      revision: file.versionId,
    } satisfies ResourceCardPreview);
  }
  if (new URL(request.url).searchParams.has("version"))
    throw new HttpError(
      400,
      "Native document cards follow the latest document. File version pins apply to stored files.",
    );
  const [note] = await query(
    "SELECT n.body,n.source_format,n.generation,n.updated_at,coalesce(p.settings,'{}'::jsonb) AS settings FROM notes n LEFT JOIN tool_projects p ON p.resource_id=n.id WHERE n.id=$1",
    [resource.note_id ?? id],
  );
  if (!note) throw new HttpError(404, "The source document is unavailable.");
  return workspaceJson({
    resource,
    kind: "document",
    format: note.source_format,
    source: note.body,
    settings: note.settings,
    revision: `${note.generation}:${new Date(note.updated_at).toISOString()}`,
  } satisfies ResourceCardPreview);
}

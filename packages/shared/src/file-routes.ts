import { previewKind } from "./file-preview";
import type { Resource } from "./workspace";

/** A view is not a storage kind or an access grant. Never infer permissions from a URL. */
export const fileViewRoutes = [
  "notes",
  "canvas",
  "math",
  "text",
  "image",
  "audio",
  "video",
  "pdf",
  "document",
  "files",
] as const;
export type FileViewKind = (typeof fileViewRoutes)[number];
export type FileRouteResource = Pick<Resource, "id"> &
  Partial<
    Pick<Resource, "kind" | "name" | "document_type" | "space_id" | "parent_id">
  > & { mime?: string | null };
export function isFileView(value: string): value is FileViewKind {
  return (fileViewRoutes as readonly string[]).includes(value);
}
export function fileViewKind(resource: FileRouteResource): FileViewKind {
  if (resource.document_type) {
    return resource.document_type === "markdown"
      ? "notes"
      : resource.document_type;
  }
  if (resource.kind === "note") return "notes";
  const kind = previewKind(resource.mime ?? "", resource.name ?? "");
  if (kind === "markdown") return "notes";
  if (kind === "image-project") return "image";
  if (kind === "workbook" || kind === "office") return "document";
  if (kind === "table") return "text";
  return kind === "download" ? "files" : kind;
}
export function fileRoute(
  resource: FileRouteResource,
  versionId?: string | null,
) {
  if (resource.kind === "folder") {
    const params = new URLSearchParams({
      space: resource.space_id ?? "",
      folder: resource.id,
    });
    return `/explorer?${params}`;
  }
  const params = new URLSearchParams();
  if (versionId) params.set("version", versionId);
  return `/${fileViewKind(resource)}/${resource.id}${params.size ? `?${params}` : ""}`;
}
export function fileRouteId(input: string): string | null {
  const parts = new URL(input, "http://workspace.local").pathname
    .replace(/^\/workbench(?=\/|$)/, "")
    .split("/")
    .filter(Boolean);
  const id = isFileView(parts[0])
    ? parts[1]
    : parts[0] === "tools" &&
        ["canvas", "math", "text", "image"].includes(parts[1])
      ? parts[2]
      : null;
  return id && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)
    ? id
    : null;
}
/** Pure legacy migration, including restored tabs. Creating a file always requires confirmation. */
export function normalizeFileRoute(path: string, params: URLSearchParams) {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "tools") return path;
  if (["canvas", "math", "text", "image"].includes(parts[1])) {
    if (parts[2] && parts[2] !== "new") return `/${parts[1]}/${parts[2]}`;
    params.set("create", parts[1]);
  }
  return "/explorer";
}

export type OfflineEntry = {
  key: string;
  packageId: string;
  value?: unknown;
  body?: Blob;
  mime?: string;
  sha256?: string;
  assetKey?: string;
};
export type OfflinePackage = {
  id: string;
  spaceId: string;
  rootId: string;
  name: string;
  state: "preparing" | "ready" | "failed" | "blocked";
  done: number;
  total: number;
  bytes: number;
  epoch: string;
  updatedAt: string;
  error?: string;
  resourceIds: string[];
  keys?: string[];
};
export type OfflineCommand = {
  id: string;
  path: string;
  method: string;
  body: Record<string, unknown>;
  resourceId: string;
  spaceId: string;
  status: "queued" | "syncing" | "conflict" | "blocked" | "done" | "cancelled";
  requestBody?: string;
  createdAt: string;
  error?: string;
  result?: unknown;
};
export type OfflineManifest = {
  spaceId: string;
  rootId: string;
  name: string;
  epoch: string;
  entries: { key: string; value: unknown }[];
  documents: {
    id: string;
    generation: number;
    state: string;
    source: string;
    format: "markdown" | "latex" | "text" | "canvas";
    editable: boolean;
  }[];
  files: {
    key: string;
    bytes: number;
    sha256: string;
    mime: string;
    aliases?: string[];
  }[];
  resourceIds: string[];
};
export function offlineMutation(
  path: string,
  method: string,
  body: Record<string, unknown>,
) {
  if (method === "POST" && path === "files/new")
    return [
      "markdown",
      "canvas",
      "math",
      "text",
      "csv",
      "json",
      "yaml",
    ].includes(String(body.type))
      ? "create"
      : null;
  if (method === "POST" && path === "tools")
    return ["canvas", "math", "text"].includes(String(body.kind))
      ? "create"
      : null;
  if (method === "POST" && path === "resources")
    return ["folder", "note"].includes(String(body.kind)) ? "create" : null;
  if (
    method === "PATCH" &&
    /^resources\/[\da-f-]{36}$/.test(path) &&
    Object.keys(body).every((k) =>
      [
        "mutationId",
        "version",
        "name",
        "description",
        "tags",
        "parentId",
      ].includes(k),
    )
  )
    return "update";
  if (method === "POST" && /^resources\/[\da-f-]{36}\/trash$/.test(path))
    return "trash";
  return null;
}

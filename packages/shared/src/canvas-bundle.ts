import { createHash } from "node:crypto";
import { posix } from "node:path";
import { Readable } from "node:stream";
import type { PoolClient } from "pg";
import { ZipFile } from "yazl";
import { exportJsonCanvas, parseCanvas, type CanvasData } from "./canvas";
import { canvasMarkdown } from "./canvas-export";
import { rewriteLinks } from "./archive";
import { documentExtension } from "./document-format";
import { attachmentStream, availableStorageBytes } from "./storage-streams";

const safeName = (name: string) =>
  name
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .replace(/^\.+/, "_")
    .slice(0, 90) || "Untitled";
const sha = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
type Entry = {
  id: string;
  resourceId: string;
  name: string;
  source_format?: string;
  body?: string;
  generation?: number;
  updated_at?: Date;
  settings?: unknown;
  versionId?: string;
  storage_key?: string;
  bytes?: number;
  sha256?: string;
  path: string;
};

/** Called under the export worker's repeatable-read snapshot and blob lease. */
export async function buildCanvasBundle(
  client: PoolClient,
  record: {
    user_id: string;
    resource_ids: string[];
    options: { canvasSnapshot: CanvasData };
  },
) {
  const rootId = record.resource_ids[0],
    snapshot = parseCanvas(JSON.stringify(record.options.canvasSnapshot));
  const entries = new Map<string, Entry>(),
    files = new Map<string, Entry>(),
    latestFiles = new Map<string, string>(),
    required = new Set([rootId]),
    omissions: { reference: string; reason: string }[] = [];
  const queue: { id?: string; version?: string; depth: number }[] = [
      { id: rootId, depth: 0 },
    ],
    seen = new Set<string>();
  let textBytes = 0,
    fileBytes = 0;
  for (let index = 0; index < queue.length; index++) {
    const ref = queue[index],
      key = `${ref.id ?? "attachment"}:${ref.version ?? "latest"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (entries.size + files.size >= 1000) {
      omissions.push({
        reference: key,
        reason: "1,000 dependency limit reached",
      });
      continue;
    }
    if (ref.depth > 8) {
      omissions.push({
        reference: key,
        reason: "Nested dependency depth limit reached",
      });
      continue;
    }
    const {
      rows: [resource],
    } = await client.query(
      "SELECT r.*,n.body,n.source_format,n.generation,n.updated_at,coalesce(p.settings,'{}'::jsonb) AS settings FROM resources r LEFT JOIN notes n ON n.id=r.note_id LEFT JOIN tool_projects p ON p.resource_id=r.id WHERE r.id=coalesce($1::uuid,(SELECT resource_id FROM file_versions WHERE id=$2::uuid)) AND r.deleted_at IS NULL AND axiom_space_role($3,r.space_id) IS NOT NULL",
      [ref.id ?? null, ref.version ?? null, record.user_id],
    );
    if (!resource) {
      if (ref.id === rootId)
        throw new Error("The canvas is no longer available to export.");
      omissions.push({
        reference: key,
        reason: "Unavailable or not authorized",
      });
      continue;
    }
    if (resource.kind === "file") {
      const {
        rows: [file],
      } = await client.query(
        "SELECT a.*,v.resource_id FROM attachments a JOIN file_versions v ON v.id=a.id WHERE v.resource_id=$1 AND a.id=$2",
        [resource.id, ref.version ?? resource.current_version_id],
      );
      if (!file) {
        omissions.push({ reference: key, reason: "File version unavailable" });
        continue;
      }
      if (!ref.version) latestFiles.set(resource.id, file.id);
      if (files.has(file.id)) continue;
      fileBytes += Number(file.bytes);
      if (fileBytes > 100_000_000_000)
        throw new Error(
          "Canvas bundle exceeds 100 GB. Export fewer linked files.",
        );
      files.set(file.id, {
        ...file,
        resourceId: resource.id,
        versionId: file.id,
        path: `assets/${file.id}/${safeName(file.name)}`,
      });
      required.add(resource.id);
      continue;
    }
    if (resource.kind !== "note" || typeof resource.body !== "string") {
      omissions.push({
        reference: key,
        reason: "This resource type has no portable source",
      });
      continue;
    }
    if (entries.has(resource.id)) continue;
    const body =
      resource.id === rootId ? JSON.stringify(snapshot) : resource.body;
    textBytes += Buffer.byteLength(body);
    if (textBytes > 25_000_000)
      throw new Error(
        "Canvas bundle exceeds 25 MB of source text. Export a smaller selection.",
      );
    const entry: Entry = {
      ...resource,
      id: resource.id,
      resourceId: resource.id,
      body,
      path:
        resource.id === rootId
          ? `${safeName(resource.name.replace(/\.canvas$/i, ""))}.canvas`
          : `sources/${resource.id}/${safeName(resource.name)}.${documentExtension(resource.source_format)}`,
    };
    entries.set(resource.id, entry);
    required.add(resource.id);
    if (resource.source_format === "canvas") {
      for (const node of parseCanvas(body).nodes) {
        if (node.type === "file") {
          if (node.resourceId)
            queue.push({
              id: node.resourceId,
              version: node.versionId,
              depth: ref.depth + 1,
            });
          else
            omissions.push({
              reference: node.file,
              reason:
                "Imported file path is not linked to a workspace resource",
            });
        }
        if (node.type === "link")
          omissions.push({
            reference: node.url,
            reason: "External webpage retained as a link; not downloaded",
          });
      }
    }
    // Inline images in Markdown cards and documents use exact stored versions.
    const { rows: inlineFiles } = await client.query(
      "SELECT axiom_file_references($1) AS id",
      [body],
    );
    for (const file of inlineFiles)
      queue.push({ version: file.id, depth: ref.depth + 1 });
  }
  const free = await availableStorageBytes();
  if (free !== null && free < fileBytes + textBytes + 256 * 1024 * 1024)
    throw new Error(
      "Not enough disk space to prepare the canvas bundle safely.",
    );
  const zip = new ZipFile(),
    manifestEntries: Record<string, unknown>[] = [];
  zip.on("error", (error) => (zip.outputStream as Readable).destroy(error));
  const addText = (
    path: string,
    value: string,
    metadata: Record<string, unknown> = {},
  ) => {
    zip.addBuffer(Buffer.from(value), path);
    manifestEntries.push({
      path,
      bytes: Buffer.byteLength(value),
      sha256: sha(value),
      ...metadata,
    });
  };
  const linkedPath = (resourceId?: string, version?: string) =>
    version
      ? files.get(version)?.path
      : resourceId
        ? (entries.get(resourceId)?.path ??
          files.get(latestFiles.get(resourceId) ?? "")?.path)
        : undefined;
  const rewrite = (body: string, currentPath: string) =>
    rewriteLinks(body, (node) => {
      const href = node.href ?? "",
        version = /\/api\/v1\/attachments\/([\da-f-]{36})/i.exec(href)?.[1];
      const target = version
        ? files.get(version)?.path
        : entries.get(href.split("#")[0])?.path;
      if (target)
        return (
          posix.relative(posix.dirname(currentPath), target) +
          (href.includes("#") ? "#" + href.split("#")[1] : "")
        );
    });
  for (const entry of entries.values()) {
    let body = entry.body!;
    if (entry.source_format === "canvas") {
      const canvas = parseCanvas(body);
      addText(
        `snapshots/${entry.id}.canvas.json`,
        JSON.stringify(canvas, null, 2),
        { kind: "lossless-canvas", resourceId: entry.id },
      );
      body = exportJsonCanvas({
        ...canvas,
        nodes: canvas.nodes.map((node) => {
          if (node.type === "text")
            return { ...node, text: rewrite(node.text, entry.path) };
          if (node.type !== "file") return node;
          const path = linkedPath(node.resourceId, node.versionId);
          return path
            ? { ...node, file: posix.relative(posix.dirname(entry.path), path) }
            : node;
        }),
      });
      if (entry.id === rootId) {
        addText("canvas-outline.md", canvasMarkdown(canvas), {
          kind: "outline",
        });
        canvas.nodes.forEach((n, i) => {
          if (n.type === "text")
            addText(
              `cards/${i + 1}-${safeName(n.id)}.md`,
              rewrite(n.text, `cards/${i + 1}-${safeName(n.id)}.md`),
              { kind: "card-source", cardId: n.id },
            );
        });
      }
    } else if (entry.source_format === "markdown")
      body = rewrite(body, entry.path);
    addText(entry.path, body, {
      resourceId: entry.id,
      generation: entry.generation,
      updatedAt: entry.updated_at,
      sourceFormat: entry.source_format,
    });
    if (entry.settings && Object.keys(entry.settings).length)
      addText(
        `sources/${entry.id}/project-settings.json`,
        JSON.stringify(entry.settings, null, 2),
        { resourceId: entry.id, kind: "project-settings" },
      );
  }
  for (const file of files.values()) {
    zip.addReadStreamLazy(
      file.path,
      { size: Number(file.bytes), compress: false },
      (callback) => {
        void attachmentStream(file.storage_key!).then(
          (stream) => callback(null, stream),
          (error) => callback(error, Readable.from([])),
        );
      },
    );
    manifestEntries.push({
      path: file.path,
      resourceId: file.resourceId,
      versionId: file.versionId,
      bytes: Number(file.bytes),
      sha256: file.sha256,
    });
  }
  addText(
    "README.md",
    "# Portable research canvas\n\nOpen the .canvas file in a JSON Canvas reader. Linked sources and assets use relative paths. `snapshots/` retains exact internal card metadata; `cards/` contains readable Markdown.\n\nDependencies reflect a permission-checked database snapshot at job execution. External webpages are links, not copies. See `canvas-manifest.json` for revisions, SHA-256 checksums, and omissions. This is an export, not an account backup.\n",
  );
  zip.addBuffer(
    Buffer.from(
      JSON.stringify(
        {
          format: "axiom-canvas-bundle",
          version: 1,
          rootResourceId: rootId,
          createdAt: new Date().toISOString(),
          entries: manifestEntries,
          omissions,
        },
        null,
        2,
      ),
    ),
    "canvas-manifest.json",
  );
  zip.end({ forceZip64Format: true, comment: "Axiom portable canvas bundle" });
  return { output: zip.outputStream as Readable, requiredIds: [...required] };
}

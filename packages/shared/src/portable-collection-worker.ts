import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import type { PoolClient } from "pg";
import { ZipFile } from "yazl";
import { parseCanvas } from "./canvas";
import { documentExtension, type DocumentFormat } from "./document-format";
import { rewriteMarkdownDestinations } from "./workspace-import-links";
import { attachmentStream, availableStorageBytes } from "./storage-streams";
import { IMPORT_LIMITS } from "./collection-path";
import {
  COLLECTION_MANIFEST,
  collectionRelativePath,
  collectionLinkPath,
  portableCollectionSchema,
  portableToolSettings,
  boundedCollectionDiagnostics,
  type PortableCollectionManifest,
  type PortableResource,
} from "./portable-collection";
type ExportResource = {
  id: string;
  parent_id: string | null;
  kind: "folder" | "note" | "file" | "shortcut";
  name: string;
  description: string | null;
  tags: string[];
  source_format: DocumentFormat | null;
  body: string | null;
  generation: number;
  current_version_id: string | null;
  tool_kind: "math" | "canvas" | "text" | "image" | "mindmap" | null;
  settings: unknown;
};
type ExportAsset = ExportResource & {
  originalId: string;
  versionId: string;
  bytes: number | string;
  storage_key: string;
  sha256: string;
};

const safeName = (name: string) =>
  name
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .replace(/^\.+/, "_")
    .slice(0, 100) || "Untitled";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
/** Shares the durable export snapshot/blob lease. No cached private previews,
 * permission restoration, URL downloads or server archive extraction. */
export async function buildPortableCollection(
  client: PoolClient,
  record: {
    user_id: string;
    resource_ids: string[];
    options?: {
      canvasSnapshot?: unknown;
      markdownSnapshot?: { source: string; title: string; generation: number };
    };
  },
) {
  const required = new Set(record.resource_ids),
    roots = new Set(record.resource_ids),
    queue = record.resource_ids.map((id) => ({
      id,
      version: undefined as string | undefined,
      depth: 0,
    })),
    seen = new Set<string>(),
    resources = new Map<string, ExportResource>(),
    files = new Map<string, ExportAsset>(),
    latest = new Map<string, string>(),
    diagnostics: PortableCollectionManifest["diagnostics"] = [];
  const queued = new Set(queue.map((item) => "resource:" + item.id));
  const enqueue = (reference: (typeof queue)[number]) => {
    const key = reference.version
      ? "version:" + reference.version
      : "resource:" + reference.id;
    if (queued.has(key)) return;
    if (queue.length >= IMPORT_LIMITS.entries)
      throw new Error(
        "Too many linked dependencies for a portable collection. Choose a smaller selection.",
      );
    queued.add(key);
    queue.push(reference);
  };
  for (let at = 0; at < queue.length; at++) {
    const reference = queue[at],
      key = reference.version
        ? "version:" + reference.version
        : "resource:" + reference.id;
    if (seen.has(key)) continue;
    seen.add(key);
    if (resources.size + files.size >= 999 || reference.depth > 8) {
      if (roots.has(reference.id))
        throw new Error("Choose a smaller portable collection.");
      diagnostics.push({
        severity: "warning",
        code: "dependency-limit",
        message:
          "A linked dependency exceeds the collection count/depth budget; its source reference is retained.",
      });
      continue;
    }
    const {
      rows: [row],
    } = await client.query<ExportResource>(
      "SELECT r.*,n.body,n.source_format,n.generation,p.kind AS tool_kind,p.settings FROM resources r LEFT JOIN notes n ON n.id=r.note_id LEFT JOIN tool_projects p ON p.resource_id=r.id WHERE r.id=coalesce($1::uuid,(SELECT resource_id FROM file_versions WHERE id=$2::uuid)) AND r.deleted_at IS NULL AND axiom_space_role($3,r.space_id) IS NOT NULL",
      [reference.id || null, reference.version ?? null, record.user_id],
    );
    if (!row) {
      if (roots.has(reference.id))
        throw new Error(
          "A selected file is no longer available. Create a new export.",
        );
      diagnostics.push({
        severity: "warning",
        code: "unavailable-dependency",
        message:
          "An unavailable linked file was omitted. Links do not grant access.",
      });
      continue;
    }
    if (row.kind === "shortcut") {
      diagnostics.push({
        severity: "warning",
        code: "shortcut",
        message:
          "Shortcuts are not restored; select their accessible targets explicitly.",
      });
      continue;
    }
    required.add(row.id);
    if (row.kind === "file") {
      const version = reference.version ?? row.current_version_id;
      if (!version)
        throw new Error("A selected file has no saved asset version.");
      if (files.has(version)) continue;
      const {
        rows: [file],
      } = await client.query<ExportAsset>(
        "SELECT a.*,v.resource_id FROM attachments a JOIN file_versions v ON v.id=a.id WHERE v.resource_id=$1 AND a.id=$2",
        [row.id, version],
      );
      if (!file || !file.sha256)
        throw new Error(
          "A stored asset has no verifiable version. Save or repair it before exporting.",
        );
      if (version === row.current_version_id) latest.set(row.id, version);
      files.set(version, {
        ...row,
        ...file,
        name: row.name,
        originalId: row.id,
        versionId: version,
      });
      continue;
    }
    if (resources.has(row.id)) continue;
    if (
      record.options?.canvasSnapshot &&
      roots.size === 1 &&
      row.id === record.resource_ids[0]
    )
      row.body = JSON.stringify(record.options.canvasSnapshot);
    if (
      record.options?.markdownSnapshot &&
      roots.size === 1 &&
      row.id === record.resource_ids[0]
    ) {
      if (row.generation !== record.options.markdownSnapshot.generation)
        throw new Error("The document generation changed; reopen the export.");
      row.body = record.options.markdownSnapshot.source;
      row.name = record.options.markdownSnapshot.title;
    }
    resources.set(row.id, row);
    if (row.source_format === "canvas") {
      for (const node of parseCanvas(row.body ?? "").nodes) {
        if (node.type === "file") {
          if (node.versionId || node.resourceId)
            enqueue({
              id: node.resourceId ?? "",
              version: node.versionId,
              depth: reference.depth + 1,
            });
          else
            diagnostics.push({
              severity: "warning",
              code: "unresolved-canvas-file",
              message:
                "An unbound Canvas file path was retained without downloading it.",
            });
        }
      }
    }
    if (typeof row.body === "string") {
      const { rows: versions } = await client.query(
        "SELECT axiom_file_references($1) AS id",
        [row.body],
      );
      versions.forEach((file) =>
        enqueue({ id: "", version: file.id, depth: reference.depth + 1 }),
      );
    }
  }
  const zip = new ZipFile(),
    artifacts: PortableCollectionManifest["artifacts"] = [],
    declarations: PortableResource[] = [],
    streams = new Set<Readable>();
  let textBytes = 0,
    expanded = 0,
    zipEntries = 1;
  const count = (bytes: number) => {
    expanded += bytes;
    if (
      ++zipEntries > IMPORT_LIMITS.zipEntries ||
      expanded > IMPORT_LIMITS.zipExpandedBytes
    )
      throw new Error(
        "Portable collections allow 1,000 ZIP entries and 100 MB expanded. Choose a smaller selection or a standard archive.",
      );
  };
  const metadata = (row: ExportResource, name = row.name) => {
    let settings: Record<string, unknown> | undefined;
    if (row.tool_kind) {
      try {
        settings = portableToolSettings(row.tool_kind, row.settings);
      } catch {
        diagnostics.push({
          severity: "warning",
          code: "tool-settings",
          message: `Unsupported project settings on ${name} were omitted; source and assets remain available.`,
        });
      }
    }
    return {
      name,
      description: row.description ?? "",
      tags: row.tags ?? [],
      ...(row.tool_kind
        ? { toolKind: row.tool_kind, settings: settings ?? {} }
        : {}),
    };
  };
  const paths = new Map<string, string>();
  const resourcePath = (id: string, ancestry = new Set<string>()): string => {
    if (paths.has(id)) return paths.get(id)!;
    if (ancestry.has(id) || ancestry.size >= IMPORT_LIMITS.depth)
      throw new Error("Folder hierarchy is cyclic or too deep to export.");
    const row = resources.get(id)!,
      parents = new Set([...ancestry, id]),
      parent = row.parent_id ? resources.get(row.parent_id) : undefined;
    const prefix = parent
      ? resourcePath(parent.id, parents).replace(/\.(md|canvas|tex|txt)$/, "") +
        "/"
      : "";
    const value =
      prefix +
      safeName(row.name) +
      "--" +
      id.slice(0, 8) +
      (row.kind === "note"
        ? "." + documentExtension(row.source_format ?? undefined)
        : "");
    paths.set(id, value);
    return value;
  };
  for (const row of resources.values()) resourcePath(row.id);
  const filePaths = new Map(
    [...files.values()].map((file) => {
      const parent = file.parent_id ? resources.get(file.parent_id) : undefined,
        current = latest.get(file.originalId) === file.versionId;
      return [
        file.versionId,
        current && parent
          ? resourcePath(parent.id).replace(/\.(md|canvas|tex|txt)$/, "") +
            "/" +
            safeName(file.name) +
            "--" +
            file.versionId.slice(0, 8)
          : `_files/${file.versionId}/${safeName(file.name)}`,
      ];
    }),
  );
  const nativePath = (id?: string, version?: string) =>
    version
      ? filePaths.get(version)
      : id
        ? (paths.get(id) ?? filePaths.get(latest.get(id) ?? ""))
        : undefined;
  const addText = (path: string, source: string, resourceId: string) => {
    const bytes = Buffer.byteLength(source);
    textBytes += bytes;
    if (textBytes > IMPORT_LIMITS.markdownBytes)
      throw new Error(
        "Portable collections allow 25 MB of source. Choose a smaller selection.",
      );
    count(bytes);
    zip.addBuffer(Buffer.from(source), path);
    artifacts.push({
      path,
      role: "source",
      resourceId,
      bytes,
      sha256: sha(source),
    });
  };
  for (const row of resources.values()) {
    const path = paths.get(row.id)!;
    declarations.push({
      id: row.id,
      parentId:
        row.parent_id && resources.has(row.parent_id) ? row.parent_id : null,
      kind: row.kind === "folder" ? "folder" : "note",
      path,
      ...(row.kind === "note"
        ? { sourceFormat: row.source_format ?? "markdown" }
        : {}),
      metadata: metadata(row),
    });
    if (row.kind === "folder") {
      count(0);
      zip.addEmptyDirectory(path);
      continue;
    }
    let source = row.body ?? "";
    if (row.source_format === "canvas") {
      const canvas = parseCanvas(source);
      source = JSON.stringify({
        ...canvas,
        nodes: canvas.nodes.map((node) => {
          if (node.type !== "file") return node;
          const target = nativePath(node.resourceId, node.versionId);
          return target
            ? { ...node, file: collectionRelativePath(path, target) }
            : node;
        }),
      });
    } else if (!row.source_format || row.source_format === "markdown")
      source = rewriteMarkdownDestinations(source, (href) => {
        const version = /\/api\/v1\/attachments\/([\da-f-]{36})/i.exec(
            href,
          )?.[1],
          target = nativePath(href.split("#")[0], version);
        if (target)
          return (
            collectionLinkPath(path, target) +
            (href.includes("#") ? href.slice(href.indexOf("#")) : "")
          );
        if (/^(?:[\da-f-]{36}|\/api\/v1\/attachments\/)/i.test(href))
          diagnostics.push({
            severity: "warning",
            code: "unresolved-link",
            path,
            message:
              "A note/file outside the included collection remains a source reference.",
          });
      });
    addText(path, source, row.id);
  }
  for (const file of files.values()) {
    const path = filePaths.get(file.versionId)!,
      id =
        latest.get(file.originalId) === file.versionId
          ? file.originalId
          : file.versionId;
    count(Number(file.bytes));
    const pinned = id !== file.originalId;
    declarations.push({
      id,
      parentId:
        !pinned && file.parent_id && resources.has(file.parent_id)
          ? file.parent_id
          : null,
      kind: "file",
      path,
      metadata: {
        ...metadata(
          file,
          pinned
            ? `${file.name} · pinned ${file.versionId.slice(0, 8)}`.slice(
                0,
                200,
              )
            : file.name,
        ),
        originVersionId: file.versionId,
      },
    });
    artifacts.push({
      path,
      role: "asset",
      resourceId: id,
      versionId: file.versionId,
      bytes: Number(file.bytes),
      sha256: file.sha256,
    });
    zip.addReadStreamLazy(
      path,
      { size: Number(file.bytes), compress: false },
      (callback) => {
        void attachmentStream(file.storage_key).then(
          (stream) => {
            const hash = createHash("sha256");
            let bytes = 0;
            const checked = new Transform({
              transform(chunk, _encoding, next) {
                bytes += chunk.length;
                hash.update(chunk);
                next(null, chunk);
              },
              flush(next) {
                next(
                  bytes === Number(file.bytes) &&
                    hash.digest("hex") === file.sha256
                    ? null
                    : new Error("Stored asset changed while exporting."),
                );
              },
            });
            for (const active of [stream, checked]) {
              streams.add(active);
              active.once("close", () => streams.delete(active));
            }
            checked.on("error", (error) => output.destroy(error));
            stream.on("error", (error) => checked.destroy(error));
            stream.pipe(checked);
            callback(null, checked);
          },
          (error) => callback(error, Readable.from([])),
        );
      },
    );
  }
  if (
    declarations.some(
      (r) => r.parentId && resources.get(r.parentId)?.kind !== "folder",
    )
  )
    diagnostics.push({
      severity: "warning",
      code: "document-children",
      message:
        "Children of documents are restored into a supporting folder beside the document; the original ownership hierarchy is recorded in the manifest.",
    });
  if (declarations.some((r) => r.sourceFormat === "markdown"))
    diagnostics.push({
      severity: "info",
      code: "bibliography-scope",
      message:
        "Citation source is preserved. Reference-library records are not recreated by a file-level import.",
    });
  if (!declarations.length)
    throw new Error(
      "This selection contains only shortcuts. Select their accessible targets instead.",
    );
  const manifest = portableCollectionSchema.parse({
    format: "axiom-collection",
    version: 1,
    scope: "files-and-metadata",
    createdAt: new Date().toISOString(),
    resources: declarations,
    artifacts,
    diagnostics: boundedCollectionDiagnostics(diagnostics),
  });
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
  if (
    manifestBytes.length > 2_000_000 ||
    expanded + manifestBytes.length > IMPORT_LIMITS.zipExpandedBytes
  )
    throw new Error("Collection manifest exceeds its import budget.");
  const free = await availableStorageBytes();
  if (free !== null && free < expanded + 256 * 1024 * 1024)
    throw new Error("Not enough storage to safely prepare the collection.");
  zip.addBuffer(manifestBytes, COLLECTION_MANIFEST);
  let compressed = 0;
  const output = new Transform({
    transform(chunk, _encoding, next) {
      compressed += chunk.length;
      next(
        compressed > IMPORT_LIMITS.zipBytes
          ? new Error(
              "Portable ZIP exceeds 50 MB compressed. Choose a smaller selection or a standard archive.",
            )
          : null,
        chunk,
      );
    },
  });
  zip.on("error", (error) => output.destroy(error));
  zip.outputStream.on("error", (error) => output.destroy(error));
  zip.outputStream.pipe(output);
  output.on("error", () => (zip.outputStream as Readable).destroy());
  output.once("close", () => {
    for (const stream of streams) stream.destroy();
  });
  zip.end({
    forceZip64Format: false,
    comment: "Axiom reimportable research collection",
  });
  return { output, requiredIds: [...required] };
}

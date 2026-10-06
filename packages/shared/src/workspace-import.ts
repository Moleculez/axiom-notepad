import { z } from "zod";
import { MAX_FILE_BYTES } from "./workspace";
import {
  IMPORT_LIMITS,
  importPath,
  importPathKey,
  importExclusion,
} from "./collection-path";
export {
  IMPORT_LIMITS,
  importPath,
  importPathKey,
  importExclusion,
} from "./collection-path";
import {
  portableMetadataSchema,
  collectionDiagnosticSchema,
  type CollectionDiagnostic,
} from "./portable-collection";
import { parseCanvas } from "./canvas";

export type ImportSource = "markdown" | "canvas" | "folder" | "zip";
export type ImportConflict = "keepBoth" | "merge" | "skip";

/** JSONB and browser objects need the same identity, regardless of property order. */
export function canonicalImportJson(value: unknown) {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}
export const isImportMarkdown = (path: string) =>
  /\.(?:md|markdown)$/i.test(path);
export function importName(path: string, kind: "folder" | "note" | "file") {
  const name = path.split("/").at(-1)!;
  return kind === "note"
    ? name.replace(/\.(?:md|markdown|canvas|tex|txt)$/i, "") || "Untitled"
    : name;
}
export const importManifestEntrySchema = z
  .object({
    id: z.uuid(),
    path: z.string().max(4096),
    kind: z.enum(["folder", "note", "file"]),
    sourceFormat: z.enum(["markdown", "latex", "text", "canvas"]).optional(),
    metadata: portableMetadataSchema.optional(),
    expectedSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    asAttachment: z.boolean().optional(),
    bytes: z.number().int().min(0).max(MAX_FILE_BYTES),
    // SHA-256 of the concatenated, lowercase SHA-256 part digests. Empty files hash the empty string.
    digest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
  })
  .strict();
export const importManifestSchema = z
  .object({
    source: z.enum(["markdown", "canvas", "folder", "zip"]),
    parentId: z.uuid().nullable().default(null),
    conflict: z.enum(["keepBoth", "merge", "skip"]).default("keepBoth"),
    entries: z
      .array(importManifestEntrySchema)
      .min(1)
      .max(IMPORT_LIMITS.entries),
    diagnostics: z.array(collectionDiagnosticSchema).max(2000).optional(),
  })
  .strict();
export type ImportManifest = z.infer<typeof importManifestSchema>;
export type ImportManifestEntry = z.infer<typeof importManifestEntrySchema>;

export function validateImportManifest(input: unknown): ImportManifest {
  const manifest = importManifestSchema.parse(input),
    seen = new Set<string>();
  let markdownBytes = 0;
  for (const entry of manifest.entries) {
    entry.path = importPath(entry.path);
    if (
      entry.kind === "folder" &&
      entry.path.split("/").length > IMPORT_LIMITS.depth
    )
      throw new Error("Import up to 32 folder levels.");
    const key = importPathKey(entry.path);
    if (seen.has(key))
      throw new Error(`Duplicate or ambiguous path: ${entry.path}`);
    seen.add(key);
    if (importExclusion(entry.path))
      throw new Error(`Excluded path: ${entry.path}`);
    if (
      entry.kind === "folder"
        ? entry.bytes !== 0 || entry.digest !== null
        : !entry.digest
    )
      throw new Error(`Invalid file inventory: ${entry.path}`);
    const format =
      entry.sourceFormat ?? (entry.kind === "note" ? "markdown" : undefined);
    if (entry.sourceFormat && entry.kind !== "note")
      throw new Error("Only native notes declare a source format.");
    if (entry.kind === "note" && !format)
      throw new Error("Native documents need a source format.");
    if (
      isImportMarkdown(entry.path) &&
      entry.kind !== "folder" &&
      entry.kind !== "note" &&
      !entry.asAttachment
    )
      throw new Error(`Markdown must become a native note: ${entry.path}`);
    if (
      entry.kind === "note" &&
      !entry.metadata?.originId &&
      !new RegExp(
        format === "canvas"
          ? "\\.canvas$"
          : format === "latex"
            ? "\\.tex$"
            : format === "text"
              ? "\\.txt$"
              : "\\.(md|markdown)$",
        "i",
      ).test(entry.path)
    )
      throw new Error(
        `The document format does not match its path: ${entry.path}`,
      );
    if (
      entry.metadata?.toolKind &&
      (entry.metadata.toolKind === "image"
        ? entry.kind !== "file"
        : format !==
          (
            {
              math: "latex",
              canvas: "canvas",
              text: "text",
              mindmap: "markdown",
            } as const
          )[entry.metadata.toolKind])
    )
      throw new Error("Tool kind does not match the imported document.");
    if (entry.kind === "note") markdownBytes += entry.bytes;
    if (
      manifest.source === "markdown" &&
      (entry.kind !== "note" ||
        format !== "markdown" ||
        entry.path.includes("/"))
    )
      throw new Error(
        "Select Markdown files, or use Import folder for a mixed collection.",
      );
    if (
      manifest.source === "canvas" &&
      entry.kind === "note" &&
      format !== "canvas"
    )
      throw new Error(
        "Choose Canvas files, or import a folder for supporting files.",
      );
  }
  if (
    new Set(manifest.entries.map((e) => e.id)).size !== manifest.entries.length
  )
    throw new Error("Import entry identifiers must be unique.");
  if (markdownBytes > IMPORT_LIMITS.markdownBytes)
    throw new Error("Import up to 25 MB of native source at a time.");
  const folders = new Set(
    manifest.entries.filter((e) => e.kind === "folder").map((e) => e.path),
  );
  for (const entry of manifest.entries) {
    const parent = entry.path.split("/").slice(0, -1).join("/");
    if (parent && !folders.has(parent))
      throw new Error(`Missing parent folder: ${entry.path}`);
  }
  return {
    ...manifest,
    entries: [...manifest.entries].sort(
      (a, b) =>
        a.path.split("/").length - b.path.split("/").length ||
        a.path.localeCompare(b.path),
    ),
  };
}

export type ImportExisting = {
  id: string;
  parent_id: string | null;
  name: string;
  kind: string;
  version: number;
};
export type WorkspaceImportEntry = ImportManifestEntry & {
  name: string;
  parentId: string | null;
  resourceId: string;
  disposition: "create" | "merge" | "skip";
  conflict: boolean;
  uploadId?: string;
  status?: string;
  received?: number;
  error?: string;
};
export type WorkspaceImportPreview = {
  entries: WorkspaceImportEntry[];
  fingerprint: string;
  diagnostics?: CollectionDiagnostic[];
  destination: {
    spaceId: string;
    spaceName: string;
    audience: string;
    breadcrumbs: { id: string; name: string }[];
  };
  counts: {
    notes: number;
    files: number;
    folders: number;
    skipped: number;
    conflicts: number;
    bytes: number;
  };
};
export type WorkspaceImportBatch = {
  id: string;
  spaceId: string;
  source: ImportSource;
  parentId: string | null;
  conflict: ImportConflict;
  status: "preparing" | "publishing" | "blocked" | "complete" | "cancelled";
  error: string | null;
  expiresAt: string;
  diagnostics?: CollectionDiagnostic[];
  entries: WorkspaceImportEntry[];
  result: {
    resources: {
      id: string;
      kind: "folder" | "note" | "file";
      name: string;
      parentId: string | null;
    }[];
    warnings: string[];
    diagnostics?: CollectionDiagnostic[];
  } | null;
};
export type WorkspaceImportPoll = Omit<
  WorkspaceImportBatch,
  "entries" | "result"
> & {
  entries: Pick<WorkspaceImportEntry, "id" | "status" | "received" | "error">[];
};
/** Terminal server receipts are immutable; a slower status read cannot undo them. */
export function retainImportReceipt(
  current: WorkspaceImportBatch | undefined,
  incoming: WorkspaceImportBatch,
): WorkspaceImportBatch {
  return current &&
    current.id === incoming.id &&
    ["complete", "cancelled"].includes(current.status)
    ? current
    : incoming;
}
export function planImport(
  manifest: ImportManifest,
  existing: ImportExisting[],
): WorkspaceImportEntry[] {
  const children = new Map<string, Map<string, ImportExisting[]>>(),
    planned = new Map<string, WorkspaceImportEntry>();
  const insert = (resource: ImportExisting) => {
    const key = resource.parent_id ?? "",
      name = importPathKey(resource.name);
    let siblings = children.get(key);
    if (!siblings) {
      siblings = new Map();
      children.set(key, siblings);
    }
    const matches = siblings.get(name);
    if (matches) matches.push(resource);
    else siblings.set(name, [resource]);
  };
  for (const resource of existing) {
    insert(resource);
  }
  return manifest.entries.map((entry) => {
    const parentPath = entry.path.split("/").slice(0, -1).join("/"),
      parent = planned.get(parentPath);
    const parentId = parent?.resourceId ?? manifest.parentId,
      name = entry.metadata?.name ?? importName(entry.path, entry.kind);
    const siblings =
      children.get(parentId ?? "") ?? new Map<string, ImportExisting[]>();
    const matches = siblings.get(importPathKey(name)) ?? [];
    let disposition: WorkspaceImportEntry["disposition"] = "create",
      finalName = name,
      resourceId = entry.id;
    if (
      parent?.disposition === "skip" ||
      (matches.length && manifest.conflict === "skip")
    )
      disposition = "skip";
    else if (
      matches.length === 1 &&
      matches[0].kind === "folder" &&
      entry.kind === "folder" &&
      manifest.conflict === "merge"
    ) {
      disposition = "merge";
      resourceId = matches[0].id;
    } else if (matches.length) {
      const extension =
        entry.kind === "file" ? (/\.[^.]+$/.exec(name)?.[0] ?? "") : "";
      const stem = extension ? name.slice(0, -extension.length) : name;
      let ordinal = 2;
      do {
        const suffix = ` (${ordinal++})${extension}`;
        finalName = stem.slice(0, 200 - suffix.length) + suffix;
      } while (siblings.has(importPathKey(finalName)));
    }
    const item: WorkspaceImportEntry = {
      ...entry,
      name: finalName,
      parentId,
      resourceId,
      disposition,
      conflict: matches.length > 0,
    };
    planned.set(entry.path, item);
    if (disposition === "create")
      insert({
        id: resourceId,
        parent_id: parentId,
        name: finalName,
        kind: entry.kind,
        version: 1,
      });
    return item;
  });
}

export function decodeImportMarkdown(
  bytes: Uint8Array,
  format: "markdown" | "canvas" | "latex" | "text" = "markdown",
) {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new Error(
      "Markdown must be UTF-8 encoded. Convert this file to UTF-8 before importing.",
    );
  }
  if (source.includes("\u0000"))
    throw new Error("Markdown contains binary data.");
  if (
    source.length > (format === "canvas" ? 5_000_000 : IMPORT_LIMITS.noteChars)
  )
    throw new Error(
      format === "canvas"
        ? "A Canvas project may contain up to 5,000,000 characters."
        : "A native document may contain up to 1,000,000 characters.",
    );
  if (format === "canvas") parseCanvas(source.replace(/^\ufeff/, ""));
  return source;
}

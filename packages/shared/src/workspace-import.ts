import { z } from "zod";
import { MAX_FILE_BYTES } from "./workspace";

export const IMPORT_LIMITS = {
  entries: 2000,
  depth: 32,
  noteChars: 1_000_000,
  markdownBytes: 25_000_000,
  zipBytes: 50_000_000,
  zipExpandedBytes: 100_000_000,
  zipEntries: 1000,
} as const;
export type ImportSource = "markdown" | "folder" | "zip";
export type ImportConflict = "keepBoth" | "merge" | "skip";

/** Relative paths are data, never filesystem paths. Reject rather than repair unsafe input. */
export function importPath(value: string): string {
  const path = value.normalize("NFC");
  const parts = path.split("/");
  if (
    !path ||
    path.length > 4096 ||
    /^[\\/]|^[a-z]:/i.test(path) ||
    /[\\\u0000-\u001f\u007f]/.test(path) ||
    parts.length > IMPORT_LIMITS.depth + 1 ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.trim() !== part ||
        part.length > 200,
    )
  )
    throw new Error(
      "Use safe relative paths with names up to 200 characters and 32 folder levels.",
    );
  return path;
}
export const importPathKey = (path: string) =>
  path.normalize("NFC").toLowerCase();
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
export function importExclusion(path: string): string | null {
  const parts = path.split("/");
  if (
    parts.some(
      (p) =>
        /^(?:\.git|\.svn|\.hg|node_modules|__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini|\.next|\.uploads)$/i.test(
          p,
        ) || p.startsWith("._"),
    )
  )
    return "System or development file";
  if (
    parts.some((p) =>
      /^(?:\.env(?:\..*)?|\.ssh|\.aws|credentials|id_rsa|id_ed25519)$/i.test(p),
    ) ||
    /\.(?:pem|key|p12|pfx)$/i.test(path)
  )
    return "Likely credentials or private key";
  return null;
}
export const isImportMarkdown = (path: string) =>
  /\.(?:md|markdown)$/i.test(path);
export function importName(path: string, kind: "folder" | "note" | "file") {
  const name = path.split("/").at(-1)!;
  return kind === "note"
    ? name.replace(/\.(?:md|markdown)$/i, "") || "Untitled"
    : name;
}
export const importManifestEntrySchema = z
  .object({
    id: z.uuid(),
    path: z.string().max(4096),
    kind: z.enum(["folder", "note", "file"]),
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
    source: z.enum(["markdown", "folder", "zip"]),
    parentId: z.uuid().nullable().default(null),
    conflict: z.enum(["keepBoth", "merge", "skip"]).default("keepBoth"),
    entries: z
      .array(importManifestEntrySchema)
      .min(1)
      .max(IMPORT_LIMITS.entries),
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
    if (
      (entry.kind === "note") !==
      (entry.kind !== "folder" && isImportMarkdown(entry.path))
    )
      throw new Error(`Markdown must become a native note: ${entry.path}`);
    if (entry.kind === "note") markdownBytes += entry.bytes;
    if (
      manifest.source === "markdown" &&
      (entry.kind !== "note" || entry.path.includes("/"))
    )
      throw new Error(
        "Select Markdown files, or use Import folder for a mixed collection.",
      );
  }
  if (
    new Set(manifest.entries.map((e) => e.id)).size !== manifest.entries.length
  )
    throw new Error("Import entry identifiers must be unique.");
  if (markdownBytes > IMPORT_LIMITS.markdownBytes)
    throw new Error("Import up to 25 MB of Markdown at a time.");
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
  entries: WorkspaceImportEntry[];
  result: {
    resources: {
      id: string;
      kind: "folder" | "note" | "file";
      name: string;
      parentId: string | null;
    }[];
    warnings: string[];
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
      name = importName(entry.path, entry.kind);
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

export function decodeImportMarkdown(bytes: Uint8Array) {
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
  if (source.length > IMPORT_LIMITS.noteChars)
    throw new Error("A Markdown note may contain up to 1,000,000 characters.");
  return source;
}

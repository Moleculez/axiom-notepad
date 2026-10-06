import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  COLLECTION_MANIFEST,
  portableCollectionSchema,
  portableMetadataSchema,
  type PortableMetadata,
  type CollectionDiagnostic,
} from "@axiom/shared/portable-collection";
import { importPath, importPathKey } from "@axiom/shared/collection-path";
import type { ImportLocalFile } from "./workspace-import-inventory";

/** Whole-file SHA-256, not the transfer's digest-of-part-digests. */
export async function collectionFileSha256(file: Blob) {
  const hash = sha256.create();
  try {
    for (let offset = 0; offset < file.size; offset += 8 * 1024 * 1024)
      hash.update(
        new Uint8Array(
          await file.slice(offset, offset + 8 * 1024 * 1024).arrayBuffer(),
        ),
      );
    return bytesToHex(hash.digest());
  } finally {
    hash.destroy();
  }
}
export const collectionPathIdentity = (path: string) =>
  bytesToHex(sha256(new TextEncoder().encode(path))).slice(0, 20);
export type CollectionFileDescriptor = {
  kind: "folder" | "note" | "file";
  sourceFormat?: "markdown" | "latex" | "text" | "canvas";
  metadata?: PortableMetadata;
  expectedSha256?: string;
};
export async function inspectCollectionFiles(files: ImportLocalFile[]) {
  const candidates = files.filter((f) =>
    [
      COLLECTION_MANIFEST,
      "workspace-manifest.json",
      "canvas-manifest.json",
    ].includes(f.path.split("/").at(-1)!),
  );
  const descriptors = new Map<string, CollectionFileDescriptor>(),
    ignored = new Set<string>(),
    directories: string[] = [],
    diagnostics: CollectionDiagnostic[] = [];
  if (!candidates.length)
    return { descriptors, ignored, directories, diagnostics };
  if (candidates.length !== 1)
    throw new Error(
      "Choose one collection manifest. Nested or competing manifests need separate imports.",
    );
  const candidate = candidates[0];
  if (candidate.file.size > 2_000_000)
    throw new Error("Collection manifest exceeds 2 MB.");
  const value = JSON.parse(await candidate.file.text()),
    root = candidate.path.split("/").slice(0, -1).join("/");
  const full = (path: string) =>
    importPath((root ? root + "/" : "") + importPath(path));
  const originals = new Map(files.map((f) => [importPathKey(f.path), f]));
  ignored.add(importPathKey(candidate.path));
  if (value?.format === "axiom-collection") {
    const manifest = portableCollectionSchema.parse(value);
    diagnostics.push(...manifest.diagnostics);
    for (const artifact of manifest.artifacts) {
      const absolute = full(artifact.path),
        original = originals.get(importPathKey(absolute));
      if (
        !original ||
        original.file.size !== artifact.bytes ||
        (await collectionFileSha256(original.file)) !== artifact.sha256
      )
        throw new Error(
          `Collection checksum or size mismatch: ${artifact.path}`,
        );
      if (["derived", "settings", "original"].includes(artifact.role))
        ignored.add(importPathKey(absolute));
    }
    const declared = new Set(
      manifest.artifacts.map((a) => importPathKey(full(a.path))),
    );
    for (const file of files)
      if (file !== candidate && !declared.has(importPathKey(file.path))) {
        ignored.add(importPathKey(file.path));
        diagnostics.push({
          severity: "warning",
          code: "undeclared-artifact",
          path: file.path,
          message:
            "Undeclared archive content is excluded; it is not part of this collection.",
        });
      }
    for (const resource of manifest.resources) {
      const absolute = full(resource.path),
        artifact = manifest.artifacts.find(
          (a) => a.path === resource.path && a.resourceId === resource.id,
        );
      if (resource.kind === "folder") directories.push(absolute);
      descriptors.set(importPathKey(absolute), {
        kind: resource.kind,
        sourceFormat: resource.sourceFormat,
        metadata: {
          ...resource.metadata,
          originId: resource.id,
          ...(artifact?.versionId
            ? { originVersionId: artifact.versionId }
            : {}),
        },
        expectedSha256: artifact?.sha256,
      });
    }
    diagnostics.push({
      severity: "info",
      code: "collection-scope",
      message:
        "Restores files and safe metadata. Accounts, permissions, planning, annotations, discussions and version history are not restored.",
    });
  } else if (
    ["axiom-workspace-export", "axiom-canvas-bundle"].includes(value?.format) &&
    value.version === 1
  ) {
    diagnostics.push({
      severity: "warning",
      code: "legacy-manifest",
      message:
        "Legacy collection: missing metadata and source checksums cannot be reconstructed. Supplied checksums are verified; other files get a new local inventory identity.",
    });
    const records: Record<string, any>[] =
      value.format === "axiom-workspace-export"
        ? value.resources
        : value.entries;
    if (!Array.isArray(records) || records.length > 2000)
      throw new Error("Invalid legacy collection inventory.");
    const filesByResource = new Map<string, Record<string, any>>();
    const versions = new Map<string, Record<string, any>[]>();
    const assetRecords: Record<string, any>[] =
      value.format === "axiom-workspace-export"
        ? (value.files ?? [])
        : records.filter((record) => record.versionId);
    if (!Array.isArray(assetRecords) || assetRecords.length > 2000)
      throw new Error("Invalid legacy asset inventory.");
    for (const file of assetRecords) {
      if (typeof file.resourceId !== "string")
        throw new Error("Invalid legacy asset identity.");
      const items = versions.get(file.resourceId) ?? [];
      items.push(file);
      versions.set(file.resourceId, items);
      if (items.length > 2000)
        throw new Error("Invalid legacy asset inventory.");
    }
    if (value.format === "axiom-workspace-export") {
      for (const record of records) {
        const candidates = versions.get(record.id) ?? [];
        const file =
          candidates.find((file) => file.id === record.currentVersionId) ??
          (candidates.length === 1 ? candidates[0] : undefined);
        if (file) filesByResource.set(record.id, file);
      }
    } else {
      for (const record of records)
        if (
          record.resourceId &&
          (record.kind === "lossless-canvas" ||
            record.sourceFormat ||
            record.versionId)
        ) {
          const previous = filesByResource.get(record.resourceId);
          if (!previous || record.kind === "lossless-canvas")
            filesByResource.set(record.resourceId, record);
        }
    }
    const primaryVersions = new Set(
      [...filesByResource.values()].map((file) => file.id),
    );
    const selected: Record<string, any>[] =
      value.format === "axiom-workspace-export"
        ? [
            ...records,
            ...[...versions.values()]
              .flat()
              .filter((file) => !primaryVersions.has(file.id))
              .map((file) => ({ ...file, kind: "file", versionId: file.id })),
          ]
        : [...filesByResource.values()]
            .filter((record) => !record.versionId)
            .concat(records.filter((record) => record.versionId));
    if (selected.length > 2000)
      throw new Error("Legacy collection exceeds its inventory budget.");
    for (const record of selected) {
      const file = record.versionId
          ? record
          : filesByResource.get(record.id ?? record.resourceId),
        relative =
          record.kind === "file" ? (file?.path ?? record.path) : record.path;
      if (!relative || record.kind === "shortcut") {
        diagnostics.push({
          severity: "warning",
          code: "unsupported-resource",
          message:
            "A legacy shortcut or resource without portable source was omitted.",
        });
        continue;
      }
      const absolute = full(relative),
        isFolder = record.kind === "folder";
      if (isFolder) directories.push(absolute);
      const immutable = record.kind === "file" || !!record.versionId;
      const format =
        immutable || isFolder
          ? undefined
          : record.kind === "lossless-canvas" ||
              /\.canvas(?:\.json)?$/i.test(relative)
            ? "canvas"
            : (record.sourceFormat ??
              (/\.(?:md|markdown)$/i.test(relative)
                ? "markdown"
                : /\.tex$/i.test(relative)
                  ? "latex"
                  : /\.txt$/i.test(relative)
                    ? "text"
                    : undefined));
      const kind = isFolder ? "folder" : format ? "note" : "file";
      const originId =
        record.versionId &&
        value.format === "axiom-canvas-bundle" &&
        (versions.get(record.resourceId)?.length ?? 0) > 1
          ? record.versionId
          : (record.id ?? record.resourceId);
      if (originId === record.versionId && record.resourceId !== originId)
        diagnostics.push({
          severity: "warning",
          code: "legacy-pinned-file",
          path: absolute,
          message:
            "This asset version is restored separately. Ambiguous unpinned original resource links are not guessed.",
        });
      const rawMetadata = {
        name: record.name,
        description: record.description,
        tags: record.tags,
        originId,
        originVersionId: file?.id ?? record.versionId,
        toolKind:
          format === "markdown" && record.view === "mindmap"
            ? "mindmap"
            : format === "canvas"
              ? "canvas"
              : format === "latex"
                ? "math"
                : format === "text"
                  ? "text"
                  : undefined,
      };
      const metadata = portableMetadataSchema.parse(
        Object.fromEntries(
          Object.entries(rawMetadata).filter(([, v]) => v !== undefined),
        ),
      );
      const expected = (
        kind === "file" ? (file?.sha256 ?? record.sha256) : record.sha256
      ) as string | undefined;
      const original = originals.get(importPathKey(absolute));
      if (
        !isFolder &&
        (!original ||
          (expected &&
            (await collectionFileSha256(original.file)) !== expected))
      )
        throw new Error(
          `Legacy collection file is missing or changed: ${relative}`,
        );
      if (descriptors.has(importPathKey(absolute)))
        throw new Error("Ambiguous legacy resource path.");
      descriptors.set(importPathKey(absolute), {
        kind,
        sourceFormat: format,
        metadata,
        expectedSha256: expected,
      });
    }
    for (const file of files)
      if (!descriptors.has(importPathKey(file.path)))
        ignored.add(importPathKey(file.path));
    for (const omission of value.omissions ?? value.warnings ?? [])
      diagnostics.push({
        severity: "warning",
        code: "legacy-omission",
        message:
          typeof omission === "string"
            ? omission.slice(0, 2000)
            : String(omission.reason ?? "Legacy export omission").slice(
                0,
                2000,
              ),
      });
  } else
    throw new Error(
      "Unsupported collection manifest/version. Keep the original archive, or update Axiom before importing.",
    );
  return { descriptors, ignored, directories, diagnostics };
}

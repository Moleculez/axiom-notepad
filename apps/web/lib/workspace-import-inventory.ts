import JSZip from "jszip";
import {
  IMPORT_LIMITS,
  importPath,
  importPathKey,
  importExclusion,
  isImportMarkdown,
  decodeImportMarkdown,
  validateImportManifest,
  type ImportManifestEntry,
  type ImportSource,
} from "@axiom/shared/workspace-import";
import {
  inspectImportZip,
  importCrc32,
} from "@axiom/shared/workspace-import-zip";
import { importFileDigest } from "./file-checksum";

export type ImportLocalFile = { path: string; file: File };
export type ImportInventory = {
  entries: ImportManifestEntry[];
  files: ImportLocalFile[];
  previews: Record<string, string>;
  exclusions: { path: string; reason: string }[];
  warnings: string[];
};
export type ImportInventoryInput = {
  source: ImportSource;
  files: ImportLocalFile[];
  directories?: string[];
};

export async function prepareImportInventory(
  input: ImportInventoryInput,
  progress: (label: string) => void = () => {},
): Promise<ImportInventory> {
  let files = input.files,
    directories = input.directories ?? [];
  const exclusions: ImportInventory["exclusions"] = [],
    warnings: string[] = [];
  if (input.source === "zip") {
    if (files.length !== 1) throw new Error("Choose one ZIP archive.");
    const archive = files[0].file;
    if (archive.size > IMPORT_LIMITS.zipBytes)
      throw new Error("Import ZIP archives up to 50 MB compressed.");
    const buffer = new Uint8Array(await archive.arrayBuffer()),
      inventory = inspectImportZip(buffer);
    const zip = await JSZip.loadAsync(buffer, { createFolders: false });
    const roots = new Set(inventory.map((e) => e.path.split("/")[0]));
    const hasRoot =
      roots.size === 1 &&
      inventory.every((e) => e.directory || e.path.includes("/"));
    const container = importPath(
      archive.name.replace(/\.zip$/i, "") || "Imported archive",
    );
    files = [];
    directories = hasRoot ? [] : [container];
    let total = 0;
    for (const entry of inventory) {
      const path = hasRoot ? entry.path : container + "/" + entry.path,
        exclusion = importExclusion(path);
      if (exclusion) {
        exclusions.push({ path, reason: exclusion });
        continue;
      }
      if (entry.directory) {
        directories.push(path);
        continue;
      }
      progress(`Unpacking ${path}`);
      const file = zip.file(entry.path);
      // JSZip uses raw, decomposed Unicode names; our inventory normalizes NFC.
      const actual =
        file ??
        Object.values(zip.files).find(
          (f) => !f.dir && f.name.normalize("NFC") === entry.path,
        );
      if (!actual) throw new Error(`ZIP entry unavailable: ${entry.path}`);
      const chunks: Uint8Array[] = [];
      let bytes = 0,
        crc = 0;
      await new Promise<void>((resolve, reject) => {
        // JSZip 3.10 exposes this bounded streaming API at runtime but omits it
        // from JSZipObject's declaration; its published StreamHelper is typed.
        const stream = (
          actual as JSZip.JSZipObject & {
            internalStream(
              type: "uint8array",
            ): JSZip.JSZipStreamHelper<Uint8Array>;
          }
        ).internalStream("uint8array");
        stream
          .on("data", (chunk: Uint8Array) => {
            bytes += chunk.byteLength;
            total += chunk.byteLength;
            if (bytes > entry.bytes || total > IMPORT_LIMITS.zipExpandedBytes) {
              stream.pause();
              reject(
                new Error("ZIP exceeded its declared or safe expansion size."),
              );
              return;
            }
            crc = importCrc32(chunk, crc);
            chunks.push(chunk);
          })
          .on("error", reject)
          .on("end", () => {
            if (bytes !== entry.bytes || crc !== entry.crc)
              reject(new Error(`ZIP checksum mismatch: ${entry.path}`));
            else resolve();
          })
          .resume();
      });
      files.push({
        path,
        file: new File(chunks as BlobPart[], path.split("/").at(-1)!),
      });
    }
  } else if (input.source === "folder") {
    warnings.push(
      "Folder pickers cannot report empty directories. Dropped folders and ZIP archives preserve known empty directories.",
    );
  }
  const entries: ImportManifestEntry[] = [],
    accepted: ImportLocalFile[] = [],
    previews: Record<string, string> = {},
    seen = new Set<string>(),
    folders = new Set<string>();
  const folder = (value: string) => {
    const path = importPath(value);
    const reason = importExclusion(path);
    if (reason) {
      exclusions.push({ path, reason });
      return;
    }
    folders.add(path);
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++)
      folders.add(parts.slice(0, i).join("/"));
  };
  for (const path of directories) folder(path);
  let markdownBytes = 0;
  for (const original of files) {
    const path = importPath(
        input.source === "markdown" ? original.file.name : original.path,
      ),
      key = importPathKey(path),
      reason = importExclusion(path);
    if (reason) {
      exclusions.push({ path, reason });
      continue;
    }
    if (seen.has(key))
      throw new Error(`Duplicate or ambiguous file path: ${path}`);
    seen.add(key);
    const note = isImportMarkdown(path);
    if (input.source === "markdown" && !note)
      throw new Error(
        "Choose .md or .markdown files, or import a folder for attachments.",
      );
    if (original.file.size > 1_000_000_000)
      throw new Error(`File exceeds the 1 GB limit: ${path}`);
    const parent = path.split("/").slice(0, -1).join("/");
    if (parent) folder(parent);
    if (note) {
      markdownBytes += original.file.size;
      if (markdownBytes > IMPORT_LIMITS.markdownBytes)
        throw new Error("Import up to 25 MB of Markdown at a time.");
      const source = decodeImportMarkdown(
        new Uint8Array(await original.file.arrayBuffer()),
      );
      previews[path] = source;
    }
    if (entries.length + folders.size >= IMPORT_LIMITS.entries)
      throw new Error("Import up to 2,000 files and folders at a time.");
    progress(`Checking ${path}`);
    entries.push({
      id: crypto.randomUUID(),
      path,
      kind: note ? "note" : "file",
      bytes: original.file.size,
      digest: await importFileDigest(original.file),
    });
    accepted.push({ path, file: original.file });
  }
  for (const path of folders)
    entries.push({
      id: crypto.randomUUID(),
      path,
      kind: "folder",
      bytes: 0,
      digest: null,
    });
  const manifest = validateImportManifest({
    source: input.source,
    entries,
    parentId: null,
    conflict: "keepBoth",
  });
  return {
    entries: manifest.entries,
    files: accepted,
    previews,
    exclusions,
    warnings,
  };
}

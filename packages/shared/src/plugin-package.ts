import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import JSZip from "jszip";
import {
  pluginLimits,
  pluginManifestSchema,
  type PluginManifest,
} from "./plugins";

/** Parse the central directory ourselves: ZIP libraries sanitize paths and collapse duplicates. */
export function inspectPluginArchive(buffer: Buffer) {
  if (buffer.length > pluginLimits.compressedBytes || buffer.length < 22)
    throw new Error("Plugin package must be a ZIP no larger than 5 MiB.");
  let end = buffer.length - 22;
  while (
    end >= Math.max(0, buffer.length - 65557) &&
    buffer.readUInt32LE(end) !== 0x06054b50
  )
    end--;
  if (end < 0 || end < buffer.length - 65557)
    throw new Error("Invalid ZIP directory.");
  if (
    buffer.readUInt16LE(end + 4) ||
    buffer.readUInt16LE(end + 6) ||
    buffer.readUInt16LE(end + 8) !== buffer.readUInt16LE(end + 10) ||
    end + 22 + buffer.readUInt16LE(end + 20) !== buffer.length
  )
    throw new Error("Split or malformed ZIP packages are unsupported.");
  const count = buffer.readUInt16LE(end + 10),
    directorySize = buffer.readUInt32LE(end + 12),
    directory = buffer.readUInt32LE(end + 16);
  if (
    !count ||
    count > pluginLimits.entries ||
    directory + directorySize !== end
  )
    throw new Error("Plugin packages may contain up to 32 ordinary files.");
  const files = new Map<string, Buffer>();
  const ranges: { from: number; to: number }[] = [];
  let position = directory,
    expanded = 0;
  for (let i = 0; i < count; i++) {
    if (position + 46 > end || buffer.readUInt32LE(position) !== 0x02014b50)
      throw new Error("Malformed ZIP entry.");
    const flags = buffer.readUInt16LE(position + 8),
      compression = buffer.readUInt16LE(position + 10),
      crc = buffer.readUInt32LE(position + 16),
      compressed = buffer.readUInt32LE(position + 20),
      size = buffer.readUInt32LE(position + 24),
      nameLength = buffer.readUInt16LE(position + 28),
      extraLength = buffer.readUInt16LE(position + 30),
      commentLength = buffer.readUInt16LE(position + 32),
      attributes = buffer.readUInt32LE(position + 38),
      local = buffer.readUInt32LE(position + 42);
    if (position + 46 + nameLength + extraLength + commentLength > end)
      throw new Error("Malformed ZIP entry bounds.");
    const name = buffer
      .subarray(position + 46, position + 46 + nameLength)
      .toString("utf8");
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/.test(name) ||
      name.split("/").some((p) => !p || p === "." || p === "..") ||
      files.has(name.toLowerCase()) ||
      ((attributes >>> 16) & 0xf000) === 0xa000 ||
      flags & 1 ||
      ![0, 8].includes(compression)
    )
      throw new Error(
        "Unsafe, duplicate, encrypted or unsupported package entry.",
      );
    if (
      (expanded += size) > pluginLimits.expandedBytes ||
      local + 30 > directory ||
      buffer.readUInt32LE(local) !== 0x04034b50
    )
      throw new Error(
        "Package expands beyond 10 MiB or contains invalid offsets.",
      );
    const localNameLength = buffer.readUInt16LE(local + 26),
      localExtraLength = buffer.readUInt16LE(local + 28),
      start = local + 30 + localNameLength + localExtraLength;
    if (
      start + compressed > directory ||
      buffer
        .subarray(local + 30, local + 30 + localNameLength)
        .toString("utf8") !== name ||
      buffer.readUInt16LE(local + 8) !== compression ||
      buffer.readUInt16LE(local + 6) !== flags
    )
      throw new Error("ZIP entry does not match its directory.");
    if (
      ranges.some(
        (range) => local < range.to && start + compressed > range.from,
      )
    )
      throw new Error("Overlapping package entries are unsupported.");
    ranges.push({ from: local, to: start + compressed });
    const raw = buffer.subarray(start, start + compressed),
      data =
        compression === 0
          ? Buffer.from(raw)
          : inflateRawSync(raw, {
              maxOutputLength: Math.max(
                1,
                Math.min(size, pluginLimits.expandedBytes),
              ),
            });
    if (data.length !== size || crc32(data) !== crc)
      throw new Error("Package checksum or expanded length is invalid.");
    files.set(name.toLowerCase(), data);
    position += 46 + nameLength + extraLength + commentLength;
  }
  if (position !== end) throw new Error("Invalid ZIP directory length.");
  return files;
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer: Buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function readPluginPackage(archive: Buffer): {
  hash: string;
  manifest: PluginManifest;
  bundle: string;
  archive: Buffer;
} {
  const files = inspectPluginArchive(archive),
    manifestBytes = files.get("manifest.json"),
    entry = files.get("main.js");
  if (!manifestBytes || !entry || manifestBytes.length > 64 * 1024)
    throw new Error("Package needs manifest.json and main.js.");
  if (
    [...files.keys()].some(
      (name) =>
        !(
          ["manifest.json", "main.js", "readme.md"].includes(name) ||
          /^licen[sc]e(?:[._-][a-z0-9-]+)?(?:\.(?:txt|md))?$/.test(name)
        ),
    )
  )
    throw new Error(
      "Only the browser bundle, manifest, README and licenses are supported in API v1.",
    );
  const manifest = pluginManifestSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)),
  );
  const bundle = new TextDecoder("utf-8", { fatal: true }).decode(entry);
  if (!bundle.trim()) throw new Error("Plugin bundle is empty.");
  return {
    hash: createHash("sha256").update(archive).digest("hex"),
    manifest,
    bundle,
    archive,
  };
}
export async function makePluginPackage(
  manifest: PluginManifest,
  bundle: string,
) {
  const zip = new JSZip();
  zip.file(
    "manifest.json",
    JSON.stringify(pluginManifestSchema.parse(manifest)),
    { date: new Date("2026-01-01T00:00:00Z") },
  );
  zip.file("main.js", bundle, { date: new Date("2026-01-01T00:00:00Z") });
  zip.file("LICENSE.txt", manifest.license, {
    date: new Date("2026-01-01T00:00:00Z"),
  });
  return readPluginPackage(
    await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
  );
}

import { IMPORT_LIMITS, importPath, importPathKey } from "./workspace-import";

export type ImportZipEntry = {
  path: string;
  directory: boolean;
  bytes: number;
  compressedBytes: number;
  crc: number;
};
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++)
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});
export function importCrc32(bytes: Uint8Array, previous = 0): number {
  let crc = previous ^ -1;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ -1) >>> 0;
}
/** Inspect original central-directory names BEFORE JSZip sanitizes paths or collapses duplicates. */
export function inspectImportZip(bytes: Uint8Array): ImportZipEntry[] {
  const invalid = () => {
    throw new Error(
      "This ZIP is malformed or uses unsupported ZIP64/multi-disk features.",
    );
  };
  if (bytes.byteLength > IMPORT_LIMITS.zipBytes)
    throw new Error("Import ZIP archives up to 50 MB compressed.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (
      view.getUint32(i, true) === 0x06054b50 &&
      i + 22 + view.getUint16(i + 20, true) === bytes.length
    ) {
      end = i;
      break;
    }
  if (end < 0) return invalid();
  const count = view.getUint16(end + 10, true),
    size = view.getUint32(end + 12, true),
    start = view.getUint32(end + 16, true);
  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    view.getUint16(end + 8, true) !== count ||
    count === 65535 ||
    start + size !== end
  )
    return invalid();
  if (!count || count > IMPORT_LIMITS.zipEntries)
    throw new Error("Import ZIP archives containing 1–1,000 entries.");
  const entries: ImportZipEntry[] = [],
    names = new Set<string>(),
    ranges: [number, number][] = [];
  let pos = start,
    expanded = 0;
  for (let index = 0; index < count; index++) {
    if (pos + 46 > end || view.getUint32(pos, true) !== 0x02014b50)
      return invalid();
    const flags = view.getUint16(pos + 8, true),
      method = view.getUint16(pos + 10, true),
      crc = view.getUint32(pos + 16, true);
    const compressedBytes = view.getUint32(pos + 20, true),
      length = view.getUint32(pos + 24, true);
    const nameLength = view.getUint16(pos + 28, true),
      extra = view.getUint16(pos + 30, true),
      comment = view.getUint16(pos + 32, true),
      offset = view.getUint32(pos + 42, true);
    const unixMode = view.getUint32(pos + 38, true) >>> 16;
    if (flags & (1 | 32 | 64 | 8192) || ![0, 8].includes(method))
      throw new Error(
        "Encrypted or unsupported ZIP entries cannot be imported.",
      );
    if (
      (unixMode & 0xf000) === 0xa000 ||
      (unixMode & 0xf000 && ![0x8000, 0x4000].includes(unixMode & 0xf000))
    )
      throw new Error("ZIP links and special files cannot be imported.");
    if (
      pos + 46 + nameLength + extra + comment > end ||
      view.getUint16(pos + 34, true) ||
      [length, compressedBytes, offset].includes(0xffffffff)
    )
      return invalid();
    const nameBytes = bytes.subarray(pos + 46, pos + 46 + nameLength);
    if (!(flags & 2048) && nameBytes.some((b) => b >= 128))
      throw new Error(
        "Save this archive with UTF-8 file names before importing.",
      );
    let name: string;
    try {
      name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
    } catch {
      return invalid();
    }
    const directory = name.endsWith("/");
    const path = importPath(directory ? name.slice(0, -1) : name),
      key = importPathKey(path);
    if (names.has(key))
      throw new Error(`Duplicate or ambiguous ZIP path: ${path}`);
    names.add(key);
    if (directory && length !== 0) return invalid();
    expanded += length;
    if (
      expanded > IMPORT_LIMITS.zipExpandedBytes ||
      (length > 1_000_000 && length > Math.max(1, compressedBytes) * 1000)
    )
      throw new Error("This ZIP exceeds the safe expansion limit (100 MB).");
    if (
      offset + 30 > start ||
      view.getUint32(offset, true) !== 0x04034b50 ||
      view.getUint16(offset + 6, true) !== flags ||
      view.getUint16(offset + 8, true) !== method
    )
      return invalid();
    const localNameLength = view.getUint16(offset + 26, true),
      localExtra = view.getUint16(offset + 28, true);
    const dataStart = offset + 30 + localNameLength + localExtra,
      dataEnd = dataStart + compressedBytes;
    if (
      dataEnd > start ||
      localNameLength !== nameLength ||
      nameBytes.some((b, i) => b !== bytes[offset + 30 + i])
    )
      return invalid();
    if (
      !(flags & 8) &&
      (view.getUint32(offset + 14, true) !== crc ||
        view.getUint32(offset + 18, true) !== compressedBytes ||
        view.getUint32(offset + 22, true) !== length)
    )
      return invalid();
    if (ranges.some(([from, to]) => offset < to && dataEnd > from))
      return invalid();
    ranges.push([offset, dataEnd]);
    entries.push({ path, directory, bytes: length, compressedBytes, crc });
    pos += 46 + nameLength + extra + comment;
  }
  if (pos !== end) return invalid();
  return entries;
}

import { fileTypeFromBuffer } from "file-type";
import { officeMimes } from "./file-preview";

export function officeDirectoryType(directory: Buffer): string | undefined {
  let offset = 0;
  const names = new Set<string>();
  let expanded = 0,
    count = 0;
  while (
    offset + 46 <= directory.length &&
    directory.readUInt32LE(offset) === 0x02014b50
  ) {
    const flags = directory.readUInt16LE(offset + 8),
      compressed = directory.readUInt32LE(offset + 20),
      size = directory.readUInt32LE(offset + 24);
    const length = directory.readUInt16LE(offset + 28),
      extra = directory.readUInt16LE(offset + 30),
      comment = directory.readUInt16LE(offset + 32);
    if (offset + 46 + length + extra + comment > directory.length) return;
    const name = directory
      .subarray(offset + 46, offset + 46 + length)
      .toString("utf8");
    expanded += size;
    if (
      ++count > 20000 ||
      expanded > 512_000_000 ||
      flags & 1 ||
      (size > 1_000_000 && size / Math.max(1, compressed) > 300) ||
      /(^|\/)\.\.(\/|$)|^\/|\\/.test(name)
    )
      return;
    if(names.has(name))return;
    names.add(name);
    offset += 46 + length + extra + comment;
  }
  if (offset !== directory.length || !names.has("[Content_Types].xml")) return;
  if([...names].some(name=>/vbaProject\.bin$/i.test(name)))return;
  if(["word/document.xml","ppt/presentation.xml","xl/workbook.xml"].filter(name=>names.has(name)).length!==1)return;
  if (names.has("word/document.xml")) return officeMimes.docx;
  if (names.has("ppt/presentation.xml")) return officeMimes.pptx;
  if (names.has("xl/workbook.xml")) return officeMimes.xlsx;
}
export async function detectPrefix(
  prefix: Buffer,
  name: string,
): Promise<string> {
  let type;
  try {
    type = await fileTypeFromBuffer(prefix);
  } catch {
    /* A prefix is intentionally bounded. */
  }
  // OOXML is accepted only after a separate bounded central-directory inspection.
  if (
    type &&
    !Object.values(officeMimes).includes(type.mime as typeof officeMimes.docx)
  )
    return type.mime;
  if (
    /\.(txt|md|markdown|tex|bib|py|jl|js|jsx|ts|tsx|json|xml|html|css|csv|tsv|yaml|yml|toml|r|c|cpp|h|rs|go|sh|log|sql|ini|srt|vtt)$/i.test(
      name,
    )
  ) {
    if (
      prefix.subarray(0, 2).equals(Buffer.from([255, 254])) ||
      prefix.subarray(0, 2).equals(Buffer.from([254, 255]))
    )
      return "text/plain";
    if (!prefix.includes(0))
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(prefix, {
          stream: true,
        });
        return /\.csv$/i.test(name) ? "text/csv" : "text/plain";
      } catch {
        /* A binary is not treated as text based on its name. */
      }
  }
  return "application/octet-stream";
}

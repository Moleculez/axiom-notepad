export type PreviewKind =
  | "image"
  | "audio"
  | "video"
  | "pdf"
  | "text"
  | "markdown"
  | "table"
  | "workbook"
  | "office"
  | "image-project"
  | "download";
export type FilePreviewManifest = {
  resourceId: string;
  versionId: string;
  name: string;
  bytes: number;
  mime: string;
  kind: PreviewKind;
  source: string;
  status: "ready" | "unavailable" | "queued" | "failed";
  message?: string;
  jobId?: string;
};
export const officeMimes = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;
export function previewKind(mime: string, name: string): PreviewKind {
  if (mime === "application/vnd.axiom.image+zip") return "image-project";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  if (mime === officeMimes.xlsx) return "workbook";
  if (
    [officeMimes.docx, officeMimes.pptx].includes(
      mime as typeof officeMimes.docx,
    )
  )
    return "office";
  if (
    mime.startsWith("text/") ||
    ["application/json", "application/xml"].includes(mime)
  ) {
    if (/\.(md|markdown)$/i.test(name)) return "markdown";
    if (/\.(csv|tsv)$/i.test(name)) return "table";
    return "text";
  }
  return "download";
}
/** Bounded RFC-4180-style reader; delimiters inside quoted fields are not separators. */
export function parseDelimited(
  source: string,
  delimiter = ",",
  maxRows = 100000,
): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  source = source.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"' && (quoted || cell === "")) {
      if (quoted && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (!quoted && (c === "\n" || c === "\r")) {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (rows.length >= maxRows) break;
    } else cell += c;
    if (cell.length > 1000000 || row.length > 16384)
      throw new Error("A cell or row exceeds the safe preview limit.");
  }
  if (rows.length < maxRows && (cell || row.length)) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

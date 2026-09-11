import * as Y from "yjs";
import {
  canvasSchema,
  emptyCanvas,
  parseCanvas,
  readCanvas,
  seedCanvas,
} from "./canvas";
export type DocumentFormat = "markdown" | "latex" | "text" | "canvas";
export function initializeDocument(
  doc: Y.Doc,
  source: string,
  format: DocumentFormat = "markdown",
) {
  if (format === "canvas")
    seedCanvas(doc, source ? parseCanvas(source) : emptyCanvas());
  else doc.getText("markdown").insert(0, source);
}
export function documentSource(
  doc: Y.Doc,
  format: DocumentFormat = "markdown",
) {
  return format === "canvas"
    ? JSON.stringify(readCanvas(doc))
    : doc.getText("markdown").toString();
}
export function validateDocument(
  doc: Y.Doc,
  format: DocumentFormat = "markdown",
) {
  if (format === "canvas") canvasSchema.parse(readCanvas(doc));
  else if (doc.getText("markdown").length > 1_000_000)
    throw new Error("Documents are limited to one million characters.");
  const allowed =
    format === "canvas"
      ? new Set(["canvas", "markdown"])
      : new Set(["markdown"]);
  for (const [name, type] of doc.share) {
    const value = type.toJSON();
    if (
      !allowed.has(name) &&
      value &&
      (typeof value !== "object" || Object.keys(value).length)
    )
      throw new Error("Unsupported shared document field.");
  }
  if (Y.encodeStateAsUpdate(doc).byteLength > 8_000_000)
    throw new Error("Document state exceeds the storage budget.");
}
export const documentExtension = (format?: string) =>
  format === "canvas"
    ? "canvas"
    : format === "latex"
      ? "tex"
      : format === "text"
        ? "txt"
        : "md";

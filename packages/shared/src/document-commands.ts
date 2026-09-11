import { createHash } from "node:crypto";
import * as Y from "yjs";
import { z } from "zod";
import {
  applyCanvasCommands,
  canvasCommandSchema,
  replaceSharedText,
  type CanvasCommand,
} from "./canvas";
import {
  documentSource,
  validateDocument,
  type DocumentFormat,
} from "./document-format";
export const documentCommandSchema = z
  .object({
    mutationId: z.uuid(),
    noteId: z.uuid(),
    generation: z.number().int().positive(),
    expectedHash: z.string().regex(/^[\da-f]{64}$/),
    source: z.string().max(1_000_000).optional(),
    canvasCommands: z.array(canvasCommandSchema).min(1).max(500).optional(),
  })
  .strict()
  .refine(
    (v) => (v.source !== undefined) !== (v.canvasCommands !== undefined),
    "Provide source or canvasCommands, not both.",
  );
export const sourceHash = (source: string) =>
  createHash("sha256").update(source).digest("hex");
export function applyDocumentCommand(
  doc: Y.Doc,
  format: DocumentFormat,
  command: z.infer<typeof documentCommandSchema>,
) {
  if (sourceHash(documentSource(doc, format)) !== command.expectedHash)
    throw new Error(
      "The document changed. Read the current content and review your edit before retrying.",
    );
  if (format === "canvas") {
    if (!command.canvasCommands)
      throw new Error("Use structural canvasCommands for Canvas documents.");
    applyCanvasCommands(
      doc,
      command.canvasCommands as CanvasCommand[],
      "automation",
    );
  } else {
    if (command.source === undefined)
      throw new Error("This document needs a source edit.");
    doc.transact(
      () => replaceSharedText(doc.getText("markdown"), command.source!),
      "automation",
    );
  }
  validateDocument(doc, format);
}

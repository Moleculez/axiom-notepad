import { z } from "zod";
import { parseMarkdown, type MarkdownNode } from "@axiom/markdown";
import { preferencesSchema, type Preferences } from "./appearance";
import { applyDocumentStyle } from "./editor-looks";

/** A snapshot is presentation input, never a draft update or a sync operation. */
export const markdownExportSnapshotSchema = z.object({
  source: z.string().max(1_000_000),
  title: z.string().trim().min(1).max(200),
  generation: z.number().int().positive(),
});
export type MarkdownExportSnapshot = z.infer<
  typeof markdownExportSnapshotSchema
>;
export const documentExportOptionsSchema = z.object({
  style: z.enum(["document", "academic", "minimal"]).default("document"),
  colors: z.enum(["document", "paper"]).default("document"),
  dark: z.boolean().default(false),
  title: z.boolean().default(true),
  toc: z.boolean().default(false),
  paper: z.enum(["A4", "Letter"]).default("A4"),
  orientation: z.enum(["portrait", "landscape"]).default("portrait"),
  margin: z.number().int().min(8).max(40).default(20),
  scale: z.number().min(0.7).max(1.4).default(1),
});
export type DocumentExportOptions = z.infer<typeof documentExportOptionsSchema>;
export const defaultDocumentExportOptions = documentExportOptionsSchema.parse(
  {},
);
export const documentExportRequestSchema = z.object({
  snapshot: markdownExportSnapshotSchema,
  options: documentExportOptionsSchema,
  preferences: preferencesSchema,
});
export type DocumentExportResult = { html: string; warnings: string[] };

export function exportPreferences(
  p: Preferences,
  options: DocumentExportOptions,
): Preferences {
  const selected =
    options.style === "academic"
      ? applyDocumentStyle(p, "latexArticle")
      : options.style === "minimal"
        ? {
            ...p,
            proseFont: "inter" as const,
            headingFont: "inter" as const,
            proseSize: 17,
            lineHeight: 1.7,
            documentDecorations: "none" as const,
          }
        : p;
  // A browser's system font cannot be embedded. Keep its sans-serif character
  // using our locally licensed Inter rather than depend on the recipient's OS.
  const portableFont = (id: Preferences["proseFont"]) =>
    id === "systemSans"
      ? "inter"
      : id === "systemSerif"
        ? "sourceSerif"
        : id === "systemMono"
          ? "jetbrains"
          : id;
  return preferencesSchema.parse({
    ...selected,
    proseFont: portableFont(selected.proseFont),
    headingFont: portableFont(selected.headingFont),
    codeFont: portableFont(selected.codeFont),
  });
}
export function exportFilename(title: string, extension: string) {
  return `${
    title
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
      .replace(/^\.+/, "_")
      .trim()
      .slice(0, 150) || "Untitled"
  }.${extension}`;
}

/** Follow parsed references only: literal URLs in code examples are not files
 * the author asked to bundle. Footnotes and reference-style images count. */
export function markdownExportAssetIds(source: string) {
  const document = parseMarkdown(source),
    ids = new Set<string>();
  const visit = (node: MarkdownNode) => {
    if (["image", "link"].includes(node.type)) {
      const id =
        /^\/api\/v1\/attachments\/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})(?:[?#]|$)/i.exec(
          node.href ?? "",
        )?.[1];
      if (id) ids.add(id.toLowerCase());
    }
    node.children?.forEach(visit);
  };
  visit(document.ast);
  Object.values(document.footnotes).forEach((nodes) => nodes.forEach(visit));
  return [...ids];
}

import { z } from "zod";
import { markAnchorSchema, markColors, markTagsSchema } from "./note-comments";

/** Scroll positions are derived UI data: elastic scrolling and document reflow
 * may place scrollTop outside the current scrollable extent. Never persist it. */
export function unitFraction(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}
export function scrollFraction(
  element: {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
  } | null,
): number {
  if (!element) return 0;
  const extent = element.scrollHeight - element.clientHeight;
  return Number.isFinite(extent) && extent > 0
    ? unitFraction(element.scrollTop / extent)
    : 0;
}
export function normalizeReadingData<T extends { fraction?: number }>(
  data: T,
): T {
  return data && typeof data === "object" && typeof data.fraction === "number"
    ? { ...data, fraction: unitFraction(data.fraction) }
    : data;
}
export const rectangleSchema = z
  .tuple([
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
  ])
  .refine(
    ([x, y, w, h]) => w > 0 && h > 0 && x + w <= 1.001 && y + h <= 1.001,
    "Highlight is outside the page.",
  );
export const annotationDataSchema = z
  .object({
    kind: z.enum([
      "highlight",
      "underline",
      "strikeout",
      "area",
      "note",
      "ink",
      "arrow",
      "textbox",
    ]),
    paths: z
      .array(
        z
          .array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]))
          .min(2)
          .max(2048),
      )
      .min(1)
      .max(20)
      .optional(),
    strokeWidth: z.number().min(0.5).max(12).optional(),
    page: z.number().int().min(1).max(100000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    rects: z.array(rectangleSchema).max(200).default([]),
    quote: z.string().max(12000).default(""),
    body: z.string().max(12000).default(""),
    color: z.enum(["yellow", "green", "blue", "pink"]).default("yellow"),
    tags: markTagsSchema.optional(),
    segments: z
      .array(
        z
          .object({
            page: z.number().int().min(1).max(100000),
            rects: z.array(rectangleSchema).min(1).max(200),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    imported: z
      .object({ sourceId: z.string().max(300), author: z.string().max(300) })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (d) => (d.kind === "note" ? !!d.body.trim() : d.rects.length > 0),
    "Select text or an area, or write a note.",
  )
  .refine(
    (d) =>
      !["ink", "arrow"].includes(d.kind) ||
      (!!d.paths?.length &&
        (d.kind !== "arrow" ||
          (d.paths.length === 1 && d.paths[0].length === 2))),
    "Draw a valid stroke or arrow.",
  )
  .refine(
    (d) => d.kind !== "textbox" || !!d.body.trim(),
    "Write text for the text box.",
  )
  .refine(
    (d) =>
      !d.segments ||
      (d.segments.length > 0 &&
        d.segments[0].page === d.page &&
        new Set(d.segments.map((s) => s.page)).size === d.segments.length &&
        d.segments.reduce((n, s) => n + s.rects.length, 0) <= 200),
    "Multi-page annotations must start on their primary page, contain unique pages, and fit within 200 text rectangles.",
  );
export type AnnotationData = z.infer<typeof annotationDataSchema>;
export type Annotation = {
  id: string;
  attachment_id: string;
  author_id: string;
  author_name?: string;
  shared: boolean;
  data: AnnotationData;
  version: number;
  mutation_id: string;
  deleted: boolean;
  updated_at: string;
  resolved?: boolean;
  reply_count?: number;
  unread_replies?: number;
};
export const readingDataSchema = z
  .object({
    label: z.string().max(300).default(""),
    page: z.number().int().min(1).max(100000).optional(),
    fraction: z.number().min(0).max(1).optional(),
    pdfView: z
      .object({
        offset: z.number().min(0).max(1),
        scale: z.union([
          z.literal("fit"),
          z.literal("page"),
          z.number().min(0.25).max(4),
        ]),
        rotation: z.union([
          z.literal(0),
          z.literal(90),
          z.literal(180),
          z.literal(270),
        ]),
        layout: z.enum(["continuous", "single", "facing"]),
      })
      .strict()
      .optional(),
    heading: z.string().max(300).optional(),
    anchor: markAnchorSchema.optional(),
    tags: markTagsSchema.optional(),
    color: z.enum(markColors).optional(),
    quote: z.string().max(500).optional(),
    generation: z.number().int().positive().optional(),
    status: z.enum(["want", "reading", "read", "archived"]).optional(),
    query: z.string().max(200).optional(),
    author: z.string().max(200).optional(),
    year: z.string().max(20).optional(),
    project: z.string().max(100).optional(),
    tag: z.string().max(100).optional(),
    filterStatus: z
      .enum(["all", "want", "reading", "read", "archived"])
      .optional(),
  })
  .strict();
export type ReadingData = z.infer<typeof readingDataSchema>;
export const readingInputSchema = z
  .object({
    id: z.uuid(),
    group_id: z.uuid(),
    kind: z.enum(["bookmark", "progress", "reading", "filter"]),
    target_type: z.enum(["note", "attachment", "reference", "group"]),
    target_id: z.uuid(),
    data: readingDataSchema,
    version: z.number().int().nonnegative(),
    mutation_id: z.uuid(),
    deleted: z.boolean().default(false),
  })
  .strict()
  .refine(
    (v) =>
      (v.kind === "filter" && v.target_type === "group") ||
      (v.kind === "reading" &&
        v.target_type === "reference" &&
        !!v.data.status) ||
      (["bookmark", "progress"].includes(v.kind) &&
        ["note", "attachment"].includes(v.target_type)),
    "Invalid reading item target.",
  );
export type ReadingItem = z.infer<typeof readingInputSchema> & {
  updated_at?: string;
};
export const referenceDetailsSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    authors: z.string().max(2000).default(""),
    year: z.string().max(20).default(""),
    url: z
      .string()
      .max(2000)
      .refine((v) => !v || /^https?:\/\//i.test(v), "Use an HTTP or HTTPS URL.")
      .default(""),
    doi: z.string().max(300).default(""),
    arxiv: z.string().max(100).default(""),
    venue: z.string().max(500).default(""),
  })
  .strict();
export type ReferenceDetails = z.infer<typeof referenceDetailsSchema>;
export const readingStatuses = {
  want: "Want to read",
  reading: "Reading",
  read: "Read",
  archived: "Archived",
} as const;
export function normalizeIdentifier(value: string): {
  provider: "crossref" | "arxiv";
  identifier: string;
} {
  const clean = value
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "");
  if (/^10\.\d{4,9}\/[^\s<>"?#]{1,260}$/i.test(clean))
    return { provider: "crossref", identifier: clean.toLowerCase() };
  const arxiv = value
    .trim()
    .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, "")
    .replace(/^arxiv:\s*/i, "")
    .replace(/\.pdf$/, "");
  if (
    /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i.test(arxiv)
  )
    return { provider: "arxiv", identifier: arxiv };
  throw new Error(
    "Enter a DOI or arXiv identifier, not an arbitrary website URL.",
  );
}
export function annotationMarkdown(
  annotation: Annotation,
  name: string,
  citeKey?: string,
) {
  const quoted = annotation.data.quote.replace(/([\\`*_{}\[\]<>])/g, "\\$1");
  const label = name.replace(/[\[\]\\\r\n]/g, " ");
  return `${
    quoted
      ? quoted
          .split("\n")
          .map((line) => "> " + line)
          .join("\n") + "\n\n"
      : ""
  }${annotation.data.body ? annotation.data.body + "\n\n" : ""}${citeKey ? `[@${citeKey}] · ` : ""}[${label}, p. ${annotation.data.page}](/api/v1/attachments/${annotation.attachment_id}#page=${annotation.data.page}&annotation=${annotation.id})\n`;
}

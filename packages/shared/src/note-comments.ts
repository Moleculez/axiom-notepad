import { z } from "zod";

export const markAnchorSchema = z
  .object({
    start: z.array(z.number().int().min(0).max(255)).min(1).max(1024),
    end: z.array(z.number().int().min(0).max(255)).min(1).max(1024),
    quote: z.string().max(2000),
    generation: z.number().int().positive(),
    kind: z.enum(["block", "text", "point"]).optional(),
    blockType: z.string().max(60).optional(),
  })
  .strict();
export type MarkAnchor = z.infer<typeof markAnchorSchema>;
export const markColors = [
  "neutral",
  "blue",
  "green",
  "amber",
  "rose",
] as const;
export const markTagsSchema = z
  .array(z.string().trim().min(1).max(40))
  .max(12)
  .transform((tags) => [...new Set(tags)]);
export const annotationCategories = [
  "note",
  "question",
  "idea",
  "follow-up",
] as const;
export const commentCreateSchema = z
  .object({
    id: z.uuid().optional(),
    body: z.string().trim().min(1).max(10000),
    parentId: z.uuid().nullable().default(null),
    anchor: markAnchorSchema.nullable().default(null),
    kind: z.enum(["discussion", "annotation"]).default("discussion"),
    visibility: z.enum(["private", "shared"]).optional(),
    title: z.string().trim().max(200).default(""),
    category: z.enum(annotationCategories).default("note"),
    tags: markTagsSchema.default([]),
    bodyFormat: z.enum(["plain", "markdown"]).default("plain"),
    mutationId: z.uuid().optional(),
  })
  .strict();
export const commentPatchSchema = z
  .object({
    body: z.string().trim().min(1).max(10000).optional(),
    bodyFormat: z.enum(["plain", "markdown"]).optional(),
    title: z.string().trim().max(200).optional(),
    category: z.enum(annotationCategories).optional(),
    tags: markTagsSchema.optional(),
    anchor: markAnchorSchema.nullable().optional(),
    visibility: z.enum(["private", "shared"]).optional(),
    resolved: z.boolean().optional(),
    deleted: z.boolean().optional(),
    version: z.number().int().positive().optional(),
    expectedVisibility: z.enum(["private", "shared"]).optional(),
    mutationId: z.uuid().optional(),
  })
  .strict()
  .refine(
    (v) =>
      Object.keys(v).some(
        (k) => !["version", "mutationId", "expectedVisibility"].includes(k),
      ),
    "No changes supplied.",
  );
export type CommentCreate = z.infer<typeof commentCreateSchema>;
export type CommentPatch = z.infer<typeof commentPatchSchema>;
export type NoteComment = {
  id: string;
  note_id: string;
  author_id: string;
  author_name?: string;
  parent_id: string | null;
  body: string;
  anchor: MarkAnchor | null;
  kind: "discussion" | "annotation";
  visibility: "private" | "shared";
  title: string;
  category: (typeof annotationCategories)[number];
  tags: string[];
  body_format: "plain" | "markdown";
  version: number;
  mutation_id: string | null;
  resolved: boolean;
  deleted: boolean;
  created_at: string;
  updated_at: string;
};

/** Normalize JSONB key order before comparing an acknowledged private write
 * with newer local work. Object insertion order is not content identity. */
export function commentContentPatch(record: NoteComment): CommentPatch {
  if (record.deleted) return { deleted: true };
  return {
    body: record.body,
    title: record.title,
    category: record.category,
    tags: record.tags,
    bodyFormat: record.body_format,
    ...(record.parent_id
      ? {}
      : {
          anchor: record.anchor ? markAnchorSchema.parse(record.anchor) : null,
          resolved: record.resolved,
        }),
  };
}

export function visibleThread(
  author: string,
  visibility: string,
  viewer: string,
) {
  return visibility === "shared" || author === viewer;
}
export function exportReadingMarks(
  title: string,
  entries: {
    label: string;
    body?: string;
    location?: string;
    tags?: string[];
  }[],
) {
  const clean = (value: string) =>
    value.replace(/[\r\n]+/g, " ").replace(/([\\`*_{}\[\]<>#])/g, "\\$1");
  return (
    `# ${clean(title)}\n\n` +
    entries
      .map(
        (e) =>
          `## ${clean(e.label)}\n\n${e.location ? clean(e.location) + "\n\n" : ""}${e.body ?? ""}${e.tags?.length ? "\n\nTags: " + e.tags.map(clean).join(", ") : ""}\n`,
      )
      .join("\n")
  );
}

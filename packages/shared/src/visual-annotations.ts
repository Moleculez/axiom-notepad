import { z } from "zod";
import { markAnchorSchema } from "./note-comments";

const unit = z.number().finite().min(0).max(1);
export const visualPointSchema = z.tuple([unit, unit]);
export type VisualPoint = z.infer<typeof visualPointSchema>;
export const visualPlacementSchema = z
  .object({
    // Resource owns permissions; path identifies a placement, not a global asset.
    resourceId: z.uuid(),
    path: z.array(z.string().min(1).max(200)).max(12).default([]),
    anchor: markAnchorSchema.optional(),
    from: z.number().int().nonnegative().optional(),
    to: z.number().int().nonnegative().optional(),
    versionId: z.uuid().optional(),
    // Read-only embedded snapshots without a live Y.Text require review after
    // any upstream revision; identical URLs must not silently inherit marks.
    revision: z.string().max(200).optional(),
  })
  .strict();
export type VisualPlacement = z.infer<typeof visualPlacementSchema>;
export const visualSourceSchema = z
  .object({
    kind: z.enum(["image", "mermaid"]),
    fingerprint: z.string().min(1).max(200),
    width: z.number().finite().positive().max(1_000_000),
    height: z.number().finite().positive().max(1_000_000),
    label: z.string().max(300),
    verified: z.boolean(),
  })
  .strict();
export type VisualSource = z.infer<typeof visualSourceSchema>;
export const visualShapeSchema = z
  .object({
    kind: z.enum(["arrow", "rectangle", "ellipse", "pen", "label", "pin"]),
    points: z.array(visualPointSchema).min(1).max(2000),
    color: z.string().regex(/^#[a-f\d]{6}$/i),
    stroke: z.number().finite().min(1).max(8).default(2),
    text: z.string().max(500).default(""),
  })
  .strict()
  .superRefine((s, c) => {
    if (
      ["arrow", "rectangle", "ellipse", "pen"].includes(s.kind) &&
      s.points.length < 2
    )
      c.addIssue({
        code: "custom",
        message: "Draw a region with at least two points.",
      });
  });
export type VisualShape = z.infer<typeof visualShapeSchema>;
export const visualWriteSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().nonnegative(),
    mutationId: z.uuid(),
    placement: visualPlacementSchema,
    source: visualSourceSchema,
    shape: visualShapeSchema.nullable(),
    body: z.string().max(10000).default(""),
    parentId: z.uuid().nullable().default(null),
    visibility: z.enum(["private", "shared"]).default("private"),
    resolved: z.boolean().default(false),
    deleted: z.boolean().default(false),
  })
  .strict()
  .refine(
    (v) => v.deleted || v.shape || v.body.trim(),
    "Draw a mark or write a note.",
  );
export type VisualWrite = z.infer<typeof visualWriteSchema>;
export type VisualAnnotation = VisualWrite & {
  authorId: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
};
export const clampUnit = (n: number) =>
  Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
export function moveShape(shape: VisualShape, delta: VisualPoint): VisualShape {
  const xs = shape.points.map((p) => p[0]),
    ys = shape.points.map((p) => p[1]);
  const dx = Math.max(
    -Math.min(...xs),
    Math.min(1 - Math.max(...xs), delta[0]),
  );
  const dy = Math.max(
    -Math.min(...ys),
    Math.min(1 - Math.max(...ys), delta[1]),
  );
  return {
    ...shape,
    points: shape.points.map(([x, y]) => [
      clampUnit(x + dx),
      clampUnit(y + dy),
    ]),
  };
}
export function samePlacement(a: VisualPlacement, b: VisualPlacement) {
  if (
    a.resourceId !== b.resourceId ||
    JSON.stringify(a.path) !== JSON.stringify(b.path) ||
    a.versionId !== b.versionId ||
    a.revision !== b.revision
  )
    return false;
  if (a.anchor || b.anchor)
    return (
      !!a.anchor &&
      !!b.anchor &&
      a.anchor.generation === b.anchor.generation &&
      JSON.stringify(a.anchor.start) === JSON.stringify(b.anchor.start) &&
      JSON.stringify(a.anchor.end) === JSON.stringify(b.anchor.end)
    );
  return a.from === b.from && a.to === b.to;
}
/** Replacing a file or changing diagram geometry must never silently move marks. */
export function sameVisualSource(a: VisualSource, b: VisualSource) {
  return (
    a.kind === b.kind &&
    a.fingerprint === b.fingerprint &&
    a.width === b.width &&
    a.height === b.height
  );
}

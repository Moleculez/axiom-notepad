import { z } from "zod";
import { mindmapSettingsSchema } from "@axiom/shared/mindmap";
import type { NativeBinding } from "@axiom/editor/binding";
import type { MindmapProjection } from "@axiom/mindmap";
import { mindmapZoomLimits } from "@axiom/mindmap";

const position = z.number().int().min(0).max(1_000_000);
export const mindmapViewSchema = z
  .object({
    settings: mindmapSettingsSchema,
    camera: z.object({
      x: z.number().min(-100_000_000).max(100_000_000),
      y: z.number().min(-100_000_000).max(100_000_000),
      scale: z.number().min(mindmapZoomLimits.min).max(mindmapZoomLimits.max),
    }),
    pane: z.enum(["source", "details"]).nullable(),
    selection: position.optional(),
    label: z.string().max(1_000_000).optional(),
    folds: z
      .array(
        z.object({
          position,
          label: z.string().max(1_000_000),
          type: z.string().max(80),
        }),
      )
      .max(5000),
  })
  .strict();
export type MindmapViewState = z.infer<typeof mindmapViewSchema>;
export type MindmapDraft = {
  bookmark: ReturnType<NativeBinding["relative"]>;
  original: string;
  type: string;
  value: string;
};

/** Resolve only the original collaborative span, never by label similarity. */
export function resolveMindmapDraft(
  binding: NativeBinding,
  projection: MindmapProjection,
  draft: MindmapDraft,
) {
  const range = binding.absolute(draft.bookmark);
  if (
    !range ||
    binding.source.slice(range.anchor, range.head) !== draft.original
  )
    return null;
  return (
    projection.nodes.find(
      (n) =>
        n.labelFrom === range.anchor &&
        n.labelTo === range.head &&
        n.blockType === draft.type,
    ) ?? null
  );
}

import { z } from "zod";

/** Presentation only. No executable frontmatter, URLs or global theme changes. */
export const mindmapSettingsSchema = z
  .object({
    layout: z.enum(["right", "left", "balanced"]).default("right"),
    spacing: z.enum(["comfortable", "compact"]).default("comfortable"),
    colors: z.enum(["accent", "spectrum"]).default("accent"),
    nodeWidth: z.number().int().min(160).max(480).default(280),
    initialDepth: z.number().int().min(1).max(12).default(3),
  })
  .strict();
export type MindmapDefaults = z.infer<typeof mindmapSettingsSchema>;

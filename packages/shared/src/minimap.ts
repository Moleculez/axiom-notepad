import { z } from "zod";

/** Presentation only: never serialized into a note or collaboration awareness. */
export const minimapPreferencesSchema = z
  .object({
    enabled: z.boolean().default(false),
    write: z.boolean().default(true),
    source: z.boolean().default(true),
    read: z.boolean().default(true),
    side: z.enum(["right", "left"]).default("right"),
    width: z.number().int().min(80).max(200).default(120),
    size: z.enum(["fit", "proportional", "fill"]).default("fit"),
    rendering: z.enum(["text", "blocks"]).default("text"),
    slider: z.enum(["hover", "always"]).default("hover"),
    headings: z.boolean().default(true),
    preview: z.boolean().default(true),
    search: z.boolean().default(true),
    selection: z.boolean().default(true),
    collaborators: z.boolean().default(true),
  })
  .strict();
export type MinimapPreferences = z.infer<typeof minimapPreferencesSchema>;
export const minimapDefaults = minimapPreferencesSchema.parse({});

/** Do not reconfigure the rich projection for navigation-only preferences. */
export function editorAppearanceKey(value: Record<string, unknown>): string {
  const { minimap: _minimap, ...editorAppearance } = value;
  return JSON.stringify(editorAppearance);
}

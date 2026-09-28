import { z } from "zod";

export const siteThemes = [
  {
    id: "classic",
    name: "Original",
    description: "The original Axiom publication style",
  },
  {
    id: "latex-paper",
    name: "LaTeX Paper",
    description: "Latin Modern, academic rules and a quiet paper canvas",
  },
  {
    id: "latex-book",
    name: "LaTeX Monograph",
    description: "Chapter typography and spacious, book-like reading",
  },
  {
    id: "tufte",
    name: "Tufte Essay",
    description: "Editorial serif, generous figures and margin notes",
  },
  {
    id: "material",
    name: "Material Research",
    description: "Tonal surfaces and softly rounded controls",
  },
  {
    id: "fluent",
    name: "Fluent Studio",
    description: "Fine borders, subtle layers and clear navigation",
  },
  {
    id: "minimal",
    name: "Minimal Journal",
    description: "Flat monochrome surfaces and precise editorial rhythm",
  },
] as const;
export const siteThemeSchema = z.enum([
  "classic",
  "latex-paper",
  "latex-book",
  "tufte",
  "material",
  "fluent",
  "minimal",
]);
export type SiteTheme = z.infer<typeof siteThemeSchema>;
export const siteReadingSchema = z
  .object({
    toc: z.boolean().default(true),
    sectionNumbers: z.boolean().default(true),
    wordCount: z.boolean().default(true),
    readingTime: z.boolean().default(true),
    progress: z.boolean().default(true),
    fontSize: z.number().int().min(16).max(24).default(18),
    lineHeight: z.number().min(1.4).max(2.2).default(1.75),
    measure: z.number().int().min(55).max(90).default(72),
  })
  .strict();
export const siteArchiveSchema = z
  .object({
    style: z.enum(["timeline", "list"]).default("timeline"),
    includePages: z.boolean().default(false),
  })
  .strict();

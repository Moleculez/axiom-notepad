import { z } from "zod";
export const mathProjectSettings = z
  .object({
    macros: z.string().max(15000).default(""),
    foreground: z
      .string()
      .regex(/^#[\da-f]{6}$/i)
      .default("#202124"),
    background: z
      .string()
      .regex(/^#[\da-f]{6}$/i)
      .default("#ffffff"),
    transparent: z.boolean().default(true),
    numbered: z.boolean().default(false),
    fontSize: z.number().int().min(16).max(64).default(28),
  })
  .strict();
const geometry = z.number().finite().min(-1_000_000).max(1_000_000);
const scale = z
  .number()
  .finite()
  .refine(
    (v) => Math.abs(v) >= 0.01 && Math.abs(v) <= 64,
    "Layer scale is outside the supported range.",
  );
const asset = z.string().regex(/^layers\/[\da-f-]+\.png$/);
export const imageProjectManifest = z
  .object({
    format: z.literal("axiom-image"),
    version: z.literal(1),
    width: z.number().int().min(1).max(8192),
    height: z.number().int().min(1).max(8192),
    layers: z
      .array(
        z.object({
          id: z.uuid(),
          name: z.string().max(160),
          kind: z.enum(["raster", "text", "group"]),
          asset,
          mask: asset.optional(),
          parent: z.uuid().optional(),
          x: geometry,
          y: geometry,
          rotation: geometry,
          scaleX: scale,
          scaleY: scale,
          opacity: z.number().min(0).max(1),
          visible: z.boolean(),
          locked: z.boolean(),
          blend: z.enum([
            "source-over",
            "multiply",
            "screen",
            "overlay",
            "darken",
            "lighten",
            "color-dodge",
            "color-burn",
            "hard-light",
            "soft-light",
            "difference",
            "exclusion",
            "hue",
            "saturation",
            "color",
            "luminosity",
          ]),
          text: z.string().max(10000).optional(),
          color: z
            .string()
            .regex(/^#[\da-f]{6}$/i)
            .optional(),
          fontSize: z.number().min(8).max(500).optional(),
          fontFamily: z
            .enum(["Inter", "Source Serif 4", "JetBrains Mono"])
            .optional(),
          textOrigin: z.object({ x: geometry, y: geometry }).optional(),
        }),
      )
      .max(100),
  })
  .superRefine((m, ctx) => {
    if (
      m.width * m.height > 16_000_000 ||
      m.layers.length * m.width * m.height > 64_000_000
    )
      ctx.addIssue({
        code: "custom",
        message: "Image exceeds the project pixel budget.",
      });
    const ids = new Set(m.layers.map((l) => l.id));
    if (ids.size !== m.layers.length)
      ctx.addIssue({ code: "custom", message: "Layer IDs must be unique." });
    for (const layer of m.layers)
      if (
        layer.parent &&
        (layer.kind === "group" ||
          !m.layers.some(
            (p) => p.id === layer.parent && p.kind === "group" && !p.parent,
          ))
      )
        ctx.addIssue({
          code: "custom",
          message: "Layer group reference is invalid.",
        });
  });
export function isProjectPng(bytes: Uint8Array, width: number, height: number) {
  if (
    bytes.length < 24 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
  )
    return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(16) === width && view.getUint32(20) === height;
}
export type ToolProject = {
  resource_id: string;
  kind: "math" | "image" | "canvas" | "text";
  parent_id?: string | null;
  name: string;
  space_id: string;
  settings: Record<string, unknown>;
  version: number;
  role: "editor" | "commenter" | "viewer";
  generation?: number;
  current_version_id?: string | null;
  updated_at: string;
};
export type ImageEditLease = {
  token: string;
  fence: number;
  expiresAt: string;
  ownerId: string;
};
export type ToolJob = {
  id: string;
  kind: "office-preview" | "ocr" | "generate" | "check" | "explain";
  status:
    "queued" | "running" | "complete" | "failed" | "cancelled" | "uncertain";
  result?: { text?: string; source?: string };
  error?: string;
  created_at: string;
};

import { z } from "zod";
import { imageProjectManifest } from "./research-tools";
export const cloudImageManifest = z
  .object({
    project: imageProjectManifest,
    assets: z.record(z.string().regex(/^layers\/[\da-f-]+\.png$/), z.uuid()),
    preview: z.uuid(),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (
      Object.keys(m.assets).length > 200 ||
      m.project.layers.some(
        (l) => !m.assets[l.asset] || (l.mask && !m.assets[l.mask]),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Every layer and mask must reference an uploaded asset.",
      });
  });
export type CloudImageManifest = z.infer<typeof cloudImageManifest>;
export type CloudImageDraft = {
  assetHashes?: Record<string, string>;
  revision: number;
  baseVersion: string | null;
  manifest: CloudImageManifest;
  previousManifest: CloudImageManifest | null;
  previousBaseVersion: string | null;
  owner: string;
  updatedAt: string;
};

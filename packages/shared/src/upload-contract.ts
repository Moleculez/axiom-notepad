import { z } from "zod";
import { MAX_FILE_BYTES, resourceNameSchema } from "./workspace";

export const uploadInputSchema = z
  .object({
    id: z.uuid(),
    spaceId: z.uuid(),
    parentId: z.uuid().nullable().default(null),
    resourceId: z.uuid().nullable().default(null),
    name: resourceNameSchema,
    bytes: z.number().int().min(1).max(MAX_FILE_BYTES),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    expectedVersionId: z.uuid().optional(),
    expectedResourceVersion: z.number().int().positive().optional(),
    provenance: z
      .object({
        sourceVersionId: z.uuid(),
        sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
        operation: z.enum(["organize", "annotated-copy", "ocr"]),
        annotations: z
          .array(
            z
              .object({ id: z.uuid(), version: z.number().int().positive() })
              .strict(),
          )
          .max(500)
          .default([]),
        acknowledgeOmissions: z.boolean().default(false),
        pages: z
          .array(
            z
              .object({
                source: z.number().int().min(0).max(2000),
                page: z.number().int().min(1).max(100000),
                rotation: z.union([
                  z.literal(0),
                  z.literal(90),
                  z.literal(180),
                  z.literal(270),
                ]),
              })
              .strict(),
          )
          .min(1)
          .max(2000)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .refine(
    (v) =>
      !v.resourceId || (!!v.expectedVersionId && !!v.expectedResourceVersion),
    {
      message:
        "Replacing a file requires its expected version. Refresh the file before trying again.",
    },
  );

export function uploadHeadMatches(
  upload: {
    expected_version_id: string | null;
    expected_resource_version: number | null;
  },
  target: { current_version_id: string | null; version: number },
) {
  return (
    !!upload.expected_version_id &&
    upload.expected_version_id === target.current_version_id &&
    upload.expected_resource_version === target.version
  );
}

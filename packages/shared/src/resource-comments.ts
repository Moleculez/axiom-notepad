import { z } from "zod";

/** Pure, shared anchor contract for native comments and connected clients. */
export const resourceAnchor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("whole") }),
  z.object({
    kind: z.literal("canvas-node"),
    nodeId: z.string().min(1).max(200),
  }),
  z.object({
    kind: z.literal("time"),
    seconds: z.number().finite().min(0).max(604800),
  }),
  z.object({
    kind: z.literal("image"),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }),
  z.object({
    kind: z.literal("line"),
    line: z.number().int().min(1).max(10000000),
  }),
  z.object({
    kind: z.literal("page"),
    page: z.number().int().min(1).max(100000),
  }),
  z.object({
    kind: z.literal("cell"),
    sheet: z.string().max(160),
    cell: z.string().regex(/^[A-Z]{1,3}[1-9]\d{0,6}$/),
  }),
]);

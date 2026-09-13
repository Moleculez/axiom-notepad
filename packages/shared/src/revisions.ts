import { z } from "zod";
import type { DocumentFormat } from "./document-format";
export type RevisionFormat = DocumentFormat | "image";
export type RevisionSummary = {
  id: string;
  title: string;
  label: string | null;
  kind: "snapshot" | "file" | "legacy" | "current" | "seen";
  format: RevisionFormat;
  createdAt: string;
  author: string | null;
  contributors: string[];
  generation: number | null;
  metadataVersion: number;
};
export type RevisionContent = RevisionSummary & {
  body: string | null;
  settings: Record<string, unknown> | null;
  preview: string | null;
  download: string | null;
  fileVersion: string | null;
  cloudRevision?: number;
  image?: { width: number; height: number; layers: number };
  hash: string;
};
export type RevisionPage = {
  items: RevisionSummary[];
  nextCursor: string | null;
};
export const suggestionHunkSchema = z
  .object({
    start: z.string().min(1).max(2000),
    end: z.string().min(1).max(2000),
    before: z.string().max(1_000_000),
    insert: z.string().max(1_000_000),
    left: z.string().max(64).optional(),
    right: z.string().max(64).optional(),
  })
  .strict();
export type SuggestionHunk = z.infer<typeof suggestionHunkSchema>;
export const suggestionWriteSchema = z
  .object({
    id: z.uuid(),
    mutationId: z.uuid(),
    version: z.number().int().nonnegative(),
    generation: z.number().int().positive(),
    hunks: z.array(suggestionHunkSchema).max(500),
    message: z.string().max(10000).default(""),
  })
  .strict()
  .refine(
    (v) =>
      v.hunks.reduce((n, h) => n + h.before.length + h.insert.length, 0) <=
      2_000_000,
    "Proposal is too large.",
  );
export type SuggestionWrite = z.infer<typeof suggestionWriteSchema>;
export type Suggestion = {
  id: string;
  noteId: string;
  generation: number;
  authorId: string;
  author: string;
  version: number;
  status: "pending" | "accepted" | "rejected" | "withdrawn";
  hunks: SuggestionHunk[];
  message: string;
  createdAt: string;
  updatedAt: string;
  conflicted?: boolean;
  reason?: string;
  ranges?: { from: number; to: number; insert: string }[];
  decidedBy?: string | null;
  replies: { id: string; author: string; body: string; createdAt: string }[];
};
export const revisionCommandSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("snapshot"),
      label: z.string().trim().min(1).max(120),
      mutationId: z.uuid(),
      noteId: z.uuid(),
      generation: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("restore"),
      snapshotId: z.uuid(),
      expectedHash: z.string().regex(/^[a-f\d]{64}$/),
      expectedSettings: z.record(z.string(), z.unknown()).nullable().optional(),
      mutationId: z.uuid(),
      noteId: z.uuid(),
      generation: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("decision"),
      action: z.enum(["accept", "reject", "withdraw"]),
      items: z
        .array(
          z
            .object({ id: z.uuid(), version: z.number().int().positive() })
            .strict(),
        )
        .min(1)
        .max(100),
      mutationId: z.uuid(),
      noteId: z.uuid(),
      generation: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("undo-decision"),
      decisionId: z.uuid(),
      mutationId: z.uuid(),
      noteId: z.uuid(),
      generation: z.number().int().positive(),
    })
    .strict(),
]);
export type RevisionCommand = z.infer<typeof revisionCommandSchema>;

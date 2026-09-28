import { z } from "zod";
export const snippetInput = z.object({
  name: z.string().trim().min(1).max(160),
  body: z.string().min(1).max(100_000),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  spaceId: z.uuid().nullable().default(null),
});
export type EditorSnippet = {
  id: string;
  owner_id: string;
  space_id: string | null;
  name: string;
  body: string;
  tags: string[];
  version: number;
  archived: boolean;
  updated_at: string;
};
export type ResolvedAsset = {
  versionId: string;
  resourceId?: string;
  name?: string;
  mime?: string;
  bytes?: number;
  referenceCode?: string;
  currentVersionId?: string;
  spaceId?: string;
  unavailable?: boolean;
};
export type UploadResult = {
  transferId: string;
  resourceId: string;
  versionId: string;
  name: string;
  mime: string;
  bytes: number;
};
export type UploadBatch = {
  ids: string[];
  ready: Promise<UploadResult[]>;
  cancel: () => Promise<void>;
};

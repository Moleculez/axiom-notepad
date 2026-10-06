export type RecoveryActivityItem = {
  id: string;
  kind: "files" | "export" | "ocr" | "tool" | "assistant" | "extension";
  title: string;
  status: string;
  createdAt: string;
  spaceId?: string;
  resourceId?: string;
  conversationId?: string;
  changeSetId?: string;
};
export const activityNeedsAttention = (status: string) =>
  [
    "failed",
    "uncertain",
    "partial",
    "blocked",
    "paused",
    "awaiting-review",
  ].includes(status);
export const activityIsRunning = (status: string) =>
  ["queued", "running", "applying", "uploading", "verifying"].includes(status);

import { z } from "zod";
export const integrationScopes = [
  "workspace:read",
  "workspace:write",
  "workspace:manage",
] as const;
export type IntegrationScope = (typeof integrationScopes)[number];
type Action = {
  name: string;
  description: string;
  scope: IntegrationScope;
  method: string;
  path: string;
  target: "workspace" | "resource" | "project" | "group" | "account";
  approval?: boolean;
};
const read = (
  name: string,
  path: string,
  target: Action["target"],
  description: string,
): Action => ({
  name,
  path,
  target,
  description,
  scope: "workspace:read",
  method: "GET",
});
const write = (
  name: string,
  path: string,
  target: Action["target"],
  description: string,
  method = "POST",
  approval = false,
  manage = false,
): Action => ({
  name,
  path,
  target,
  description,
  method,
  approval,
  scope: manage ? "workspace:manage" : "workspace:write",
});
/** Deliberately no shell, SQL, password, secrets, authentication, or provider
 * credentials. Payloads are validated again by the same application services. */
export const integrationActions: Action[] = [
  read(
    "files_list",
    "resources",
    "workspace",
    "List files. query supports q, parentId, view, kind, cursor, sort, direction, limit (100 max).",
  ),
  read(
    "file_details",
    "resources/:id",
    "resource",
    "File metadata, type, version, storage and permissions.",
  ),
  read(
    "file_location",
    "resources/:id/location",
    "resource",
    "Get the full folder path.",
  ),
  read(
    "file_versions",
    "files/:id/versions",
    "resource",
    "List immutable versions of a stored file.",
  ),
  read(
    "file_usage",
    "files/:id/usage",
    "resource",
    "Find references and annotations before removing a file.",
  ),
  read(
    "note_read",
    "notes/:id",
    "resource",
    "Read canonical content and a content hash. Flushes the live collaboration room first.",
  ),
  read(
    "note_history",
    "notes/:id/history",
    "resource",
    "List saved note checkpoints.",
  ),
  read(
    "note_comments",
    "notes/:id/comments",
    "resource",
    "Read discussion and text annotations.",
  ),
  read(
    "project_details",
    "projects/:id",
    "project",
    "Project metadata, members and current state.",
  ),
  read("project_tasks", "projects/:id/tasks", "project", "List project tasks."),
  read(
    "project_milestones",
    "projects/:id/milestones",
    "project",
    "List project milestones.",
  ),
  read(
    "project_discussions",
    "projects/:id/discussions",
    "project",
    "Read project discussions.",
  ),
  read(
    "project_reviews",
    "projects/:id/reviews",
    "project",
    "List research reviews.",
  ),
  read(
    "project_members",
    "projects/:id/members",
    "project",
    "List the project's explicit membership.",
  ),
  read(
    "group_overview",
    "group-admin/:id/overview",
    "group",
    "Group administration overview; requires your existing admin role.",
  ),
  read(
    "group_members",
    "group-admin/:id/members",
    "group",
    "Group members and administrative/content roles.",
  ),
  read(
    "group_invitations",
    "group-admin/:id/invitations",
    "group",
    "Invitation statuses, without invitation secrets.",
  ),
  read(
    "workspace_lifecycle",
    "spaces/:id/lifecycle",
    "workspace",
    "Workspace status, allowed transitions and deletion impact.",
  ),
  read(
    "audit_history",
    "audit",
    "workspace",
    "File and workspace history. Supports cursor and actor/action/entity filters.",
  ),
  read(
    "trash_list",
    "trash/items",
    "workspace",
    "List deleted files and their current restoration eligibility.",
  ),
  read(
    "studio_details",
    "tools/:id",
    "resource",
    "Read math, image, text or canvas project settings.",
  ),
  read(
    "studio_history",
    "tools/:id/history",
    "resource",
    "Read named studio checkpoints.",
  ),
  read(
    "resource_discussion",
    "resource-comments/:id",
    "resource",
    "Read file or studio discussions. query.version pins a file version.",
  ),
  write(
    "file_create",
    "files/new",
    "workspace",
    "Create a file. payload: type (markdown,canvas,math,image,text,csv,json,yaml,docx,xlsx,pptx), name, parentId?, source?, id?, mutationId.",
  ),
  write(
    "folder_create",
    "resources",
    "workspace",
    "Create a folder. payload: kind=folder, name, parentId?, id?, mutationId.",
  ),
  write(
    "file_update",
    "resources/:id",
    "resource",
    "Rename, tag, describe or move within a workspace. payload: version, mutationId, name?, description?, tags?, parentId?.",
    "PATCH",
  ),
  write(
    "file_favorite",
    "resources/:id/favorite",
    "resource",
    "Set personal favorite. payload: favorite (boolean).",
  ),
  write(
    "file_copy",
    "resources/:id/copy",
    "resource",
    "Copy to an authorized destination. payload follows copy preview contract; destinationSpaceId, parentId, version, mutationId. Requires in-app approval for audience changes.",
    "POST",
    true,
  ),
  write(
    "file_transfer",
    "resources/:id/transfer",
    "resource",
    "Move to another workspace using checked transfer. Requires in-app approval.",
    "POST",
    true,
  ),
  write(
    "file_trash",
    "resources/:id/trash",
    "resource",
    "Move a file/folder to trash. payload: version, mutationId. Requires in-app approval.",
    "POST",
    true,
  ),
  write(
    "file_restore",
    "resources/:id/restore",
    "resource",
    "Restore a deleted file. payload: version, mutationId.",
    "POST",
    true,
  ),
  write(
    "file_purge",
    "resources/:id/purge",
    "resource",
    "Permanently remove an unreferenced file. Requires current management rights and in-app approval.",
    "POST",
    true,
    true,
  ),
  write(
    "note_checkpoint",
    "notes/:id/history",
    "resource",
    "Save a named canonical checkpoint. payload: label.",
  ),
  write(
    "note_comment",
    "notes/:id/comments",
    "resource",
    "Add a discussion or annotation. payload: body, anchor?, parentId?.",
  ),
  write(
    "resource_comment",
    "resource-comments/:id",
    "resource",
    "Add a file/studio comment. payload: body, anchor, versionId?.",
  ),
  write(
    "studio_settings",
    "tools/:id/settings",
    "resource",
    "Update rendering settings with version precondition. payload: settings, version.",
    "PATCH",
  ),
  write(
    "studio_checkpoint",
    "tools/:id/history",
    "resource",
    "Save a named studio checkpoint. payload: source, label, mutationId.",
  ),
  write(
    "task_create",
    "projects/:id/tasks",
    "project",
    "Create a task. payload: title, description?, assigneeId?, dueDate?, priority?, mutationId?.",
  ),
  write(
    "milestone_create",
    "projects/:id/milestones",
    "project",
    "Create a milestone using the project form contract.",
  ),
  write(
    "project_discussion_create",
    "projects/:id/discussions",
    "project",
    "Start a project discussion using title and body.",
  ),
  write(
    "project_review_create",
    "projects/:id/reviews",
    "project",
    "Create a research review with note and reviewers.",
  ),
  write(
    "project_update",
    "projects/:id",
    "project",
    "Update name/description/color/audience with version precondition. Requires in-app approval.",
    "PATCH",
    true,
    true,
  ),
  write(
    "project_members_update",
    "projects/:id/members",
    "project",
    "Change project membership. Requires in-app approval.",
    "POST",
    true,
    true,
  ),
  write(
    "group_invite",
    "group-admin/:id/invitations",
    "group",
    "Invite members. payload: emails[], role, contentRole, mutationId. Sends invitation mail after in-app approval.",
    "POST",
    true,
    true,
  ),
  write(
    "group_members_update",
    "group-admin/:id/members",
    "group",
    "Change administrative/content roles or remove members. Use the member IDs and versions from group_members, plus mutationId. Existing last-owner and project-lead protections apply.",
    "PATCH",
    true,
    true,
  ),
  write(
    "group_invitations_reissue",
    "group-admin/:id/invitations/reissue",
    "group",
    "Reissue selected invitation IDs and versions with a mutationId after in-app approval. Prior invitation links are invalidated.",
    "POST",
    true,
    true,
  ),
  write(
    "group_invitations_revoke",
    "group-admin/:id/invitations/revoke",
    "group",
    "Revoke selected invitation IDs and versions with a mutationId after in-app approval.",
    "POST",
    true,
    true,
  ),
  ...["archive", "unarchive", "trash", "restore", "purge"].map((action) =>
    write(
      `workspace_${action}`,
      `spaces/:id/${action}`,
      "workspace",
      `${action} a workspace. payload: version, mutationId, confirmation (workspace name for purge). Requires in-app approval.`,
      "POST",
      true,
      true,
    ),
  ),
  write(
    "workspace_update",
    "spaces/:id",
    "workspace",
    "Rename workspace and update description. payload: name, description, version, mutationId.",
    "PATCH",
    true,
    true,
  ),
];
export const integrationActionInput = z
  .object({
    spaceId: z.uuid(),
    id: z.string().min(1).max(200).optional(),
    query: z.record(z.string().max(80), z.string().max(1000)).default({}),
    payload: z.record(z.string().max(80), z.unknown()).default({}),
    approvalId: z.uuid().optional(),
  })
  .strict();
export type IntegrationActionInput = z.infer<typeof integrationActionInput>;

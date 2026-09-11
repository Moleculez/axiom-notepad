import { randomBytes, createHash, randomUUID } from "node:crypto";
import {
  initializeDocument,
  documentExtension,
} from "@axiom/shared/document-format";
import { z } from "zod";
import * as Y from "yjs";
import JSZip from "jszip";
import {
  auth,
  appUrl,
  sendMail,
  institutionalIdentity,
} from "@axiom/shared/auth";
import { query, transaction } from "@axiom/shared/db";
import { setAuditActor, withAuditContext } from "@axiom/shared/audit-context";
import { auditApi } from "@axiom/shared/audit-api";
import {
  HttpError,
  memberAccess,
  spaceAccessEpoch,
  noteAccess,
  requireNoteCapability,
  fileAccess,
  spaceAccess,
  projectAccess,
  signSyncToken,
  type Note,
} from "@axiom/shared/access";
import {
  createNote,
  flushNote,
  notifyWorkspace,
  indexNote,
} from "@axiom/shared/documents";
import {
  putAttachment,
  getAttachment,
  attachmentMime,
} from "@axiom/shared/storage";
import { htmlExport } from "@axiom/shared/html-export";
import { preferencesApi } from "@axiom/shared/preferences-api";
import { editorPreferencesApi } from "@axiom/shared/editor-preferences-api";
import { preferencesBundleApi } from "@axiom/shared/preferences-bundle-api";
import { workspaceApi } from "@axiom/shared/workspace-api";
import { spaceLifecycleApi } from "@axiom/shared/space-lifecycle";
import {
  assertGroupActive,
  recordActivity,
  requireNoteScope,
  noteWriteQuery,
  workspaceMutation,
} from "@axiom/shared/workspace-service";
import {
  acceptGroupInvitation,
  groupInvitationsApi,
} from "@axiom/shared/group-invitations";
import { resourceOperationsApi } from "@axiom/shared/resource-operations";
import { workspaceExportsApi } from "@axiom/shared/workspace-exports";
import { resourceTransferApi } from "@axiom/shared/resource-transfer";
import { fileWorkflowsApi } from "@axiom/shared/file-workflows-api";
import { workspaceEvents } from "@axiom/shared/workspace-events";
import { uploadsApi } from "@axiom/shared/uploads-api";
import { filePreviewApi } from "@axiom/shared/file-preview-api";
import { canvasPreviewApi } from "@axiom/shared/canvas-preview-api";
import { researchToolsApi } from "@axiom/shared/research-tools-api";
import { fileCreateApi } from "@axiom/shared/file-create-api";
import { integrationApi } from "@axiom/shared/integration-api";
import { offlineApi } from "@axiom/shared/offline-api";
import { assertDataset, instanceApi } from "@axiom/shared/instance";
import { toolServicesApi } from "@axiom/shared/tool-services-api";
import { resourceCommentsApi } from "@axiom/shared/resource-comments-api";
import { projectsApi } from "@axiom/shared/projects-api";
import { accountsApi } from "@axiom/shared/accounts-api";
import { groupAdministrationApi } from "@axiom/shared/group-administration";
import { trashApi } from "@axiom/shared/trash-api";
import { fileResponse } from "@axiom/shared/storage-streams";
import {
  researchApi,
  referenceLibrary,
  requireLibraryEditor,
  libraryQuery,
  libraryMutation,
} from "@axiom/shared/research-api";
import { referenceDetailsSchema } from "@axiom/shared/research";
import { preferencesSchema } from "@axiom/shared/appearance";
import { updateBibtexEntry } from "@axiom/shared/bibliography";
import { parseBibtex, formatBibtex } from "@axiom/shared/bibliography";
import {
  readArchive,
  importArchive,
  rewriteLinks,
} from "@axiom/shared/archive";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = z.uuid(),
  title = z.string().trim().min(1).max(200),
  text = z.string().max(1000000);
const hash = (token: string | Uint8Array) =>
  createHash("sha256").update(token).digest("hex");
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } });
async function inviteFor(token: string) {
  const [invite] = await query(
    "SELECT i.*,g.name AS group_name FROM invitations i JOIN groups g ON g.id=i.group_id JOIN spaces s ON s.group_id=g.id AND s.kind='team' WHERE token_hash=$1 AND expires_at>now() AND accepted_at IS NULL AND revoked_at IS NULL AND axiom_space_state(s.id)='active'",
    [hash(token)],
  );
  if (!invite)
    throw new HttpError(
      410,
      "This invitation has expired or has already been used.",
    );
  return invite;
}
async function acceptInvite(token: string, userId: string, email: string) {
  return (await acceptGroupInvitation({ token }, userId, email)).groupId;
}
const metadataFields =
  "n.id,n.group_id,n.project_id,n.parent_id,n.author_id,n.title,n.visibility,n.tags,n.generation,n.version,n.created_at,n.updated_at,n.deleted_at,n.source_format";
async function handleRequest(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
  principal?: { id: string; email: string; name: string },
): Promise<Response> {
  try {
    const path = (await context.params).path,
      [resource, id, action] = path,
      url = new URL(request.url),
      method = request.method;
    if (
      !["GET", "HEAD"].includes(method) &&
      request.headers.get("origin") !== appUrl
    )
      throw new HttpError(403, "Request origin is not allowed.");
    if (Number(request.headers.get("content-length") ?? 0) > 55 * 1024 * 1024)
      throw new HttpError(413, "Upload exceeds the request limit.");
    if (resource === "health") {
      await query("SELECT 1");
      return json({ status: "ok", service: "web" });
    }
    const instance = await instanceApi(request, path);
    if (instance) return instance;
    await assertDataset(request);
    if (resource === "identity" && method === "GET")
      return json(institutionalIdentity);
    if (resource === "invitation" && method === "GET") {
      const invite = await inviteFor(url.searchParams.get("token") ?? "");
      return json({ email: invite.email, groupName: invite.group_name });
    }
    if (resource === "register" && method === "POST") {
      const input = z
        .object({
          token: z.string().min(32).max(200),
          name: z.string().trim().min(1).max(100),
          password: z.string().min(12).max(128),
        })
        .parse(await request.json());
      const invite = await inviteFor(input.token);
      const result = await auth.api.signUpEmail({
        body: {
          name: input.name,
          email: invite.email,
          password: input.password,
        },
        headers: new Headers({ "x-axiom-internal": process.env.SYNC_SECRET! }),
        asResponse: true,
      });
      if (!result.ok) return result;
      const userData = await result.clone().json();
      setAuditActor(userData.user.id);
      await acceptInvite(input.token, userData.user.id, invite.email);
      await notifyWorkspace();
      return result;
    }
    const session = principal
      ? { user: principal, session: { id: "integration" } }
      : await auth.api.getSession({ headers: request.headers });
    if (!session) throw new HttpError(401, "Please sign in.");
    const user = session.user;
    setAuditActor(user.id);
    if (!principal) {
      const integration = await integrationApi(request, path, user.id);
      if (integration) return integration;
      const offline = await offlineApi(request, path, user.id);
      if (offline) return offline;
    }
    const auditResponse = await auditApi(request, path, user.id);
    if (auditResponse) return auditResponse;
    const invitationResponse = await groupInvitationsApi(
      request,
      path,
      user.id,
      user.email,
    );
    if (invitationResponse) return invitationResponse;
    if (resource === "events" && method === "GET")
      return workspaceEvents(request, {
        userId: user.id,
        sessionId: session.session.id,
      });
    const lifecycleResponse = await spaceLifecycleApi(request, path, user.id);
    if (lifecycleResponse) return lifecycleResponse;
    const accountResponse = await accountsApi(request, path, user.id);
    if (accountResponse) return accountResponse;
    const projectResponse = await projectsApi(request, path, user.id);
    if (projectResponse) return projectResponse;
    const resourceOperationResponse = await resourceOperationsApi(
      request,
      path,
      user.id,
    );
    if (resourceOperationResponse) return resourceOperationResponse;
    const exportResponse = await workspaceExportsApi(request, path, user.id);
    if (exportResponse) return exportResponse;
    const fileWorkflowsResponse = await fileWorkflowsApi(
      request,
      path,
      user.id,
    );
    if (fileWorkflowsResponse) return fileWorkflowsResponse;
    const transferResponse = await resourceTransferApi(request, path, user.id);
    if (transferResponse) return transferResponse;
    const commentsResponse = await resourceCommentsApi(request, path, user.id);
    if (commentsResponse) return commentsResponse;
    const serviceResponse = await toolServicesApi(request, path, user.id);
    if (serviceResponse) return serviceResponse;
    const createdFile = await fileCreateApi(request, path, user.id);
    if (createdFile) return createdFile;
    const toolsResponse = await researchToolsApi(request, path, user.id);
    if (toolsResponse) return toolsResponse;
    const cardPreviewResponse = await canvasPreviewApi(request, path, user.id);
    if (cardPreviewResponse) return cardPreviewResponse;
    const previewResponse = await filePreviewApi(request, path, user.id);
    if (previewResponse) return previewResponse;
    const uploadResponse = await uploadsApi(request, path, user.id);
    if (uploadResponse) return uploadResponse;
    const trashResponse = await trashApi(request, path, user.id);
    if (trashResponse) return trashResponse;
    const administration = await groupAdministrationApi(request, path, user.id);
    if (administration) return administration;
    const workspaceResponse = await workspaceApi(request, path, user.id);
    if (workspaceResponse) return workspaceResponse;
    if (resource === "me" && id === "preferences")
      return await preferencesApi(request, user.id);
    if (resource === "me" && id === "editor-preferences")
      return await editorPreferencesApi(request, user.id);
    if (resource === "me" && id === "preferences-bundle")
      return await preferencesBundleApi(request, user.id);
    const research = await researchApi(request, path, user.id);
    if (research) return research;
    if (resource === "me" && !id && method === "GET")
      return json({
        user,
        emailAvailable: !!process.env.SMTP_URL,
        groups: await query(
          "SELECT g.*,m.role FROM groups g JOIN members m ON m.group_id=g.id WHERE m.user_id=$1 ORDER BY g.created_at",
          [user.id],
        ),
      });
    if (resource === "invitation" && method === "POST") {
      const { token } = z
        .object({ token: z.string() })
        .parse(await request.json());
      const groupId = await acceptInvite(token, user.id, user.email);
      await notifyWorkspace(true);
      return json({ groupId });
    }
    if (resource === "groups" && method === "POST") {
      const input = z
        .object({
          name: title,
          description: z.string().max(2000).default(""),
          mutationId: uuid.default(() => randomUUID()),
        })
        .parse(await request.json());
      const group = await workspaceMutation(
        user.id,
        input.mutationId,
        "create-group",
        input,
        async (client) => {
          const {
            rows: [group],
          } = await client.query(
            "INSERT INTO groups(name,description) VALUES($1,$2) RETURNING *",
            [input.name, input.description],
          );
          await client.query(
            "INSERT INTO members(group_id,user_id,role) VALUES($1,$2,'owner')",
            [group.id, user.id],
          );
          return group;
        },
      );
      await notifyWorkspace(true);
      return json(group, 201);
    }
    if (resource === "workspace" && method === "GET") {
      const groupId = uuid.parse(url.searchParams.get("groupId"));
      await memberAccess(user.id, groupId);
      const [projects, notes, references, members, notifications, links] =
        await Promise.all([
          query(
            "SELECT p.* FROM projects p JOIN spaces s ON s.project_id=p.id WHERE p.group_id=$1 AND axiom_space_role($2,s.id) IS NOT NULL ORDER BY p.created_at",
            [groupId, user.id],
          ),
          query(
            `SELECT ${metadataFields},EXISTS(SELECT 1 FROM favorites f WHERE f.note_id=n.id AND f.user_id=$2) AS favorite FROM notes n WHERE n.group_id=$1 AND axiom_can_read_note($2,n.id) AND (n.deleted_at IS NULL OR n.deleted_at>now()-interval '30 days') ORDER BY n.updated_at DESC`,
            [groupId, user.id],
          ),
          referenceLibrary(user.id, groupId),
          query(
            'SELECT u.id,u.name,u.email,u.image,m.role FROM members m JOIN "user" u ON u.id=m.user_id WHERE m.group_id=$1 ORDER BY u.name',
            [groupId],
          ),
          query(
            "SELECT f.* FROM notifications f JOIN notes n ON n.id=f.note_id WHERE f.user_id=$1 AND n.group_id=$2 AND axiom_can_read_note($1,n.id) AND n.deleted_at IS NULL ORDER BY f.created_at DESC LIMIT 50",
            [user.id, groupId],
          ),
          query(
            "SELECT l.source_id,l.target_id,l.target FROM note_links l JOIN notes n ON n.id=l.source_id JOIN notes t ON t.id=l.target_id WHERE n.group_id=$1 AND t.group_id=$1 AND axiom_can_read_note($2,n.id) AND axiom_can_read_note($2,t.id) AND n.deleted_at IS NULL AND t.deleted_at IS NULL",
            [groupId, user.id],
          ),
        ]);
      return json({
        projects,
        notes,
        references,
        members,
        notifications,
        links,
      });
    }
    if (resource === "search" && method === "GET") {
      const groupId = uuid.parse(url.searchParams.get("groupId"));
      await memberAccess(user.id, groupId);
      const q = (url.searchParams.get("q") ?? "").slice(0, 200);
      return json(
        await query(
          `SELECT ${metadataFields},left(n.plain_text,220) AS excerpt FROM notes n WHERE n.group_id=$1 AND axiom_can_read_note($2,n.id) AND n.deleted_at IS NULL AND (to_tsvector('simple',n.title||' '||n.plain_text) @@ plainto_tsquery('simple',$3) OR lower(n.title) % lower($3) OR n.title ILIKE '%'||$3||'%' OR n.plain_text ILIKE '%'||$3||'%' OR array_to_string(n.tags,' ') ILIKE '%'||$3||'%') ORDER BY n.updated_at DESC LIMIT 50`,
          [groupId, user.id, q],
        ),
      );
    }
    if (resource === "projects" && method === "POST") {
      const input = z
        .object({
          groupId: uuid,
          name: title,
          description: z.string().max(2000).default(""),
          color: z.enum(["blue", "green", "purple", "orange"]).default("blue"),
        })
        .parse(await request.json());
      await memberAccess(user.id, input.groupId);
      return json(
        (
          await query(
            "INSERT INTO projects(group_id,name,description,color,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *",
            [
              input.groupId,
              input.name,
              input.description,
              input.color,
              user.id,
            ],
          )
        )[0],
        201,
      );
    }
    if (resource === "members") {
      const groupId = uuid.parse(url.searchParams.get("groupId"));
      const manager = await memberAccess(user.id, groupId, true);
      if (method === "DELETE" || method === "PATCH") {
        const [target] = await query(
          "SELECT role FROM members WHERE group_id=$1 AND user_id=$2",
          [groupId, id],
        );
        if (!target || target.role === "owner" || id === user.id)
          throw new HttpError(
            400,
            "The group owner and your own membership cannot be changed here.",
          );
        if (method === "DELETE")
          await query("DELETE FROM members WHERE group_id=$1 AND user_id=$2", [
            groupId,
            id,
          ]);
        else {
          if (manager.role !== "owner")
            throw new HttpError(
              403,
              "Only the group owner can assign administrators.",
            );
          const { role } = z
            .object({ role: z.enum(["admin", "member"]) })
            .parse(await request.json());
          await query(
            "UPDATE members SET role=$1 WHERE group_id=$2 AND user_id=$3",
            [role, groupId, id],
          );
        }
        await notifyWorkspace(true);
        return json({ ok: true });
      }
    }
    if (resource === "invitations" && method === "POST") {
      const input = z
        .object({
          groupId: uuid,
          email: z.email(),
          role: z.enum(["admin", "member"]).default("member"),
          contentRole: z
            .enum(["viewer", "commenter", "editor"])
            .default("editor"),
        })
        .parse(await request.json());
      const manager = await memberAccess(user.id, input.groupId, true);
      if (input.role === "admin" && manager.role !== "owner")
        throw new HttpError(403, "Only the owner can invite administrators.");
      const token = randomBytes(32).toString("hex");
      const [invite] = await transaction(async (client) => {
        await client.query(
          "SELECT id FROM groups WHERE id=$1 FOR NO KEY UPDATE",
          [input.groupId],
        );
        await assertGroupActive(client, input.groupId);
        const {
          rows: [current],
        } = await client.query(
          "SELECT role FROM members WHERE group_id=$1 AND user_id=$2",
          [input.groupId, user.id],
        );
        if (
          !current ||
          current.role === "member" ||
          (input.role === "admin" && current.role !== "owner")
        )
          throw new HttpError(
            403,
            "Invitation authority changed. Refresh and try again.",
          );
        const {
          rows: [space],
        } = await client.query(
          "SELECT id FROM spaces WHERE group_id=$1 AND kind='team'",
          [input.groupId],
        );
        await recordActivity(client, {
          userId: user.id,
          spaceId: space.id,
          kind: "invitation",
          title: `Created invitation for ${input.email.toLowerCase()}`,
        });
        return (
          await client.query(
            "INSERT INTO invitations(group_id,email,role,token_hash,invited_by,expires_at,content_role) VALUES($1,$2,$3,$4,$5,now()+interval '7 days',$6) RETURNING id",
            [
              input.groupId,
              input.email.toLowerCase(),
              input.role,
              hash(token),
              user.id,
              input.contentRole,
            ],
          )
        ).rows;
      });
      const link = `${appUrl}/?invite=${token}`;
      let emailed = false;
      try {
        emailed = await sendMail(
          input.email,
          "You are invited to Axiom",
          `${user.name} invited you to collaborate in Axiom.\n\nAccept your invitation: ${link}\n\nThis invitation expires in seven days.`,
        );
      } catch (error) {
        console.error(
          "Invitation email failed:",
          error instanceof Error ? error.message : "Delivery error",
        );
      }
      return json({ id: invite.id, link, emailed }, 201);
    }
    if (resource === "notes" && !id && method === "POST") {
      const input = z
        .object({
          groupId: uuid,
          projectId: uuid.nullable().optional(),
          parentId: uuid.nullable().optional(),
          title: title.default("Untitled"),
          visibility: z.enum(["shared", "private"]).default("shared"),
          body: text.default(""),
          tags: z.array(z.string().max(40)).max(20).default([]),
        })
        .parse(await request.json());
      await memberAccess(user.id, input.groupId);
      if (
        input.projectId &&
        !(
          await query("SELECT id FROM projects WHERE id=$1 AND group_id=$2", [
            input.projectId,
            input.groupId,
          ])
        ).length
      )
        throw new HttpError(400, "Project not found in this group.");
      if (input.visibility === "shared") {
        if (input.projectId)
          await projectAccess(user.id, input.projectId, "edit");
        else {
          const [scope] = await query(
            "SELECT id FROM spaces WHERE kind='team' AND group_id=$1",
            [input.groupId],
          );
          await spaceAccess(user.id, scope.id, "edit");
        }
      }
      if (input.parentId) {
        const parent = await noteAccess(user.id, input.parentId);
        if (
          parent.group_id !== input.groupId ||
          parent.visibility !== input.visibility ||
          parent.project_id !== (input.projectId ?? null)
        )
          throw new HttpError(
            400,
            "Nested notes must share the parent’s group, project, and visibility.",
          );
      }
      const note = await createNote({ ...input, userId: user.id });
      await indexNote(`${note.id}:1`, input.body);
      await notifyWorkspace();
      return json(note, 201);
    }
    if (resource === "notes" && id) {
      uuid.parse(id);
      const note = await noteAccess(
        user.id,
        id,
        action === "restore-trash" || method === "DELETE",
      );
      if (method !== "GET" && !["sync-token", "favorite"].includes(action))
        requireNoteCapability(note, action === "comments" ? "comment" : "edit");
      if (!action && method === "GET") return json(note);
      if (!action && method === "PATCH") {
        const input = z
          .object({
            title: title.optional(),
            projectId: uuid.nullable().optional(),
            parentId: uuid.nullable().optional(),
            tags: z.array(z.string().max(40)).max(20).optional(),
            visibility: z.enum(["shared", "private"]).optional(),
            version: z.number().int(),
          })
          .parse(await request.json());
        if (input.visibility && input.visibility !== note.visibility) {
          if (note.author_id !== user.id)
            throw new HttpError(
              403,
              "Only the author can publish a private draft.",
            );
          if (input.visibility === "private")
            throw new HttpError(
              400,
              "Copy this shared note into a private draft instead.",
            );
          if (
            note.parent_id ||
            (
              await query(
                "SELECT id FROM notes WHERE parent_id=$1 AND deleted_at IS NULL",
                [id],
              )
            ).length
          )
            throw new HttpError(
              400,
              "Move this note out of its hierarchy before publishing.",
            );
        }
        const projectId =
          input.projectId === undefined ? note.project_id : input.projectId;
        let destinationId = note.space_id;
        if ((input.visibility ?? note.visibility) === "shared") {
          if (projectId)
            destinationId = (await projectAccess(user.id, projectId, "edit"))
              .space.id;
          else {
            const [scope] = await query(
              "SELECT id FROM spaces WHERE kind='team' AND group_id=$1",
              [note.group_id],
            );
            if (!scope)
              throw new HttpError(400, "Choose a destination team or project.");
            await spaceAccess(user.id, scope.id, "edit");
            destinationId = scope.id;
          }
        }
        if (
          projectId &&
          !(
            await query("SELECT id FROM projects WHERE id=$1 AND group_id=$2", [
              projectId,
              note.group_id,
            ])
          ).length
        )
          throw new HttpError(400, "Project not found.");
        const parentId =
          input.parentId === undefined ? note.parent_id : input.parentId;
        if (parentId) {
          const parent = await noteAccess(user.id, parentId);
          const cycle = await query(
            "WITH RECURSIVE descendants AS (SELECT id FROM notes WHERE id=$1 UNION ALL SELECT n.id FROM notes n JOIN descendants d ON n.parent_id=d.id) SELECT id FROM descendants WHERE id=$2",
            [id, parentId],
          );
          if (
            cycle.length ||
            parent.group_id !== note.group_id ||
            parent.visibility !== (input.visibility ?? note.visibility) ||
            parent.project_id !== projectId
          )
            throw new HttpError(
              400,
              "That move would create an invalid note hierarchy.",
            );
        }
        if (
          projectId !== note.project_id &&
          (
            await query(
              "SELECT id FROM notes WHERE parent_id=$1 AND deleted_at IS NULL",
              [id],
            )
          ).length
        )
          throw new HttpError(400, "Move child notes first.");
        const [updated] = await noteWriteQuery(
          user.id,
          id,
          "UPDATE notes SET title=$1,tags=$2,project_id=$3,parent_id=$4,visibility=$5,version=version+1,updated_at=now() WHERE id=$6 AND version=$7 RETURNING *",
          [
            input.title ?? note.title,
            input.tags ?? note.tags,
            projectId,
            parentId,
            input.visibility ?? note.visibility,
            id,
            input.version,
          ],
          "edit",
          destinationId,
        );
        if (!updated)
          throw new HttpError(
            409,
            "This note changed elsewhere. Refresh and try again.",
          );
        await notifyWorkspace(input.visibility !== undefined);
        return json(updated);
      }
      if (!action && method === "DELETE") {
        if (
          (
            await query(
              "SELECT id FROM notes WHERE parent_id=$1 AND deleted_at IS NULL",
              [id],
            )
          ).length
        )
          throw new HttpError(400, "Move or trash the child notes first.");
        await noteWriteQuery(
          user.id,
          id,
          "UPDATE notes SET deleted_at=now(),version=version+1 WHERE id=$1",
          [id],
        );
        await notifyWorkspace(true);
        return json({ ok: true });
      }
      if (action === "restore-trash" && method === "POST") {
        await noteWriteQuery(
          user.id,
          id,
          "UPDATE notes SET deleted_at=NULL,parent_id=NULL,version=version+1 WHERE id=$1",
          [id],
        );
        await notifyWorkspace();
        return json({ ok: true });
      }
      if (action === "sync-token" && method === "POST") {
        const accessEpoch = await spaceAccessEpoch(note.space_id!);
        // Older tabs cannot quarantine an offline cache after an archive/trash
        // cycle. They may keep reading, but must load the recovery-aware client
        // before obtaining a new synchronization credential for that scope.
        const input = await request.json().catch(() => null);
        if (!accessEpoch.endsWith(":0") && input?.accessProtocol !== 1)
          throw new HttpError(
            426,
            "Workspace access changed. Download any unsaved text, then reload Axiom before reconnecting.",
          );
        return json({
          token: signSyncToken(
            user.id,
            session.session.id,
            `${id}:${note.generation}`,
            accessEpoch,
          ),
          room: `${id}:${note.generation}`,
          user: { id: user.id, name: user.name },
          readOnly: note.role !== "editor",
          accessEpoch,
        });
      }
      if (action === "favorite" && method === "POST") {
        const { favorite } = z
          .object({ favorite: z.boolean() })
          .parse(await request.json());
        if (favorite)
          await query(
            "INSERT INTO favorites(user_id,note_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
            [user.id, id],
          );
        else
          await query("DELETE FROM favorites WHERE user_id=$1 AND note_id=$2", [
            user.id,
            id,
          ]);
        return json({ favorite });
      }
      if (action === "comments" && method === "GET")
        return json(
          await query(
            'SELECT c.*,u.name AS author_name FROM comments c JOIN "user" u ON u.id=c.author_id WHERE c.note_id=$1 ORDER BY c.created_at',
            [id],
          ),
        );
      if (action === "comments" && method === "POST") {
        const input = z
          .object({
            body: z.string().trim().min(1).max(10000),
            parentId: uuid.nullable().default(null),
            anchor: z
              .object({
                start: z.array(z.number().int().min(0).max(255)).max(1000),
                end: z.array(z.number().int().min(0).max(255)).max(1000),
                quote: z.string().max(2000),
                generation: z.number().int(),
              })
              .nullable()
              .default(null),
          })
          .parse(await request.json());
        if (
          input.parentId &&
          !(
            await query(
              "SELECT id FROM comments WHERE id=$1 AND note_id=$2 AND parent_id IS NULL",
              [input.parentId, id],
            )
          ).length
        )
          throw new HttpError(400, "Comment thread not found.");
        const [comment] = await noteWriteQuery(
          user.id,
          id,
          "INSERT INTO comments(note_id,author_id,parent_id,body,anchor) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [id, user.id, input.parentId, input.body, input.anchor],
          "comment",
        );
        const recipients = await query(
          "SELECT DISTINCT c.author_id AS id FROM comments c WHERE c.note_id=$1 AND c.author_id<>$2 UNION SELECT author_id AS id FROM notes WHERE id=$1 AND author_id<>$2",
          [id, user.id],
        );
        for (const recipient of recipients)
          await query(
            "INSERT INTO notifications(user_id,note_id,message) VALUES($1,$2,$3)",
            [recipient.id, id, `${user.name} commented on ${note.title}`],
          );
        await notifyWorkspace();
        return json(comment, 201);
      }
      if (action === "history" && method === "GET")
        return json(
          await query(
            'SELECT s.id,s.title,s.label,s.generation,s.created_at,u.name AS author_name FROM snapshots s LEFT JOIN "user" u ON u.id=s.author_id WHERE note_id=$1 ORDER BY created_at DESC LIMIT 200',
            [id],
          ),
        );
      if (action === "history" && method === "POST") {
        const { label } = z
          .object({ label: z.string().trim().min(1).max(100) })
          .parse(await request.json());
        await flushNote(note);
        const [snapshot] = await noteWriteQuery(
          user.id,
          id,
          "INSERT INTO snapshots(note_id,title,body,state,generation,label,author_id) SELECT n.id,n.title,n.body,d.state,n.generation,$1,$2 FROM notes n JOIN documents d ON d.room=n.id::text||':'||n.generation::text WHERE n.id=$3 RETURNING id",
          [label, user.id, id],
        );
        return json(snapshot, 201);
      }
      if (action === "restore-version" && method === "POST") {
        const { snapshotId } = z
          .object({ snapshotId: uuid })
          .parse(await request.json());
        await flushNote(note);
        const updated = await transaction(async (client) => {
          await requireNoteScope(client, user.id, id);
          const {
            rows: [current],
          } = await client.query("SELECT * FROM notes WHERE id=$1 FOR UPDATE", [
            id,
          ]);
          const {
            rows: [snapshot],
          } = await client.query(
            "SELECT * FROM snapshots WHERE id=$1 AND note_id=$2",
            [snapshotId, id],
          );
          if (!snapshot) throw new HttpError(404, "Version not found.");
          await client.query(
            "INSERT INTO snapshots(note_id,title,body,state,generation,label,author_id) SELECT n.id,n.title,n.body,d.state,n.generation,'Before restore',$1 FROM notes n JOIN documents d ON d.room=n.id::text||':'||n.generation::text WHERE n.id=$2",
            [user.id, id],
          );
          const generation = current.generation + 1,
            doc = new Y.Doc();
          initializeDocument(
            doc,
            snapshot.body,
            snapshot.source_format ?? note.source_format,
          );
          const state = Buffer.from(Y.encodeStateAsUpdate(doc));
          doc.destroy();
          await client.query(
            "INSERT INTO documents(room,note_id,state) VALUES($1,$2,$3)",
            [`${id}:${generation}`, id, state],
          );
          const {
            rows: [row],
          } = await client.query(
            "UPDATE notes SET body=$1,title=$2,generation=$3,version=version+1,updated_at=now() WHERE id=$4 RETURNING *",
            [snapshot.body, snapshot.title, generation, id],
          );
          return row;
        });
        await indexNote(`${id}:${updated.generation}`, updated.body);
        await notifyWorkspace(true);
        return json(updated);
      }
      if (action === "attachments" && method === "GET")
        return json(
          await query(
            "SELECT id,name,mime,bytes,sha256,created_at FROM attachments WHERE note_id=$1 ORDER BY created_at DESC",
            [id],
          ),
        );
      if (action === "attachments" && method === "POST") {
        const form = await request.formData(),
          file = form.get("file");
        if (!(file instanceof File)) throw new HttpError(400, "Choose a file.");
        const maximum = Number(process.env.MAX_UPLOAD_MB ?? 50) * 1024 * 1024;
        if (file.size > maximum)
          throw new HttpError(
            413,
            `Files must be smaller than ${maximum / 1048576} MB.`,
          );
        const data = new Uint8Array(await file.arrayBuffer()),
          prefix = Buffer.from(data.subarray(0, 12));
        const mime =
          prefix.subarray(0, 5).toString() === "%PDF-"
            ? "application/pdf"
            : prefix
                  .subarray(0, 8)
                  .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
              ? "image/png"
              : prefix[0] === 255 && prefix[1] === 216
                ? "image/jpeg"
                : prefix.subarray(0, 3).toString() === "GIF"
                  ? "image/gif"
                  : prefix.subarray(0, 4).toString() === "RIFF" &&
                      prefix.subarray(8, 12).toString() === "WEBP"
                    ? "image/webp"
                    : "application/octet-stream";
        const key = randomUUID();
        await putAttachment(key, data, mime);
        const [attachment] = await query(
          "INSERT INTO attachments(note_id,name,mime,bytes,storage_key,sha256) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,mime,bytes",
          [
            id,
            file.name.replace(/[\r\n/\\]/g, "_").slice(0, 200),
            mime,
            file.size,
            key,
            hash(data),
          ],
        );
        return json(attachment, 201);
      }
      if (action === "export" && method === "GET") {
        await flushNote(note);
        const fresh = await noteAccess(user.id, id);
        const format = url.searchParams.get("format") ?? "md";
        if (fresh.source_format && fresh.source_format !== "markdown") {
          if (format === "html")
            throw new HttpError(
              400,
              "Use this project's studio export. This document is not Markdown.",
            );
          const extension = documentExtension(fresh.source_format),
            filename = fresh.title.toLowerCase().endsWith(`.${extension}`)
              ? fresh.title
              : `${fresh.title}.${extension}`;
          return new Response(fresh.body, {
            headers: {
              "content-type":
                fresh.source_format === "canvas"
                  ? "application/json; charset=utf-8"
                  : "text/plain; charset=utf-8",
              "content-disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
              "cache-control": "no-store",
            },
          });
        }
        if (format === "html") {
          const references = Object.fromEntries(
            (
              await query("SELECT * FROM bibliography WHERE group_id=$1", [
                note.group_id,
              ])
            ).map((r) => [r.cite_key, r]),
          );
          const targets = await query(
            "SELECT id,title FROM notes WHERE group_id=$1 AND deleted_at IS NULL AND axiom_can_read_note($2,id)",
            [note.group_id, user.id],
          );
          return new Response(
            await htmlExport(
              fresh.body,
              fresh.title,
              {
                references,
                resolveLink: (target) => {
                  const [name, heading] = target.split("#");
                  const linked = targets.find(
                    (n) =>
                      n.id === name ||
                      n.title.toLowerCase() === name.toLowerCase(),
                  );
                  return linked
                    ? {
                        href: `${appUrl}/?note=${linked.id}${heading ? "#" + encodeURIComponent(heading) : ""}`,
                        title: linked.title,
                      }
                    : undefined;
                },
              },
              async (attachmentId) => {
                const [file] = await query(
                  "SELECT * FROM attachments WHERE id=$1",
                  [attachmentId],
                );
                if (!file) return undefined;
                try {
                  await fileAccess(user.id, file.id);
                } catch (error) {
                  if (
                    error instanceof HttpError &&
                    [403, 404].includes(error.status)
                  )
                    return undefined;
                  throw error;
                }
                const data = await getAttachment(file.storage_key);
                return { mime: attachmentMime(data), data };
              },
              url.searchParams.get("appearance") === "reading"
                ? preferencesSchema.parse(
                    (
                      await query(
                        "SELECT preferences FROM user_preferences WHERE user_id=$1",
                        [user.id],
                      )
                    )[0]?.preferences ?? {},
                  )
                : undefined,
            ),
            {
              headers: {
                "content-type": "text/html; charset=utf-8",
                "content-disposition": 'attachment; filename="note.html"',
                "cache-control": "no-store",
                "content-security-policy":
                  "sandbox; default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data: https:",
              },
            },
          );
        }
        return new Response(fresh.body, {
          headers: {
            "content-type": "text/markdown; charset=utf-8",
            "content-disposition": `attachment; filename="${encodeURIComponent(note.title)}.md"`,
            "cache-control": "no-store",
          },
        });
      }
    }
    if (resource === "comments" && id && method === "PATCH") {
      const [comment] = await query("SELECT * FROM comments WHERE id=$1", [
        uuid.parse(id),
      ]);
      if (!comment) throw new HttpError(404, "Comment not found.");
      requireNoteCapability(
        await noteAccess(user.id, comment.note_id),
        "comment",
      );
      const { resolved } = z
        .object({ resolved: z.boolean() })
        .parse(await request.json());
      await noteWriteQuery(
        user.id,
        comment.note_id,
        "UPDATE comments SET resolved=$1 WHERE id=$2",
        [resolved, id],
        "comment",
      );
      await notifyWorkspace();
      return json({ ok: true });
    }
    if (resource === "notifications" && method === "POST") {
      await query("UPDATE notifications SET read_at=now() WHERE user_id=$1", [
        user.id,
      ]);
      return json({ ok: true });
    }
    if (
      resource === "attachments" &&
      id &&
      !action &&
      ["GET", "HEAD"].includes(method)
    ) {
      const [attachment] = await query(
        "SELECT * FROM attachments WHERE id=$1",
        [uuid.parse(id)],
      );
      if (!attachment) throw new HttpError(404, "Attachment not found.");
      await fileAccess(user.id, attachment.id);
      return fileResponse(
        request,
        attachment as Parameters<typeof fileResponse>[1],
      );
    }
    if (resource === "references") {
      if (method === "POST") {
        const input = referenceDetailsSchema
          .extend({
            groupId: uuid,
            citeKey: z
              .string()
              .regex(/^[\w:./-]+$/)
              .max(100),
          })
          .parse(await request.json());
        await requireLibraryEditor(user.id, input.groupId);
        return json(
          (
            await libraryQuery(
              user.id,
              input.groupId,
              "INSERT INTO bibliography(group_id,cite_key,title,authors,year,url,doi,arxiv,venue,bibtex) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
              [
                input.groupId,
                input.citeKey,
                input.title,
                input.authors,
                input.year,
                input.url,
                input.doi.trim().toLowerCase(),
                input.arxiv.trim(),
                input.venue,
                updateBibtexEntry("", input.citeKey, {
                  title: input.title,
                  author: input.authors,
                  year: input.year,
                  url: input.url,
                  doi: input.doi,
                  eprint: input.arxiv,
                  journal: input.venue,
                }),
              ],
            )
          )[0],
          201,
        );
      }
      const groupId = uuid.parse(url.searchParams.get("groupId"));
      await memberAccess(user.id, groupId);
      if (method === "GET") {
        const refs = await referenceLibrary(user.id, groupId);
        if (url.searchParams.get("format") === "bib")
          return new Response(
            refs.map((r) => formatBibtex(r as any)).join("\n\n"),
            {
              headers: {
                "content-type": "application/x-bibtex",
                "content-disposition": 'attachment; filename="references.bib"',
              },
            },
          );
        return json(refs);
      }
      if (method === "PUT") {
        await requireLibraryEditor(user.id, groupId);
        const { bibtex } = z
          .object({ bibtex: z.string().max(2000000) })
          .parse(await request.json());
        const refs = parseBibtex(bibtex);
        if (!refs.length)
          throw new HttpError(400, "No valid BibTeX entries found.");
        const added = await libraryMutation(
          user.id,
          groupId,
          async (client) => {
            let count = 0;
            for (const r of refs) {
              if (!/^[\w:./-]{1,100}$/.test(r.citeKey)) continue;
              const { rows } = await client.query(
                "INSERT INTO bibliography(group_id,cite_key,title,authors,year,url,bibtex) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id",
                [
                  groupId,
                  r.citeKey,
                  r.title,
                  r.authors,
                  r.year,
                  r.url,
                  r.bibtex,
                ],
              );
              count += rows.length;
            }
            return count;
          },
        );
        return json({ added, skipped: refs.length - added });
      }
      if (method === "DELETE" && id) {
        await requireLibraryEditor(user.id, groupId);
        await libraryQuery(
          user.id,
          groupId,
          "DELETE FROM bibliography WHERE id=$1 AND group_id=$2",
          [uuid.parse(id), groupId],
        );
        return json({ ok: true });
      }
    }
    if (resource === "export" && method === "GET") {
      const groupId = uuid.parse(url.searchParams.get("groupId"));
      await memberAccess(user.id, groupId);
      const initial = await query<Note>(
        "SELECT * FROM notes WHERE group_id=$1 AND visibility='shared' AND deleted_at IS NULL AND axiom_can_read_note($2,id)",
        [groupId, user.id],
      );
      if (
        initial.some(
          (note) => note.source_format && note.source_format !== "markdown",
        )
      )
        throw new HttpError(
          409,
          "This group contains native studio documents. Export from Workspace management to preserve their formats; the legacy notebook archive supports Markdown only.",
        );
      for (const n of initial) await flushNote(n);
      const notes = await query<Note>(
        "SELECT * FROM notes WHERE group_id=$1 AND visibility='shared' AND deleted_at IS NULL AND axiom_can_read_note($2,id)",
        [groupId, user.id],
      );
      const files = await query(
        "SELECT a.* FROM attachments a JOIN notes n ON n.id=a.note_id WHERE n.group_id=$1 AND n.visibility='shared' AND n.deleted_at IS NULL AND axiom_can_read_attachment($2,a.id)",
        [groupId, user.id],
      );
      const zip = new JSZip();
      const fileNames = new Map(
        files.map((f) => [
          f.id,
          `attachments/${f.id}-${f.name.replace(/[^\w.-]/g, "_")}`,
        ]),
      );
      for (const note of notes) {
        const body = rewriteLinks(note.body, (node) => {
          const [target, fragment] = (node.href ?? "").split("#");
          if (node.type === "wikiLink") {
            const candidates = notes.filter(
              (n) =>
                n.id === target ||
                n.title.toLowerCase() === target.toLowerCase(),
            );
            if (candidates.length === 1)
              return (
                candidates[0].id + ".md" + (fragment ? "#" + fragment : "")
              );
          }
          const attachment = /^\/api\/v1\/attachments\/([a-f0-9-]+)$/.exec(
            target,
          );
          if (attachment && fileNames.has(attachment[1]))
            return (
              "../" +
              fileNames.get(attachment[1]) +
              (fragment ? "#" + fragment : "")
            );
        });
        zip.file(`notes/${note.id}.md`, body);
      }
      for (const file of files)
        zip.file(
          fileNames.get(file.id)!,
          await getAttachment(file.storage_key),
        );
      zip.file(
        "manifest.json",
        JSON.stringify(
          {
            format: "axiom-notebook",
            version: 1,
            projects: await query(
              "SELECT p.id,p.name,p.description,p.color FROM projects p JOIN spaces s ON s.project_id=p.id WHERE p.group_id=$1 AND axiom_space_role($2,s.id) IS NOT NULL",
              [groupId, user.id],
            ),
            attachments: files.map((f) => ({
              file: fileNames.get(f.id),
              noteId: f.note_id,
              name: f.name,
              sha256: f.sha256,
            })),
            notes: notes.map((n) => ({
              id: n.id,
              title: n.title,
              parentId: n.parent_id,
              projectId: n.project_id,
              tags: n.tags,
              file: `notes/${n.id}.md`,
            })),
          },
          null,
          2,
        ),
      );
      zip.file(
        "references.bib",
        (await query("SELECT * FROM bibliography WHERE group_id=$1", [groupId]))
          .map((r) => formatBibtex(r as any))
          .join("\n\n"),
      );
      return new Response(
        new Uint8Array(
          await zip.generateAsync({
            type: "nodebuffer",
            compression: "DEFLATE",
          }),
        ),
        {
          headers: {
            "content-type": "application/zip",
            "content-disposition": 'attachment; filename="axiom-notebook.zip"',
            "cache-control": "no-store",
          },
        },
      );
    }
    if (resource === "import" && method === "POST") {
      const groupId = uuid.parse(url.searchParams.get("groupId"));
      await memberAccess(user.id, groupId);
      const [scope] = await query(
        "SELECT id FROM spaces WHERE kind='team' AND group_id=$1",
        [groupId],
      );
      await spaceAccess(user.id, scope.id, "edit");
      const form = await request.formData(),
        file = form.get("file");
      if (!(file instanceof File) || file.size > 50 * 1048576)
        throw new HttpError(
          400,
          "Choose a Markdown file or a ZIP smaller than 50 MB.",
        );
      const plan = await readArchive(
        file.name,
        new Uint8Array(await file.arrayBuffer()),
      );
      if (url.searchParams.get("preview") === "true")
        return json({
          notes: plan.notes.map((n) => ({
            title: n.title,
            characters: n.body.length,
          })),
          attachments: plan.attachments.length,
          references: plan.references.length,
          warning: `Imports ${plan.notes.length} new shared notes, ${plan.attachments.length} attachments, and ${plan.references.length} references. Hierarchy and project metadata are preserved. Existing notes are not overwritten. Conflicting citation keys are renamed. ${plan.warnings.join(" ")}`,
        });
      const created = await importArchive(plan, groupId, user.id);
      for (const note of created) await indexNote(`${note.id}:1`, note.body);
      await notifyWorkspace();
      return json({ imported: created.length, notes: created }, 201);
    }
    throw new HttpError(404, "Endpoint not found.");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      ["40P01", "40001"].includes(String(error.code))
    )
      return json(
        {
          error:
            "Another change overlapped this operation. Nothing from this attempt was applied. Refresh and retry with your draft.",
        },
        409,
      );
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23514"
    )
      return json(
        {
          error:
            "That change would create an invalid note hierarchy. Refresh and try again.",
        },
        400,
      );
    if (error instanceof HttpError)
      return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError)
      return json(
        {
          error: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
          fieldErrors: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
      );
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505"
    )
      return json({ error: "That entry already exists." }, 409);
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "22P02"
    )
      return json({ error: "Invalid identifier." }, 400);
    console.error(
      "API request failed:",
      error instanceof Error ? error.message : error,
    );
    return json(
      { error: "The operation could not be completed. Please try again." },
      500,
    );
  }
}
export function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  return withAuditContext({}, () => handleRequest(request, context));
}

/** Server-only principal handoff. Callers must validate their own authentication;
 * it is not selected by any HTTP header, URL, cookie, or request body. */
export function handleAuthorized(
  request: Request,
  path: string[],
  principal: { id: string; email: string; name: string },
) {
  return handleRequest(
    request,
    { params: Promise.resolve({ path }) },
    principal,
  );
}

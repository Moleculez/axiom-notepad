import { createHmac, timingSafeEqual } from "node:crypto";
import { query } from "./db";
import type pg from "pg";
import {
  roleAllows,
  spaceLifecycleActions,
  type Capability,
  type ContentRole,
  type Resource,
  type Space,
} from "./workspace";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export interface Note {
  source_format?: import("./document-format").DocumentFormat;
  id: string;
  group_id: string;
  project_id: string | null;
  parent_id: string | null;
  author_id: string;
  title: string;
  visibility: "private" | "shared";
  tags: string[];
  body: string;
  generation: number;
  version: number;
  deleted_at: string | null;
  updated_at: string;
  created_at: string;
  favorite?: boolean;
  space_id?: string;
  role?: ContentRole;
}
export async function memberAccess(
  userId: string,
  groupId: string,
  manage = false,
  allowInactive = false,
) {
  const [member] = await query<{
    role: string;
    content_role: ContentRole;
    effective_status: Space["effective_status"];
  }>(
    "SELECT m.role,CASE WHEN g.lifecycle_status='archived' THEN 'viewer' ELSE m.content_role END AS content_role,g.lifecycle_status AS effective_status FROM members m JOIN groups g ON g.id=m.group_id WHERE m.user_id=$1 AND m.group_id=$2",
    [userId, groupId],
  );
  if (!member || (manage && member.role === "member"))
    throw new HttpError(403, "You do not have access to this group.");
  if (
    !allowInactive &&
    ["trashed", "purging"].includes(member.effective_status)
  )
    throw new HttpError(
      404,
      "This workspace is in trash and its content is unavailable.",
    );
  return member;
}
export async function noteAccess(
  userId: string,
  noteId: string,
  allowTrash = false,
): Promise<Note> {
  const [note] = await query<Note>(
    "SELECT n.*,r.space_id,axiom_space_role($1,r.space_id) AS role FROM notes n JOIN resources r ON r.note_id=n.id WHERE n.id=$2 AND axiom_space_role($1,r.space_id) IS NOT NULL",
    [userId, noteId],
  );
  if (!note || (note.deleted_at && !allowTrash))
    throw new HttpError(404, "This note is unavailable.");
  return note;
}
export const visibleNotes = "n.group_id=$1 AND axiom_can_read_note($2,n.id)";
export function requireNoteCapability(note: Note, action: "comment" | "edit") {
  if (!roleAllows(note.role, action))
    throw new HttpError(
      403,
      `Your access does not allow you to ${action} this note.`,
    );
}
export async function spaceAccess(
  userId: string,
  spaceId: string,
  action: Capability = "read",
  allowInactive = false,
): Promise<Space> {
  const [space] = await query<Space>(
    `SELECT s.*,g.name AS group_name,p.audience,axiom_space_state(s.id) AS effective_status,g.lifecycle_status AS parent_status,m.role AS group_role,axiom_space_role($1,s.id) AS role,axiom_manage_space($1,s.id) AS can_manage FROM spaces s LEFT JOIN groups g ON g.id=s.group_id LEFT JOIN projects p ON p.id=s.project_id LEFT JOIN members m ON m.group_id=s.group_id AND m.user_id=$1 WHERE s.id=$2`,
    [userId, spaceId],
  );
  if (
    !space ||
    (action === "manage" ? !space.can_manage : !roleAllows(space.role, action))
  )
    throw new HttpError(
      404,
      "This space is unavailable or your access does not allow this action.",
    );
  if (
    action !== "read" &&
    !allowInactive &&
    space.effective_status !== "active"
  )
    throw new HttpError(
      409,
      "This workspace is read-only or in trash. Restore it before making changes.",
    );
  return { ...space, lifecycle_actions: spaceLifecycleActions(space) };
}
export async function resourceAccess(
  userId: string,
  id: string,
  action: Capability = "read",
  allowTrash = false,
) {
  const [resource] = await query<Resource>(
    "SELECT * FROM resources WHERE id=$1",
    [id],
  );
  if (!resource || (!allowTrash && resource.deleted_at))
    throw new HttpError(404, "This item is unavailable.");
  const space = await spaceAccess(userId, resource.space_id, action);
  if (action === "manage" && !space.role)
    throw new HttpError(
      404,
      "This item is unavailable. Administrative access does not grant content access.",
    );
  return { resource: { ...resource, role: space.role }, space };
}
export async function fileAccess(
  userId: string,
  versionId: string,
  action: Capability = "read",
) {
  const [file] = await query(
    "SELECT a.*,v.resource_id,v.ordinal FROM attachments a JOIN file_versions v ON v.id=a.id WHERE a.id=$1",
    [versionId],
  );
  if (!file) throw new HttpError(404, "This file is unavailable.");
  const { resource, space } = await resourceAccess(
    userId,
    file.resource_id,
    action,
    true,
  );
  return { file, resource, space };
}
export async function projectAccess(
  userId: string,
  projectId: string,
  action: Capability = "read",
  allowInactive = false,
) {
  const [project] = await query(
    "SELECT p.*,s.id AS space_id,s.name,s.description,s.color,s.timezone FROM projects p JOIN spaces s ON s.project_id=p.id WHERE p.id=$1",
    [projectId],
  );
  if (!project) throw new HttpError(404, "This project is unavailable.");
  const space = await spaceAccess(
    userId,
    project.space_id,
    action,
    allowInactive,
  );
  return { project, space };
}
const secret = () => {
  const value = process.env.SYNC_SECRET;
  if (!value || value.length < 32)
    throw new Error("SYNC_SECRET must contain at least 32 characters.");
  return value;
};
export async function spaceAccessEpoch(
  spaceId: string,
  client?: pg.PoolClient,
): Promise<string> {
  const sql = `SELECT s.id::text||':'||count(e.id)::text AS epoch FROM spaces s
    LEFT JOIN space_lifecycle_events e ON e.space_id=s.id
      AND e.action IN ('archive','trash','purge') WHERE s.id=$1 GROUP BY s.id`;
  const rows = client
    ? (await client.query(sql, [spaceId])).rows
    : await query(sql, [spaceId]);
  if (!rows[0]) throw new HttpError(404, "This workspace is unavailable.");
  return rows[0].epoch;
}
export function signSyncToken(
  userId: string,
  sessionId: string,
  room: string,
  accessEpoch: string,
) {
  const value = Buffer.from(
    JSON.stringify({
      userId,
      sessionId,
      room,
      accessEpoch,
      exp: Date.now() + 5 * 60 * 1000,
    }),
  ).toString("base64url");
  return (
    value +
    "." +
    createHmac("sha256", secret()).update(value).digest("base64url")
  );
}
export function verifySyncToken(token: string): {
  userId: string;
  sessionId: string;
  room: string;
  exp: number;
  accessEpoch: string;
} {
  const [value, sig] = token.split(".");
  if (!value || !sig) throw new HttpError(401, "Invalid collaboration token.");
  const expected = createHmac("sha256", secret()).update(value).digest();
  const actual = Buffer.from(sig, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new HttpError(401, "Invalid collaboration token.");
  const data = JSON.parse(Buffer.from(value, "base64url").toString());
  if (data.exp < Date.now())
    throw new HttpError(401, "Collaboration token expired.");
  return data;
}
export async function validateConnection(
  context: { userId: string; sessionId: string; accessEpoch: string },
  room: string,
) {
  const [id, generation] = room.split(":");
  const note = await noteAccess(context.userId, id);
  const [session] = await query(
    "SELECT id FROM session WHERE id=$1 AND user_id=$2 AND expires_at>now()",
    [context.sessionId, context.userId],
  );
  if (!session || String(note.generation) !== generation)
    throw new HttpError(403, "Access or document version changed.");
  if (context.accessEpoch !== (await spaceAccessEpoch(note.space_id!)))
    throw new HttpError(
      403,
      "Workspace access changed. Refresh authorization before synchronizing.",
    );
  return note;
}

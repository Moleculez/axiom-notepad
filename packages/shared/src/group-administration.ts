import { randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { query } from "./db";
import { HttpError, memberAccess } from "./access";
import { contentRoleSchema } from "./workspace";
import {
  assertGroupActive,
  workspaceJson as json,
  workspaceMutation,
  recordActivity,
} from "./workspace-service";
import { canRemoveMembership } from "./accounts-api";
import { appUrl, sendMail } from "./auth";
import { notifyWorkspace } from "./documents";

const uuid = z.uuid(),
  mutationId = uuid.default(() => randomUUID());
const inviteInput = z.object({
  emails: z.array(z.email()).min(1).max(100),
  role: z.enum(["member", "admin"]).default("member"),
  contentRole: contentRoleSchema.default("editor"),
  mutationId,
});
export function invitationStatus(
  invite: {
    accepted_at?: unknown;
    revoked_at?: unknown;
    expires_at: string | Date;
  },
  now = Date.now(),
) {
  return invite.accepted_at
    ? "accepted"
    : invite.revoked_at
      ? "revoked"
      : new Date(invite.expires_at).getTime() <= now
        ? "expired"
        : "pending";
}
async function authority(
  client: PoolClient,
  userId: string,
  groupId: string,
  allowInactive = false,
) {
  await client.query("SELECT id FROM groups WHERE id=$1 FOR NO KEY UPDATE", [
    groupId,
  ]);
  if (!allowInactive) await assertGroupActive(client, groupId);
  const {
    rows: [actor],
  } = await client.query(
    "SELECT role FROM members WHERE group_id=$1 AND user_id=$2",
    [groupId, userId],
  );
  if (!actor || !["owner", "admin"].includes(actor.role))
    throw new HttpError(
      403,
      "Your administration access changed. Refresh this page.",
    );
  return actor.role as "owner" | "admin";
}
async function audit(
  client: PoolClient,
  userId: string,
  groupId: string,
  kind: string,
  title: string,
) {
  const {
    rows: [space],
  } = await client.query(
    "SELECT id FROM spaces WHERE group_id=$1 AND kind='team'",
    [groupId],
  );
  await recordActivity(client, { userId, spaceId: space.id, kind, title });
}
export async function groupAdministrationApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  const [endpoint, groupId, section, action] = path,
    method = request.method,
    url = new URL(request.url);
  if (
    endpoint !== "group-admin" ||
    !groupId ||
    !["members", "invitations", "activity", "overview"].includes(section)
  )
    return null;
  uuid.parse(groupId);
  const actor = await memberAccess(userId, groupId, true, true);
  if (method === "GET") {
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .parse(url.searchParams.get("limit") ?? 30);
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(1000000)
      .parse(url.searchParams.get("offset") ?? 0);
    const search = z
      .string()
      .max(200)
      .parse(url.searchParams.get("q") ?? "");
    const filter = url.searchParams.get("filter") ?? "all";
    if (section === "overview") {
      const [row] = await query(
        `SELECT g.id,g.name,g.description,s.id AS space_id,s.version,s.status,s.quota_bytes,
        (SELECT count(*)::int FROM members m WHERE m.group_id=g.id) AS members,
        (SELECT count(*)::int FROM projects p WHERE p.group_id=g.id) AS projects,
        (SELECT count(*)::int FROM invitations i WHERE i.group_id=g.id AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()) AS invitations
        FROM groups g JOIN spaces s ON s.group_id=g.id AND s.kind='team' WHERE g.id=$1`,
        [groupId],
      );
      return json({ ...row, role: actor.role });
    }
    let from: string, fields: string, where: string, order: string;
    const args: unknown[] = [
      groupId,
      `%${search.replace(/[\\%_]/g, "\\$&")}%`,
      filter,
    ];
    if (section === "members") {
      z.enum([
        "all",
        "owner",
        "admin",
        "member",
        "viewer",
        "commenter",
        "editor",
      ]).parse(filter);
      from = 'members m JOIN "user" u ON u.id=m.user_id';
      fields =
        "u.id,u.name,u.email,u.image,m.role,m.content_role,m.version,m.created_at";
      where =
        "m.group_id=$1 AND (u.name ILIKE $2 OR u.email ILIKE $2) AND ($3='all' OR m.role=$3 OR m.content_role=$3)";
      order = "lower(u.name),u.id";
    } else if (section === "invitations") {
      z.enum(["all", "pending", "accepted", "expired", "revoked"]).parse(
        filter,
      );
      from = "invitations i";
      const state =
        "CASE WHEN accepted_at IS NOT NULL THEN 'accepted' WHEN revoked_at IS NOT NULL THEN 'revoked' WHEN expires_at<=now() THEN 'expired' ELSE 'pending' END";
      fields = `id,email,role,content_role,version,created_at,expires_at,accepted_at,revoked_at,${state} AS status`;
      where = `group_id=$1 AND email ILIKE $2 AND ($3='all' OR (${state})=$3)`;
      order = "created_at DESC,id";
    } else {
      z.enum(["all", "access", "invitation", "workspace"]).parse(filter);
      from =
        'workspace_activity a JOIN spaces s ON s.id=a.space_id LEFT JOIN "user" u ON u.id=a.actor_id';
      fields = "a.id,a.kind,a.title,a.created_at,u.name AS actor_name";
      where =
        "s.group_id=$1 AND a.title ILIKE $2 AND (a.kind IN ('access','invitation','project-settings','group-settings') OR a.kind LIKE 'workspace-%') AND ($3='all' OR a.kind=$3 OR ($3='workspace' AND (a.kind LIKE 'workspace-%' OR a.kind IN ('group-settings','project-settings'))))";
      order = "a.created_at DESC,a.id";
    }
    const [items, [count]] = await Promise.all([
      query(
        `SELECT ${fields} FROM ${from} WHERE ${where} ORDER BY ${order} LIMIT $4 OFFSET $5`,
        [...args, limit, offset],
      ),
      query(`SELECT count(*)::int AS total FROM ${from} WHERE ${where}`, args),
    ]);
    return json({
      items,
      total: count.total,
      nextOffset:
        offset + items.length < count.total ? offset + items.length : null,
    });
  }
  if (section === "members" && method === "PATCH") {
    const input = z
      .object({
        mutationId,
        items: z
          .array(
            z.object({
              id: z.string().min(1).max(100),
              version: z.number().int().positive(),
            }),
          )
          .min(1)
          .max(100),
        contentRole: contentRoleSchema.optional(),
        role: z.enum(["admin", "member"]).optional(),
        remove: z.boolean().default(false),
      })
      .refine(
        (v) => v.remove || v.role || v.contentRole,
        "Choose a membership change.",
      )
      .parse(await request.json());
    const result = await workspaceMutation(
      userId,
      input.mutationId,
      "admin-members:" + groupId,
      input,
      async (client) => {
        const role = await authority(client, userId, groupId),
          results = [];
        for (const item of [
          ...new Map(input.items.map((v) => [v.id, v])).values(),
        ]) {
          await client.query("SAVEPOINT member_change");
          try {
            const {
              rows: [person],
            } = await client.query(
              'SELECT m.*,u.name FROM members m JOIN "user" u ON u.id=m.user_id WHERE group_id=$1 AND user_id=$2',
              [groupId, item.id],
            );
            if (!person || person.version !== item.version)
              throw new HttpError(
                409,
                "Membership changed elsewhere. Refresh before trying again.",
              );
            if (person.role === "owner" || item.id === userId)
              throw new HttpError(
                403,
                "Use Transfer ownership or Leave group for this membership.",
              );
            if (
              (person.role === "admin" || input.role === "admin") &&
              role !== "owner"
            )
              throw new HttpError(
                403,
                "Only the owner can change administrator membership.",
              );
            if (input.remove) {
              await canRemoveMembership(client, groupId, item.id);
              await client.query(
                "DELETE FROM project_members WHERE user_id=$1 AND project_id IN (SELECT id FROM projects WHERE group_id=$2)",
                [item.id, groupId],
              );
              await client.query(
                "DELETE FROM members WHERE group_id=$1 AND user_id=$2",
                [groupId, item.id],
              );
            } else
              await client.query(
                "UPDATE members SET role=$3,content_role=$4 WHERE group_id=$1 AND user_id=$2",
                [
                  groupId,
                  item.id,
                  input.role ?? person.role,
                  input.contentRole ?? person.content_role,
                ],
              );
            await audit(
              client,
              userId,
              groupId,
              "access",
              input.remove
                ? `Removed ${person.name} from the group`
                : `Updated ${person.name}: ${input.role ?? person.role} · ${input.contentRole ?? person.content_role}`,
            );
            results.push({ id: item.id, ok: true });
          } catch (error) {
            await client.query("ROLLBACK TO SAVEPOINT member_change");
            if (!(error instanceof HttpError)) throw error;
            results.push({ id: item.id, ok: false, error: error.message });
          }
          await client.query("RELEASE SAVEPOINT member_change");
        }
        return { results };
      },
    );
    await notifyWorkspace(true);
    return json(result);
  }
  if (section === "invitations" && method === "POST") {
    const issued = new Map<string, string>();
    const input =
      action === "revoke" || action === "reissue"
        ? z
            .object({
              mutationId,
              items: z
                .array(
                  z.object({ id: uuid, version: z.number().int().positive() }),
                )
                .min(1)
                .max(100),
            })
            .parse(await request.json())
        : inviteInput.parse(await request.json());
    const result = await workspaceMutation(
      userId,
      input.mutationId,
      `admin-invites:${groupId}:${action ?? "create"}`,
      input,
      async (client) => {
        const role = await authority(
          client,
          userId,
          groupId,
          action === "revoke",
        );
        const results: {
          id?: string;
          email: string;
          ok: boolean;
          error?: string;
        }[] = [];
        const targets =
          "emails" in input
            ? [...new Set(input.emails.map((e) => e.toLowerCase()))].map(
                (email) => ({ email }),
              )
            : input.items;
        for (const target of targets) {
          const existing =
            "id" in target
              ? (
                  await client.query(
                    "SELECT * FROM invitations WHERE group_id=$1 AND id=$2 FOR UPDATE",
                    [groupId, target.id],
                  )
                ).rows[0]
              : null;
          const email =
            existing?.email ??
            ("email" in target ? target.email : "Unavailable invitation");
          if (
            "id" in target &&
            (!existing ||
              existing.version !== target.version ||
              existing.accepted_at)
          ) {
            results.push({
              id: target.id,
              email,
              ok: false,
              error:
                "Invitation changed or was accepted. Refresh before retrying.",
            });
            continue;
          }
          const inviteRole = "role" in input ? input.role : existing.role;
          if (inviteRole === "admin" && role !== "owner") {
            results.push({
              email,
              ok: false,
              error: "Only the owner can manage administrator invitations.",
            });
            continue;
          }
          if (action === "revoke") {
            await client.query(
              "UPDATE invitations SET revoked_at=now(),revoked_by=$2,expires_at=least(expires_at,now()),version=version+1 WHERE id=$1",
              [existing.id, userId],
            );
            results.push({ id: existing.id, email, ok: true });
            await audit(
              client,
              userId,
              groupId,
              "invitation",
              `Revoked invitation for ${email}`,
            );
            continue;
          }
          if (
            (
              await client.query(
                'SELECT 1 FROM members m JOIN "user" u ON u.id=m.user_id WHERE m.group_id=$1 AND lower(u.email)=$2',
                [groupId, email],
              )
            ).rowCount
          ) {
            results.push({
              email,
              ok: false,
              error: "Already a group member.",
            });
            continue;
          }
          if (
            !existing &&
            (
              await client.query(
                "SELECT 1 FROM invitations WHERE group_id=$1 AND email=$2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()",
                [groupId, email],
              )
            ).rowCount
          ) {
            results.push({
              email,
              ok: false,
              error:
                "A pending invitation already exists. Reissue it to get a new link.",
            });
            continue;
          }
          const token = randomBytes(32).toString("hex"),
            hash = createHash("sha256").update(token).digest("hex");
          const invite = existing
            ? (
                await client.query(
                  "UPDATE invitations SET token_hash=$2,expires_at=now()+interval '7 days',revoked_at=NULL,revoked_by=NULL,invited_by=$3,version=version+1 WHERE id=$1 RETURNING id",
                  [existing.id, hash, userId],
                )
              ).rows[0]
            : (
                await client.query(
                  "INSERT INTO invitations(group_id,email,role,content_role,token_hash,invited_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '7 days') RETURNING id",
                  [
                    groupId,
                    email,
                    inviteRole,
                    "contentRole" in input ? input.contentRole : "editor",
                    hash,
                    userId,
                  ],
                )
              ).rows[0];
          issued.set(invite.id, `${appUrl}/?invite=${token}`);
          results.push({ id: invite.id, email, ok: true });
          await audit(
            client,
            userId,
            groupId,
            "invitation",
            `${existing ? "Reissued" : "Created"} invitation for ${email}`,
          );
        }
        return { results };
      },
    );
    // Never store invitation secrets in mutation replay records or activity logs.
    const results = [];
    for (const row of result.results) {
      const link = row.id ? issued.get(row.id) : undefined;
      let emailed = false;
      if (link)
        try {
          emailed = await sendMail(
            row.email,
            "You are invited to Axiom",
            `Join your research group: ${link}\n\nThis link expires in seven days. Previous links for this invitation no longer work.`,
          );
        } catch {
          /* Copy-link fallback remains available. */
        }
      results.push({
        ...row,
        link,
        emailed,
        delivery: link
          ? emailed
            ? "sent"
            : "copy-link"
          : action === "revoke"
            ? "revoked"
            : "not-issued",
      });
    }
    await notifyWorkspace(true);
    return json({ results });
  }
  throw new HttpError(405, "This administration action is unavailable.");
}

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import sharp from "sharp";
import { query, transaction } from "./db";
import { auth, institutionalIdentity } from "./auth";
import { HttpError, memberAccess, spaceAccess } from "./access";
import {
  contentRoleSchema,
  notificationPreferencesSchema,
  profileSchema,
} from "./workspace";
import {
  workspaceJson as json,
  workspaceMutation,
  assertRevision,
  recordActivity,
  requireScope,
  assertGroupActive,
} from "./workspace-service";
import { reserveCapacity } from "./uploads-api";
import { putAttachment, attachmentMime } from "./storage";
import { fileResponse } from "./storage-streams";
import { notifyWorkspace } from "./documents";
import { lifecycleSpace } from "./space-lifecycle";

const uuid = z.uuid(),
  identity = z.string().min(1).max(100),
  mutationId = uuid.default(() => randomUUID());
async function personAccess(who: string, person: string) {
  if (
    who !== person &&
    !(
      await query(
        "SELECT 1 FROM members a JOIN members b ON b.group_id=a.group_id WHERE a.user_id=$1 AND b.user_id=$2 LIMIT 1",
        [who, person],
      )
    ).length
  )
    throw new HttpError(404, "Researcher unavailable.");
}
export async function canRemoveMembership(
  client: import("pg").PoolClient,
  groupId: string,
  target: string,
) {
  const { rows } = await client.query(
    "SELECT p.name FROM projects p JOIN project_members pm ON pm.project_id=p.id WHERE p.group_id=$1 AND pm.user_id=$2 AND pm.can_manage AND NOT EXISTS(SELECT 1 FROM project_members other JOIN members m ON m.user_id=other.user_id AND m.group_id=p.group_id WHERE other.project_id=p.id AND other.can_manage AND other.user_id<>$2)",
    [groupId, target],
  );
  if (rows.length)
    throw new HttpError(
      409,
      "Assign another lead for this member's projects before removing their group membership.",
    );
}
async function membershipActivity(
  client: import("pg").PoolClient,
  userId: string,
  groupId: string,
  target: string,
  action: string,
) {
  const {
    rows: [space],
  } = await client.query(
    "SELECT id FROM spaces WHERE group_id=$1 AND kind='team'",
    [groupId],
  );
  const {
    rows: [person],
  } = await client.query('SELECT name FROM "user" WHERE id=$1', [target]);
  await recordActivity(client, {
    userId,
    spaceId: space.id,
    kind: "access",
    title: `${action}: ${person?.name ?? "Former researcher"}`,
  });
}
export async function accountsApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  const [endpoint, id, action] = path,
    method = request.method,
    url = new URL(request.url);
  if (endpoint === "me" && id === "profile") {
    if (method === "GET") {
      const [row] = await query(
        'SELECT u.id,u.name,u.email,u.image,p.* FROM "user" u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1',
        [userId],
      );
      return json({
        ...profileSchema.parse({
          name: row.name,
          affiliation: row.affiliation ?? "",
          interests: row.interests ?? "",
          biography: row.biography ?? "",
          links: row.links ?? [],
          timezone: row.timezone ?? "UTC",
          weeklyCapacity: Number(row.weekly_capacity ?? 40),
        }),
        email: row.email,
        image: row.image,
        version: row.version ?? 0,
      });
    }
    if (method === "PATCH") {
      const input = profileSchema
        .extend({ mutationId, version: z.number().int().nonnegative() })
        .parse(await request.json());
      const result = await workspaceMutation(
        userId,
        input.mutationId,
        "profile",
        input,
        async (client) => {
          await client.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [
            userId,
          ]);
          const {
            rows: [current],
          } = await client.query(
            "SELECT version FROM user_profiles WHERE user_id=$1",
            [userId],
          );
          assertRevision(current?.version ?? 0, input.version);
          await client.query(
            'UPDATE "user" SET name=$2,updated_at=now() WHERE id=$1',
            [userId, input.name],
          );
          const {
            rows: [profile],
          } = await client.query(
            "INSERT INTO user_profiles(user_id,affiliation,interests,biography,links,timezone,weekly_capacity) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id) DO UPDATE SET affiliation=excluded.affiliation,interests=excluded.interests,biography=excluded.biography,links=excluded.links,timezone=excluded.timezone,weekly_capacity=excluded.weekly_capacity,version=user_profiles.version+1,updated_at=now() RETURNING version",
            [
              userId,
              input.affiliation,
              input.interests,
              input.biography,
              JSON.stringify(input.links),
              input.timezone,
              input.weeklyCapacity,
            ],
          );
          return { ...input, version: profile.version };
        },
      );
      await notifyWorkspace();
      return json(result);
    }
  }
  if (endpoint === "me" && id === "avatar" && method === "POST") {
    const data = await request.formData(),
      file = data.get("file");
    const expectedVersion = z.coerce
      .number()
      .int()
      .nonnegative()
      .parse(data.get("version"));
    if (!(file instanceof File) || file.size > 5 * 1024 * 1024)
      throw new HttpError(400, "Choose an image smaller than 5 MB.");
    const source = new Uint8Array(await file.arrayBuffer());
    if (!attachmentMime(source).startsWith("image/"))
      throw new HttpError(400, "Use a PNG, JPEG, GIF or WebP image.");
    const avatar = await sharp(source, {
      limitInputPixels: 20_000_000,
      animated: false,
    })
      .rotate()
      .resize(256, 256, { fit: "cover" })
      .webp({ quality: 85 })
      .toBuffer();
    const key = randomUUID(),
      hash = createHash("sha256").update(avatar).digest("hex");
    await putAttachment(key, avatar, "image/webp");
    const version = await transaction(async (client) => {
      await client.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [
        userId,
      ]);
      const {
        rows: [previous],
      } = await client.query(
        "SELECT version FROM user_profiles WHERE user_id=$1",
        [userId],
      );
      assertRevision(previous?.version ?? 0, expectedVersion);
      const {
        rows: [saved],
      } = await client.query(
        "INSERT INTO user_profiles(user_id,avatar_key,avatar_sha256) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET avatar_key=excluded.avatar_key,avatar_sha256=excluded.avatar_sha256,version=user_profiles.version+1 RETURNING version",
        [userId, key, hash],
      );
      await client.query(
        'UPDATE "user" SET image=$2,updated_at=now() WHERE id=$1',
        [
          userId,
          `/api/v1/people/${encodeURIComponent(userId)}/avatar?v=${hash.slice(0, 12)}`,
        ],
      );
      return saved.version;
    });
    return json({
      version,
      image: `/api/v1/people/${encodeURIComponent(userId)}/avatar?v=${hash.slice(0, 12)}`,
    });
  }
  if (endpoint === "people" && method === "GET") {
    if (id) {
      await personAccess(userId, identity.parse(id));
      const [person] = await query(
        'SELECT u.id,u.name,u.image,p.affiliation,p.interests,p.biography,p.links,p.timezone,p.avatar_key,p.avatar_sha256 FROM "user" u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1',
        [id],
      );
      if (!person) throw new HttpError(404, "Researcher unavailable.");
      if (action === "avatar") {
        if (!person.avatar_key) throw new HttpError(404, "Avatar unavailable.");
        const { attachmentStream } = await import("./storage-streams");
        // Avatars are normalized and bounded to 256 px on upload.
        const parts: Buffer[] = [];
        for await (const chunk of await attachmentStream(person.avatar_key))
          parts.push(Buffer.from(chunk));
        return new Response(Buffer.concat(parts), {
          headers: {
            "content-type": "image/webp",
            "cache-control": "private, no-store",
            "x-content-type-options": "nosniff",
          },
        });
      }
      delete person.avatar_key;
      delete person.avatar_sha256;
      return json(person);
    }
    const groupId = url.searchParams.get("groupId");
    if (groupId) await memberAccess(userId, uuid.parse(groupId));
    const search = (url.searchParams.get("q") ?? "").slice(0, 200);
    return json(
      await query(
        `SELECT DISTINCT u.id,u.name,u.email,u.image,p.affiliation,p.interests,p.biography,p.links,p.timezone FROM "user" u JOIN members m ON m.user_id=u.id LEFT JOIN user_profiles p ON p.user_id=u.id WHERE EXISTS(SELECT 1 FROM members me WHERE me.group_id=m.group_id AND me.user_id=$1) AND ($2::uuid IS NULL OR m.group_id=$2) AND (u.name ILIKE '%'||$3||'%' OR p.interests ILIKE '%'||$3||'%' OR p.affiliation ILIKE '%'||$3||'%') ORDER BY u.name LIMIT 100`,
        [userId, groupId, search],
      ),
    );
  }
  if (endpoint === "me" && id === "notification-settings") {
    if (method === "GET") {
      const [record] = await query(
        "SELECT * FROM notification_preferences WHERE user_id=$1",
        [userId],
      );
      return json({
        preferences: notificationPreferencesSchema.parse(record?.data ?? {}),
        version: record?.version ?? 0,
      });
    }
    if (method === "PATCH") {
      const input = z
        .object({
          mutationId,
          version: z.number().int().nonnegative(),
          preferences: notificationPreferencesSchema,
        })
        .parse(await request.json());
      const result = await workspaceMutation(
        userId,
        input.mutationId,
        "notification-preferences",
        input,
        async (client) => {
          await client.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [
            userId,
          ]);
          const {
            rows: [current],
          } = await client.query(
            "SELECT * FROM notification_preferences WHERE user_id=$1",
            [userId],
          );
          assertRevision(current?.version ?? 0, input.version);
          const {
            rows: [row],
          } = await client.query(
            "INSERT INTO notification_preferences(user_id,data) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,version=notification_preferences.version+1 RETURNING *",
            [userId, JSON.stringify(input.preferences)],
          );
          return { preferences: row.data, version: row.version };
        },
      );
      return json(result);
    }
  }
  if (endpoint === "me" && id === "security" && method === "GET") {
    const current = await auth.api.getSession({ headers: request.headers });
    const [sessions, accounts] = await Promise.all([
      query(
        "SELECT id,created_at,updated_at,expires_at,user_agent FROM session WHERE user_id=$1 AND expires_at>now() ORDER BY updated_at DESC",
        [userId],
      ),
      query(
        "SELECT id,provider_id,created_at FROM account WHERE user_id=$1 ORDER BY created_at",
        [userId],
      ),
    ]);
    return json({
      twoFactorEnabled: current?.user.twoFactorEnabled ?? false,
      institution: institutionalIdentity,
      sessions: sessions.map((s) => ({
        ...s,
        current: s.id === current?.session.id,
      })),
      accounts,
    });
  }
  if (endpoint === "me" && id === "sessions" && method === "POST") {
    const input = z
      .object({ id: identity.optional(), others: z.boolean().default(false) })
      .parse(await request.json());
    if (input.others)
      await auth.api.revokeOtherSessions({ headers: request.headers });
    else {
      const current = await auth.api.getSession({ headers: request.headers });
      if (input.id === current?.session.id)
        throw new HttpError(
          400,
          "Use Sign out to safely clear this device's private caches.",
        );
      const [session] = await query(
        "SELECT token FROM session WHERE id=$1 AND user_id=$2",
        [input.id, userId],
      );
      if (!session) throw new HttpError(404, "Session unavailable.");
      await auth.api.revokeSession({
        headers: request.headers,
        body: { token: session.token },
      });
    }
    await notifyWorkspace(true);
    return json({ ok: true });
  }
  if (endpoint === "storage" && id) {
    uuid.parse(id);
    const space =
      method === "GET"
        ? await transaction((client) => lifecycleSpace(client, userId, id))
        : await spaceAccess(userId, id, "manage");
    if (method === "GET") {
      const [totals] = await query(
        `SELECT coalesce(sum(a.bytes),0) AS bytes,coalesce(sum(a.bytes) FILTER(WHERE r.current_version_id=a.id AND r.deleted_at IS NULL),0) AS originals,coalesce(sum(a.bytes) FILTER(WHERE r.current_version_id<>a.id AND r.deleted_at IS NULL),0) AS versions,coalesce(sum(a.bytes) FILTER(WHERE r.deleted_at IS NOT NULL),0) AS trash,count(*)::int AS version_count FROM resources r JOIN file_versions v ON v.resource_id=r.id JOIN attachments a ON a.id=v.id WHERE r.space_id=$1`,
        [id],
      );
      const files = space.role
        ? await query(
            "SELECT r.id,r.name,r.deleted_at,a.bytes,a.mime,r.current_version_id,(SELECT count(*)::int FROM file_versions v WHERE v.resource_id=r.id) AS versions FROM resources r JOIN attachments a ON a.id=r.current_version_id WHERE r.space_id=$1 ORDER BY a.bytes DESC LIMIT 100",
            [id],
          )
        : [];
      const [reserved] = await query(
        "SELECT coalesce(sum(bytes),0) AS bytes FROM upload_sessions WHERE space_id=$1 AND status IN ('uploading','verifying') AND expires_at>now()",
        [id],
      );
      const [budget] = space.group_id
        ? await query(
            "SELECT quota_bytes FROM spaces WHERE kind='team' AND group_id=$1",
            [space.group_id],
          )
        : [{ quota_bytes: space.quota_bytes }];
      return json({
        space,
        totals,
        reserved: reserved.bytes,
        quotaBytes: budget?.quota_bytes ?? null,
        files,
        retention: "manual",
      });
    }
    if (method === "PATCH") {
      if (space.kind === "project")
        throw new HttpError(
          400,
          "Storage limits are managed for the whole group in its team library.",
        );
      const input = z
        .object({
          quotaBytes: z
            .number()
            .int()
            .min(0)
            .max(Number.MAX_SAFE_INTEGER)
            .nullable(),
          expectedQuotaBytes: z.number().int().nonnegative().nullable(),
        })
        .parse(await request.json());
      await transaction(async (client) => {
        const {
          rows: [current],
        } = await client.query(
          "SELECT quota_bytes FROM spaces WHERE id=$1 FOR NO KEY UPDATE",
          [id],
        );
        await requireScope(client, userId, id, "manage");
        if (
          (current.quota_bytes === null
            ? null
            : Number(current.quota_bytes)) !== input.expectedQuotaBytes
        )
          throw new HttpError(
            409,
            "The storage limit changed elsewhere. Reopen this dialog before saving.",
          );
        await client.query("UPDATE spaces SET quota_bytes=$2 WHERE id=$1", [
          id,
          input.quotaBytes,
        ]);
        await reserveCapacity(client, id, 0, false);
      });
      return json({ ok: true });
    }
  }
  if (endpoint === "members" && id && ["DELETE", "PATCH"].includes(method)) {
    const groupId = uuid.parse(url.searchParams.get("groupId")),
      actor = await memberAccess(userId, groupId, true);
    const [target] = await query(
      "SELECT * FROM members WHERE group_id=$1 AND user_id=$2",
      [groupId, identity.parse(id)],
    );
    if (!target) throw new HttpError(404, "Membership unavailable.");
    if (target.role === "owner" || id === userId)
      throw new HttpError(
        400,
        "Use ownership transfer or Leave group for this membership.",
      );
    if (target.role === "admin" && actor.role !== "owner")
      throw new HttpError(
        403,
        "Only the owner can remove or change administrator membership.",
      );
    if (method === "DELETE")
      await transaction(async (client) => {
        await client.query(
          "SELECT id FROM groups WHERE id=$1 FOR NO KEY UPDATE",
          [groupId],
        );
        await assertGroupActive(client, groupId);
        const {
          rows: [authorization],
        } = await client.query(
          "SELECT role FROM members WHERE group_id=$1 AND user_id=$2",
          [groupId, userId],
        );
        const {
          rows: [subject],
        } = await client.query(
          "SELECT role FROM members WHERE group_id=$1 AND user_id=$2",
          [groupId, id],
        );
        if (
          !authorization ||
          authorization.role === "member" ||
          subject?.role === "owner" ||
          (subject?.role === "admin" && authorization.role !== "owner")
        )
          throw new HttpError(
            403,
            "Membership authority changed. Refresh and try again.",
          );
        await canRemoveMembership(client, groupId, id);
        await client.query(
          "DELETE FROM project_members WHERE user_id=$1 AND project_id IN (SELECT id FROM projects WHERE group_id=$2)",
          [id, groupId],
        );
        await client.query(
          "DELETE FROM members WHERE group_id=$1 AND user_id=$2",
          [groupId, id],
        );
        await membershipActivity(
          client,
          userId,
          groupId,
          id,
          "Removed group membership",
        );
      });
    else {
      const input = z
        .object({
          role: z.enum(["admin", "member"]).optional(),
          version: z.number().int().positive().optional(),
          contentRole: contentRoleSchema.optional(),
        })
        .parse(await request.json());
      if (
        (input.role === "admin" || target.role === "admin") &&
        actor.role !== "owner"
      )
        throw new HttpError(
          403,
          "Only the owner can change administrator membership.",
        );
      await transaction(async (client) => {
        await client.query(
          "SELECT id FROM groups WHERE id=$1 FOR NO KEY UPDATE",
          [groupId],
        );
        await assertGroupActive(client, groupId);
        const {
          rows: [authorization],
        } = await client.query(
          "SELECT role FROM members WHERE group_id=$1 AND user_id=$2",
          [groupId, userId],
        );
        const {
          rows: [subject],
        } = await client.query(
          "SELECT role,content_role,version FROM members WHERE group_id=$1 AND user_id=$2",
          [groupId, id],
        );
        if (!subject) throw new HttpError(404, "Membership unavailable.");
        if (input.version !== undefined)
          assertRevision(subject.version, input.version);
        if (
          !authorization ||
          authorization.role === "member" ||
          subject.role === "owner" ||
          ((subject.role === "admin" || input.role === "admin") &&
            authorization.role !== "owner")
        )
          throw new HttpError(
            403,
            "Membership authority changed. Refresh and try again.",
          );
        await client.query(
          "UPDATE members SET role=$3,content_role=$4 WHERE group_id=$1 AND user_id=$2",
          [
            groupId,
            id,
            input.role ?? subject.role,
            input.contentRole ?? subject.content_role,
          ],
        );
        await membershipActivity(
          client,
          userId,
          groupId,
          id,
          "Updated group membership",
        );
      });
    }
    await notifyWorkspace(true);
    return json({ ok: true });
  }
  if (endpoint === "group-admin" && id) {
    const groupId = uuid.parse(id);
    const member = await memberAccess(
      userId,
      groupId,
      action !== "leave",
      true,
    );
    if (!action && method === "GET") {
      const [group] = await query("SELECT * FROM groups WHERE id=$1", [
        groupId,
      ]);
      const members = await query(
        'SELECT u.id,u.name,u.email,u.image,m.role,m.content_role,m.version FROM members m JOIN "user" u ON u.id=m.user_id WHERE m.group_id=$1 ORDER BY u.name',
        [groupId],
      );
      const invitations = await query(
        "SELECT id,email,role,content_role,version,revoked_at,expires_at,accepted_at,created_at FROM invitations WHERE group_id=$1 ORDER BY created_at DESC LIMIT 100",
        [groupId],
      );
      const spaces = await query(
        "SELECT s.id,s.kind,p.name,p.audience FROM spaces s LEFT JOIN projects p ON p.id=s.project_id WHERE s.group_id=$1",
        [groupId],
      );
      const audit = await query(
        "SELECT a.id,a.kind,a.title,a.created_at,u.name AS actor_name FROM workspace_activity a JOIN spaces s ON s.id=a.space_id LEFT JOIN \"user\" u ON u.id=a.actor_id WHERE s.group_id=$1 AND a.kind IN ('access','project-settings','group-settings') ORDER BY a.created_at DESC LIMIT 100",
        [groupId],
      );
      return json({
        group,
        members,
        invitations,
        spaces,
        audit,
        role: member.role,
        institution: institutionalIdentity,
      });
    }
    if (action === "transfer" && method === "POST") {
      if (member.role !== "owner")
        throw new HttpError(
          403,
          "Only the group owner can transfer ownership.",
        );
      const input = z
        .object({
          userId: identity,
          version: z.number().int().positive().optional(),
          confirmation: z.literal("TRANSFER"),
        })
        .parse(await request.json());
      if (input.userId === userId)
        throw new HttpError(400, "Choose another group member.");
      await transaction(async (client) => {
        await client.query(
          "SELECT id FROM groups WHERE id=$1 FOR NO KEY UPDATE",
          [groupId],
        );
        const {
          rows: [current],
        } = await client.query(
          "SELECT role FROM members WHERE group_id=$1 AND user_id=$2",
          [groupId, userId],
        );
        if (current?.role !== "owner")
          throw new HttpError(409, "Group ownership changed elsewhere.");
        const {
          rows: [target],
        } = await client.query(
          "SELECT version FROM members WHERE group_id=$1 AND user_id=$2",
          [groupId, input.userId],
        );
        if (input.version !== undefined)
          assertRevision(target?.version ?? 0, input.version);
        if (
          !(
            await client.query(
              "SELECT 1 FROM members WHERE group_id=$1 AND user_id=$2",
              [groupId, input.userId],
            )
          ).rowCount
        )
          throw new HttpError(400, "The new owner must already be a member.");
        await client.query(
          "UPDATE members SET role=CASE WHEN user_id=$2 THEN 'owner' ELSE 'admin' END WHERE group_id=$1 AND user_id IN ($2,$3)",
          [groupId, input.userId, userId],
        );
        const {
          rows: [space],
        } = await client.query(
          "SELECT id FROM spaces WHERE kind='team' AND group_id=$1",
          [groupId],
        );
        await recordActivity(client, {
          userId,
          spaceId: space.id,
          kind: "access",
          title: "Transferred group ownership",
        });
      });
      await notifyWorkspace(true);
      return json({ ok: true });
    }
    if (action === "leave" && method === "POST") {
      if (member.role === "owner")
        throw new HttpError(409, "Transfer group ownership before leaving.");
      await transaction(async (client) => {
        await client.query(
          "SELECT id FROM groups WHERE id=$1 FOR NO KEY UPDATE",
          [groupId],
        );
        const {
          rows: [current],
        } = await client.query(
          "SELECT role FROM members WHERE group_id=$1 AND user_id=$2",
          [groupId, userId],
        );
        if (current?.role === "owner")
          throw new HttpError(409, "Transfer group ownership before leaving.");
        await canRemoveMembership(client, groupId, userId);
        await client.query(
          "DELETE FROM project_members WHERE user_id=$1 AND project_id IN (SELECT id FROM projects WHERE group_id=$2)",
          [userId, groupId],
        );
        await client.query(
          "DELETE FROM members WHERE group_id=$1 AND user_id=$2",
          [groupId, userId],
        );
        await membershipActivity(client, userId, groupId, userId, "Left group");
      });
      await notifyWorkspace(true);
      return json({ ok: true, personalWorkPreserved: true });
    }
    if (action === "invitation" && method === "DELETE") {
      const inviteId = uuid.parse(url.searchParams.get("invitationId"));
      await transaction(async (client) => {
        await client.query(
          "SELECT id FROM groups WHERE id=$1 FOR NO KEY UPDATE",
          [groupId],
        );
        const {
          rows: [actor],
        } = await client.query(
          "SELECT role FROM members WHERE group_id=$1 AND user_id=$2",
          [groupId, userId],
        );
        const {
          rows: [invite],
        } = await client.query(
          "SELECT role FROM invitations WHERE group_id=$1 AND id=$2 FOR UPDATE",
          [groupId, inviteId],
        );
        if (
          !actor ||
          actor.role === "member" ||
          (invite?.role === "admin" && actor.role !== "owner")
        )
          throw new HttpError(403, "Invitation authority changed.");
        await client.query(
          "UPDATE invitations SET expires_at=least(expires_at,now()),revoked_at=now(),revoked_by=$3,version=version+1 WHERE id=$1 AND group_id=$2 AND accepted_at IS NULL",
          [inviteId, groupId, userId],
        );
        const {
          rows: [space],
        } = await client.query(
          "SELECT id FROM spaces WHERE group_id=$1 AND kind='team'",
          [groupId],
        );
        await recordActivity(client, {
          userId,
          spaceId: space.id,
          kind: "invitation",
          title: "Revoked group invitation",
        });
      });
      return json({ ok: true });
    }
  }
  if (
    endpoint === "files" &&
    id &&
    action === "thumbnail" &&
    method === "GET"
  ) {
    const { resourceAccess } = await import("./access");
    const { resource } = await resourceAccess(
      userId,
      uuid.parse(id),
      "read",
      true,
    );
    const version =
      url.searchParams.get("version") ?? resource.current_version_id;
    const [thumbnail] = await query(
      "SELECT d.* FROM file_derivatives d JOIN file_versions v ON v.id=d.version_id WHERE d.version_id=$1 AND v.resource_id=$2 AND d.kind='thumbnail'",
      [version, id],
    );
    if (!thumbnail) throw new HttpError(404, "Thumbnail is not available.");
    return fileResponse(request, {
      ...thumbnail,
      name: "thumbnail.webp",
      sha256: "",
    } as Parameters<typeof fileResponse>[1]);
  }
  return null;
}

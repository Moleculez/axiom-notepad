import { createHash } from "node:crypto";
import { z } from "zod";
import { query, transaction } from "./db";
import { HttpError } from "./access";
import {
  assertGroupActive,
  recordActivity,
  workspaceJson as json,
} from "./workspace-service";
import { notifyWorkspace } from "./documents";

const tokenSchema = z.string().min(32).max(200);
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/** Recipients never receive other invitations or authority to administer a group. */
export async function acceptGroupInvitation(
  identity: { token: string } | { id: string },
  userId: string,
  email: string,
  decline = false,
) {
  const byToken = "token" in identity;
  const value = byToken
    ? hash(tokenSchema.parse(identity.token))
    : z.uuid().parse(identity.id);
  return transaction(async (client) => {
    const where = byToken ? "token_hash=$1" : "id=$1";
    const {
      rows: [candidate],
    } = await client.query(
      `SELECT group_id FROM invitations WHERE ${where} AND lower(email)=lower($2)`,
      [value, email],
    );
    if (!candidate)
      throw new HttpError(
        403,
        "This invitation must match your signed-in account email.",
      );
    await client.query("SELECT id FROM groups WHERE id=$1 FOR NO KEY UPDATE", [
      candidate.group_id,
    ]);
    const {
      rows: [invite],
    } = await client.query(
      `SELECT * FROM invitations WHERE ${where} AND lower(email)=lower($2) FOR UPDATE`,
      [value, email],
    );
    if (!invite)
      throw new HttpError(410, "This invitation is no longer available.");
    const {
      rows: [member],
    } = await client.query(
      "SELECT 1 FROM members WHERE group_id=$1 AND user_id=$2",
      [invite.group_id, userId],
    );
    // Retrying an acknowledged acceptance must not join again after departure.
    if (!decline && invite.accepted_at && member)
      return { groupId: invite.group_id, alreadyJoined: true };
    if (decline && invite.revoked_at && invite.revoked_by === userId)
      return { groupId: invite.group_id, declined: true };
    if (
      invite.accepted_at ||
      invite.revoked_at ||
      new Date(invite.expires_at).getTime() <= Date.now()
    )
      throw new HttpError(
        410,
        "This invitation was accepted, declined, revoked, or expired. Ask an administrator for a new invitation.",
      );
    await assertGroupActive(client, invite.group_id);
    if (decline) {
      await client.query(
        "UPDATE invitations SET revoked_at=now(),revoked_by=$2,expires_at=least(expires_at,now()),version=version+1 WHERE id=$1",
        [invite.id, userId],
      );
    } else {
      await client.query(
        "INSERT INTO members(group_id,user_id,role,content_role) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [invite.group_id, userId, invite.role, invite.content_role],
      );
      await client.query(
        "UPDATE invitations SET accepted_at=now(),version=version+1 WHERE id=$1",
        [invite.id],
      );
    }
    const {
      rows: [space],
    } = await client.query(
      "SELECT id FROM spaces WHERE group_id=$1 AND kind='team'",
      [invite.group_id],
    );
    await recordActivity(client, {
      userId,
      spaceId: space.id,
      kind: "invitation",
      title: decline
        ? "Recipient declined group invitation"
        : "Accepted group invitation",
    });
    return {
      groupId: invite.group_id,
      declined: decline,
      alreadyJoined: !!member,
    };
  });
}

export async function groupInvitationsApi(
  request: Request,
  path: string[],
  userId: string,
  email: string,
): Promise<Response | null> {
  if (path[0] !== "group-invitations") return null;
  if (!path[1] && request.method === "GET") {
    return json(
      await query(
        `SELECT i.id,i.group_id,i.email,i.role,i.content_role,i.expires_at,g.name AS group_name,g.description,
      EXISTS(SELECT 1 FROM members m WHERE m.group_id=g.id AND m.user_id=$2) AS already_joined
      FROM invitations i JOIN groups g ON g.id=i.group_id JOIN spaces s ON s.group_id=g.id AND s.kind='team'
      WHERE lower(i.email)=lower($1) AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now()
      AND g.lifecycle_status='active' ORDER BY i.created_at DESC LIMIT 100`,
        [email, userId],
      ),
    );
  }
  if (path[1] === "inspect" && request.method === "POST") {
    const { token } = z
      .object({ token: tokenSchema })
      .parse(await request.json());
    const [invite] = await query(
      `SELECT i.id,i.group_id,i.email,i.role,i.content_role,i.expires_at,i.accepted_at,i.revoked_at,g.name AS group_name,g.description,
      g.lifecycle_status AS group_status,EXISTS(SELECT 1 FROM members m WHERE m.group_id=g.id AND m.user_id=$2) AS already_joined
      FROM invitations i JOIN groups g ON g.id=i.group_id JOIN spaces s ON s.group_id=g.id AND s.kind='team' WHERE token_hash=$1`,
      [hash(token), userId],
    );
    if (!invite)
      throw new HttpError(
        410,
        "This invitation is no longer available. Check the link or ask for a new one.",
      );
    if (invite.email.toLowerCase() !== email.toLowerCase())
      throw new HttpError(
        403,
        "This invitation is for another email address. Sign in with the invited account.",
      );
    if (invite.group_status !== "active")
      throw new HttpError(
        409,
        "This group is archived or in Trash. Ask its owner to restore it first.",
      );
    if (
      invite.revoked_at ||
      (!invite.already_joined &&
        (invite.accepted_at ||
          new Date(invite.expires_at).getTime() <= Date.now()))
    )
      throw new HttpError(
        410,
        "This invitation has expired, was declined, or was revoked. Ask for a new invitation.",
      );
    return json(invite);
  }
  if (
    path[1] &&
    ["accept", "decline"].includes(path[2]) &&
    request.method === "POST"
  ) {
    const result = await acceptGroupInvitation(
      { id: path[1] },
      userId,
      email,
      path[2] === "decline",
    );
    await notifyWorkspace(true);
    return json(result);
  }
  throw new HttpError(404, "Invitation action unavailable.");
}

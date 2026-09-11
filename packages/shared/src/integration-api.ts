import { z } from "zod";
import { query, transaction } from "./db";
import { HttpError, spaceAccess } from "./access";
import { workspaceJson as json } from "./workspace-service";
import { integrationScopes } from "./integration-catalog";
export async function integrationApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  if (path[0] !== "connections") return null;
  const [, id, action] = path,
    method = request.method;
  if (!id && method === "GET")
    return json({
      connections: await query(
        "SELECT id,client_id,name,scopes,space_ids,created_at,updated_at,revoked_at FROM integration_connections WHERE user_id=$1 ORDER BY created_at DESC",
        [userId],
      ),
      approvals: await query(
        "SELECT a.*,c.name AS client_name FROM integration_approvals a JOIN integration_connections c ON c.id=a.connection_id WHERE c.user_id=$1 AND c.revoked_at IS NULL AND a.status IN ('pending','approved','executing','failed') ORDER BY a.created_at DESC LIMIT 100",
        [userId],
      ),
      activity: await query(
        "SELECT l.id,l.action,l.scope,l.outcome,l.created_at,c.name AS client_name FROM integration_calls l LEFT JOIN integration_connections c ON c.id=l.connection_id WHERE l.actor_id=$1 ORDER BY l.created_at DESC LIMIT 100",
        [userId],
      ),
    });
  if (id === "client" && method === "GET") {
    const clientId = new URL(request.url).searchParams.get("id");
    const [client] = await query(
      "SELECT client_id,name,uri,scopes,redirect_uris,disabled FROM oauth_client WHERE client_id=$1",
      [clientId],
    );
    if (!client || client.disabled)
      throw new HttpError(404, "This application is not registered.");
    return json(client);
  }
  if (id === "consent" && method === "POST") {
    const input = z
      .object({
        clientId: z.string().min(1).max(2000),
        scopes: z.array(z.enum(integrationScopes)).min(1),
        spaceIds: z.array(z.uuid()).min(1).max(500),
      })
      .parse(await request.json());
    if (!input.scopes.includes("workspace:read"))
      throw new HttpError(400, "Read scope is required for this connection.");
    const [client] = await query(
      "SELECT client_id,name,disabled FROM oauth_client WHERE client_id=$1",
      [input.clientId],
    );
    if (!client || client.disabled)
      throw new HttpError(404, "Application unavailable.");
    for (const space of input.spaceIds) await spaceAccess(userId, space);
    const [connection] = await query(
      "INSERT INTO integration_connections(user_id,client_id,name,scopes,space_ids) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,client_id) DO UPDATE SET name=EXCLUDED.name,scopes=EXCLUDED.scopes,space_ids=EXCLUDED.space_ids,revoked_at=NULL,updated_at=now() RETURNING id",
      [
        userId,
        input.clientId,
        client.name ?? input.clientId,
        input.scopes,
        input.spaceIds,
      ],
    );
    return json(connection);
  }
  if (id === "approvals" && action && method === "POST") {
    const input = z
      .object({ decision: z.enum(["approve", "reject"]) })
      .parse(await request.json());
    const rows = await query(
      "UPDATE integration_approvals a SET status=$3,decided_at=now() FROM integration_connections c WHERE a.id=$1 AND c.id=a.connection_id AND c.user_id=$2 AND c.revoked_at IS NULL AND a.status='pending' AND a.expires_at>now() RETURNING a.id",
      [
        z.uuid().parse(action),
        userId,
        input.decision === "approve" ? "approved" : "rejected",
      ],
    );
    if (!rows.length)
      throw new HttpError(409, "This request expired or was already decided.");
    return json({ ok: true });
  }
  if (id && method === "DELETE") {
    await transaction(async (client) => {
      const {
        rows: [connection],
      } = await client.query(
        "UPDATE integration_connections SET revoked_at=now(),updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING client_id",
        [z.uuid().parse(id), userId],
      );
      if (!connection) throw new HttpError(404, "Connection unavailable.");
      await client.query(
        "UPDATE oauth_refresh_token SET revoked=now() WHERE user_id=$1 AND client_id=$2",
        [userId, connection.client_id],
      );
      await client.query(
        "UPDATE oauth_access_token SET revoked=now() WHERE user_id=$1 AND client_id=$2",
        [userId, connection.client_id],
      );
      await client.query(
        "DELETE FROM oauth_consent WHERE user_id=$1 AND client_id=$2",
        [userId, connection.client_id],
      );
      await client.query(
        "UPDATE integration_approvals SET status='rejected',decided_at=now() WHERE connection_id=$1 AND status IN ('pending','approved')",
        [id],
      );
    });
    return json({ ok: true });
  }
  throw new HttpError(404, "Connection action unavailable.");
}

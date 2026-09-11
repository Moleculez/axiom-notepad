import type { PoolClient } from "pg";
import { query } from "./db";
import { HttpError } from "./access";
export type IntegrationConnection = {
  id: string;
  user_id: string;
  client_id: string;
  name: string;
  scopes: string[];
  space_ids: string[];
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
  grant_version: string;
};
export async function activeConnection(
  id: string,
  userId: string,
  scope = "workspace:read",
  client?: PoolClient,
  expectedVersion?: string,
) {
  const sql =
    "SELECT c.*,c.updated_at::text AS grant_version FROM integration_connections c JOIN oauth_client o ON o.client_id=c.client_id WHERE c.id=$1 AND c.user_id=$2 AND c.revoked_at IS NULL AND o.disabled IS NOT TRUE" +
    (client ? " FOR SHARE OF c,o" : "");
  const [row] = client
    ? (await client.query<IntegrationConnection>(sql, [id, userId])).rows
    : await query<IntegrationConnection>(sql, [id, userId]);
  if (
    !row ||
    !row.scopes.includes(scope) ||
    (expectedVersion !== undefined && expectedVersion !== row.grant_version)
  )
    throw new HttpError(
      403,
      "The connected application's permission was revoked or does not include this action.",
    );
  return row;
}
export function connectionAllowsSpace(
  connection: IntegrationConnection,
  spaceId: string,
) {
  if (!connection.space_ids.includes(spaceId))
    throw new HttpError(
      403,
      "This workspace is not shared with the connected application.",
    );
}

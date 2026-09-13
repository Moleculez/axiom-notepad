import type pg from "pg";
import { HttpError } from "./access";
export async function lockRevisionResource(
  client: pg.PoolClient,
  id: string,
  spaceId: string,
) {
  const result = await client.query(
    "SELECT id FROM resources WHERE id=$1 AND space_id=$2 AND deleted_at IS NULL FOR SHARE",
    [id, spaceId],
  );
  if (!result.rowCount)
    throw new HttpError(
      409,
      "The file moved or was deleted. Refresh before reviewing.",
    );
}
export async function revisionAudit(
  client: pg.PoolClient,
  userId: string,
  resourceId: string,
  action: string,
  details: Record<string, unknown>,
  operationId: string,
) {
  await client.query(
    "INSERT INTO audit_events(actor_id,actor_name,space_id,group_id,entity_id,entity_type,entity_name,action,after_values,operation_id) SELECT $1,u.name,r.space_id,s.group_id,r.id::text,'review',r.name,$3,$4,$5 FROM resources r JOIN spaces s ON s.id=r.space_id JOIN \"user\" u ON u.id=$1 WHERE r.id=$2",
    [userId, resourceId, action, JSON.stringify(details), operationId],
  );
}

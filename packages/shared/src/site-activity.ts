import type { PoolClient } from "pg";
import { recordActivity } from "./workspace-service";

/** Metadata-only, immutable attribution; never retain public/private bodies here. */
export async function recordSiteActivity(
  client: PoolClient,
  data: Parameters<typeof recordActivity>[1],
) {
  await recordActivity(client, data);
  await client.query(
    `INSERT INTO audit_events(actor_id,actor_name,space_id,group_id,entity_id,entity_type,entity_name,action,after_values,operation_id)
    SELECT $2,u.name,s.id,s.group_id,w.id::text,'website',w.config->>'title',$3,
      jsonb_build_object('enabled',w.enabled,'draft_version',w.version,'live_release',w.live_release_id),
      nullif(current_setting('axiom.operation_id',true),'')::uuid
    FROM spaces s JOIN workspace_sites w ON w.space_id=s.id JOIN "user" u ON u.id=$2 WHERE s.id=$1`,
    [data.spaceId, data.userId, data.title],
  );
}

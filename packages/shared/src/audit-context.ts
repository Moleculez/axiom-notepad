import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";

/** Per-request/job attribution. Never put authentication credentials in this context. */
export type AuditContext = {
  actorId?: string;
  operationId?: string;
  integrationId?: string;
  integrationClient?: string;
  integrationScope?: string;
  integrationVersion?: string;
  allowedSpaceIds?: string[];
  assistantContextId?: string;
  changeSetId?: string;
  pluginGrantId?: string;
  pluginPackageHash?: string;
  pluginGrantRevision?: number;
};
const context = new AsyncLocalStorage<AuditContext>();
export const withAuditContext = <T>(value: AuditContext, work: () => T): T =>
  context.run(value, work);
export const currentAuditContext = () => context.getStore();
export function setAuditActor(actorId: string) {
  const current = context.getStore();
  if (current) current.actorId = actorId;
}
export async function installAuditContext(
  client: pg.PoolClient,
  value = context.getStore(),
) {
  if (!value) return;
  if (value.pluginGrantId) {
    const { activePluginGrant } = await import("./plugin-security");
    if (
      !value.actorId ||
      !value.pluginPackageHash ||
      !value.pluginGrantRevision ||
      value.integrationId ||
      value.assistantContextId
    )
      throw new Error("Invalid extension attribution.");
    const grant = await activePluginGrant(
      {
        grantId: value.pluginGrantId,
        userId: value.actorId,
        packageHash: value.pluginPackageHash,
        revision: value.pluginGrantRevision,
      },
      client,
    );
    if (
      value.allowedSpaceIds?.length !== 1 ||
      value.allowedSpaceIds[0] !== grant.space_id
    )
      throw new Error("Extension mutation scope changed.");
  }
  await client.query(
    "SELECT set_config('axiom.plugin_grant_id',$1,true),set_config('axiom.plugin_package_hash',$2,true)",
    [value.pluginGrantId ?? "", value.pluginPackageHash ?? ""],
  );
  if (value.assistantContextId) {
    const { assistantContext, assertAssistantAccess } =
      await import("./assistant-service");
    await assertAssistantAccess(
      await assistantContext(value.assistantContextId, value.actorId, client),
      client,
    );
  }
  if (value.changeSetId)
    await client.query("SELECT set_config('axiom.change_set_id',$1,true)", [
      value.changeSetId,
    ]);
  if (value.integrationId) {
    const {
      rows: [grant],
    } = await client.query(
      "SELECT c.id FROM integration_connections c JOIN oauth_client o ON o.client_id=c.client_id WHERE c.id=$1 AND c.user_id=$2 AND c.client_id=$3 AND c.revoked_at IS NULL AND $4=ANY(c.scopes) AND ($5::text IS NULL OR c.updated_at::text=$5) AND o.disabled IS NOT TRUE FOR SHARE OF c,o",
      [
        value.integrationId,
        value.actorId,
        value.integrationClient,
        value.integrationScope ?? "workspace:read",
        value.integrationVersion ?? null,
      ],
    );
    if (!grant)
      throw new Error(
        "The connected application's access was revoked or changed.",
      );
  }
  await client.query(
    "SELECT set_config('axiom.actor_id',$1,true),set_config('axiom.operation_id',$2,true),set_config('axiom.integration_id',$3,true),set_config('axiom.integration_client',$4,true)",
    [
      value.actorId ?? "",
      value.operationId ?? "",
      value.integrationId ?? "",
      value.integrationClient ?? "",
    ],
  );
}

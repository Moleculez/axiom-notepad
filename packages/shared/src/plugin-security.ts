import type { PoolClient } from "pg";
import { query } from "./db";
import { HttpError } from "./access";
import {
  pluginManifestSchema,
  type PluginCapability,
  type PluginGrant,
  type PluginManifest,
} from "./plugins";
import type { ChangeAction } from "./productivity";

export const pluginsEnabled = () =>
  process.env.AXIOM_PLUGINS_ENABLED === "true";
export const pluginImportsEnabled = () =>
  pluginsEnabled() && process.env.AXIOM_PLUGIN_IMPORTS_ENABLED === "true";
export function requirePlugins() {
  if (!pluginsEnabled())
    throw new HttpError(
      503,
      "Extensions are disabled by this server's administrator.",
    );
}
export type ActivePluginGrant = PluginGrant & {
  user_id: string;
  plugin_id: string;
  manifest: PluginManifest;
  settings: Record<string, unknown>;
  space_name: string;
  role: string;
  group_id: string | null;
};
export type PluginAuthority = {
  grantId: string;
  userId: string;
  packageHash: string;
  revision: number;
  spaceId?: string;
  capability?: PluginCapability;
};

/** A grant is a fence, not a bearer credential. Every call still requires the
 * owner's authenticated session and current workspace content access. */
export async function activePluginGrant(
  input: PluginAuthority,
  db?: PoolClient,
): Promise<ActivePluginGrant> {
  requirePlugins();
  const read = async (sql: string, params: unknown[]) =>
    db ? (await db.query(sql, params)).rows : query(sql, params);
  if (db)
    await read(
      "SELECT i.id FROM plugin_installations i JOIN plugin_grants g ON g.installation_id=i.id WHERE g.id=$1 AND i.user_id=$2 FOR SHARE OF i",
      [input.grantId, input.userId],
    );
  const [grant] = await read(
    `SELECT g.*,i.plugin_id,i.settings,p.manifest,p.builtin,s.name AS space_name,s.kind,s.owner_id,s.group_id,s.project_id
    FROM plugin_grants g JOIN plugin_installations i ON i.id=g.installation_id JOIN plugin_packages p ON p.hash=g.package_hash
    JOIN spaces s ON s.id=g.space_id
    WHERE g.id=$1 AND g.user_id=$2 AND i.user_id=$2 AND g.package_hash=$3 AND g.revision=$4
    AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND i.enabled AND i.uninstalled_at IS NULL AND i.package_hash=g.package_hash
    ${db ? "FOR SHARE OF g,i,s" : ""}`,
    [input.grantId, input.userId, input.packageHash, input.revision],
  );
  if (!grant || (input.spaceId && input.spaceId !== grant.space_id))
    throw new HttpError(
      403,
      "Extension access changed or expired. Review and renew its permissions.",
    );
  if (!grant.builtin && !pluginImportsEnabled())
    throw new HttpError(
      403,
      "Imported extensions are disabled by this server's administrator.",
    );
  // Hold the rows that determine effective content access when executing a
  // transaction, so concurrent revocation cannot race an accepted mutation.
  if (db && grant.group_id) {
    await read("SELECT id FROM groups WHERE id=$1 FOR SHARE", [grant.group_id]);
    await read(
      "SELECT user_id FROM members WHERE group_id=$1 AND user_id=$2 FOR SHARE",
      [grant.group_id, input.userId],
    );
    await read(
      "SELECT id FROM spaces WHERE group_id=$1 AND kind='team' FOR SHARE",
      [grant.group_id],
    );
    if (grant.project_id) {
      await read("SELECT id FROM projects WHERE id=$1 FOR SHARE", [
        grant.project_id,
      ]);
      await read(
        "SELECT user_id FROM project_members WHERE project_id=$1 AND user_id=$2 FOR SHARE",
        [grant.project_id, input.userId],
      );
    }
  }
  const [access] = await read(
    "SELECT axiom_space_role($1,$2) AS role,axiom_space_state($2) AS status",
    [input.userId, grant.space_id],
  );
  if (!access?.role || access.status !== "active")
    throw new HttpError(
      403,
      "The approved workspace is unavailable or read-only.",
    );
  let effectiveExpiry = new Date(grant.expires_at);
  if (grant.kind !== "personal") {
    const [approval] = await read(
      `SELECT revision,expires_at FROM plugin_group_approvals WHERE group_id=$1 AND plugin_id=$2 AND enabled
      AND package_hash=$3 AND $4=ANY(space_ids) AND expires_at>clock_timestamp() ${db ? "FOR SHARE" : ""}`,
      [grant.group_id, grant.plugin_id, grant.package_hash, grant.space_id],
    );
    if (!approval || approval.revision !== grant.approval_revision)
      throw new HttpError(
        403,
        "Group approval changed or expired. Ask a manager to renew this exact package, then review permissions again.",
      );
    effectiveExpiry = new Date(
      Math.min(
        effectiveExpiry.valueOf(),
        new Date(approval.expires_at).valueOf(),
      ),
    );
  } else if (grant.owner_id !== input.userId)
    throw new HttpError(403, "This personal workspace is unavailable.");
  const manifest = pluginManifestSchema.parse(grant.manifest);
  if (
    grant.capabilities.some(
      (c: PluginCapability) => !manifest.capabilities.includes(c),
    )
  )
    throw new HttpError(403, "Extension permissions do not match its package.");
  if (input.capability && !grant.capabilities.includes(input.capability))
    throw new HttpError(
      403,
      "This extension has not been granted the required permission.",
    );
  return {
    ...grant,
    manifest,
    role: access.role,
    effective_expires_at: effectiveExpiry.toISOString(),
  };
}

export function pluginActionCapability(action: ChangeAction): PluginCapability {
  if (action.action === "file_create" && action.payload.type === "markdown")
    return "files:propose";
  if (action.action === "document_edit") return "documents:propose";
  if (
    ["workspace_task_create", "workspace_task_update"].includes(action.action)
  )
    return "tasks:propose";
  throw new HttpError(
    403,
    "Extensions can propose Markdown files, document edits and task changes only.",
  );
}

export async function authorizePluginAction(
  input: PluginAuthority,
  action: ChangeAction,
  db?: PoolClient,
) {
  return activePluginGrant(
    {
      ...input,
      spaceId: action.spaceId,
      capability: pluginActionCapability(action),
    },
    db,
  );
}

export async function revokeInstallationGrants(db: PoolClient, id: string) {
  await db.query(
    "UPDATE plugin_grants SET revoked_at=now(),revision=revision+1,updated_at=now() WHERE installation_id=$1",
    [id],
  );
}

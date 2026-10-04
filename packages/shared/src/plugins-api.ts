import { z } from "zod";
import type { PoolClient } from "pg";
import { query, transaction } from "./db";
import { HttpError, memberAccess, resourceAccess, spaceAccess } from "./access";
import { workspaceJson as json } from "./workspace-service";
import { notifyWorkspace } from "./documents";
import { currentRevisionDoc } from "./revision-api";
import { documentSource } from "./document-format";
import { sourceHash } from "./document-commands";
import { createChangeSet, changeSetView } from "./workspace-change-sets";
import { changeSetInput } from "./productivity";
import { readPluginPackage } from "./plugin-package";
import { pilotPackages } from "./plugin-pilots";
import {
  bindingProblem,
  editorCommands,
  editorDefaults,
  editorPreferencesSchema,
  keysFor,
} from "./editor";
import {
  activePluginGrant,
  pluginActionCapability,
  pluginImportsEnabled,
  pluginsEnabled,
  requirePlugins,
  revokeInstallationGrants,
  type ActivePluginGrant,
} from "./plugin-security";
import {
  compatiblePluginSettings,
  pluginCapabilities,
  pluginInputValuesSchema,
  pluginLimits,
  pluginManifestSchema,
  pluginMethodCapabilities,
  pluginRpcSchema,
  type PluginManifest,
} from "./plugins";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().positive();
async function boundedBody(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit)
    throw new HttpError(413, "Extension request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(413, "Extension request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
const body = async (request: Request, limit = 1_600_000): Promise<unknown> => {
  try {
    return JSON.parse((await boundedBody(request, limit)).toString("utf8"));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Invalid extension request.");
  }
};
async function registerPilots() {
  const packages = await pilotPackages();
  // One small immutable package insert per pilot/version. Not a permission grant.
  for (const p of packages)
    await query(
      "INSERT INTO plugin_packages(hash,plugin_id,version,manifest,bundle,archive,builtin) VALUES($1,$2,$3,$4,$5,$6,true) ON CONFLICT(hash) DO NOTHING",
      [
        p.hash,
        p.manifest.id,
        p.manifest.version,
        JSON.stringify(p.manifest),
        p.bundle,
        p.archive,
      ],
    );
  return packages;
}
async function packageAccess(
  user: string,
  packageHash: string,
  db?: PoolClient,
) {
  const sql = `SELECT p.* FROM plugin_packages p WHERE p.hash=$1 AND (p.builtin OR EXISTS(SELECT 1 FROM plugin_package_owners o WHERE o.package_hash=p.hash AND o.user_id=$2)
    OR EXISTS(SELECT 1 FROM plugin_group_approvals a JOIN members m ON m.group_id=a.group_id WHERE a.package_hash=p.hash AND a.enabled AND m.user_id=$2 AND EXISTS(SELECT 1 FROM unnest(a.space_ids) s(id) WHERE axiom_space_role($2,s.id) IS NOT NULL)))`;
  const rows = db
    ? (await db.query(sql, [packageHash, user])).rows
    : await query(sql, [packageHash, user]);
  if (!rows[0]) throw new HttpError(404, "Extension package unavailable.");
  if (!rows[0].builtin && !pluginImportsEnabled())
    throw new HttpError(
      403,
      "Importing third-party extensions is disabled by this server.",
    );
  return { ...rows[0], manifest: pluginManifestSchema.parse(rows[0].manifest) };
}
async function installation(
  db: PoolClient,
  user: string,
  id: string,
  expected?: number,
) {
  const {
    rows: [row],
  } = await db.query(
    "SELECT i.*,p.manifest FROM plugin_installations i JOIN plugin_packages p ON p.hash=i.package_hash WHERE i.id=$1 AND i.user_id=$2 AND i.uninstalled_at IS NULL FOR UPDATE OF i",
    [z.uuid().parse(id), user],
  );
  if (!row) throw new HttpError(404, "Extension installation unavailable.");
  if (expected !== undefined && row.revision !== expected)
    throw new HttpError(
      409,
      "The installation changed. Refresh before saving.",
    );
  return { ...row, manifest: pluginManifestSchema.parse(row.manifest) };
}
function settingsValues(manifest: PluginManifest, raw: unknown) {
  const values = pluginInputValuesSchema.parse(raw);
  for (const [key, value] of Object.entries(values)) {
    const field = manifest.settings.find((f) => f.id === key);
    if (!field) throw new HttpError(400, "Unknown extension setting.");
    if (
      field.type === "checkbox"
        ? typeof value !== "boolean"
        : field.type === "number"
          ? typeof value !== "number"
          : typeof value !== "string"
    )
      throw new HttpError(400, "Extension setting has the wrong type.");
    if (
      field.type === "select" &&
      !field.options?.some((o) => o.value === value)
    )
      throw new HttpError(400, "Choose a declared setting option.");
    if (field.required && (value === "" || value === undefined))
      throw new HttpError(400, field.label + " is required.");
  }
  for (const field of manifest.settings)
    if (field.required && !(field.id in values))
      throw new HttpError(400, field.label + " is required.");
  if (Buffer.byteLength(JSON.stringify(values)) > pluginLimits.stateBytes)
    throw new HttpError(413, "Extension settings are too large.");
  return values;
}
async function log(
  user: string,
  grant: ActivePluginGrant | null,
  method: string,
  outcome: string,
  packageHash?: string,
  installationId?: string,
  setId?: string,
) {
  await query(
    "INSERT INTO plugin_activity(user_id,installation_id,grant_id,space_id,package_hash,method,outcome,change_set_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      user,
      grant?.installation_id ?? installationId ?? null,
      grant?.id ?? null,
      grant?.space_id ?? null,
      grant?.package_hash ?? packageHash ?? "",
      method,
      outcome,
      setId ?? null,
    ],
  );
}
async function claimCall(user: string, input: z.infer<typeof pluginRpcSchema>) {
  return transaction(async (db) => {
    // Account-wide, not just grant-wide: reinstalling cannot bypass the limit.
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      "plugins:rate:" + user,
    ]);
    const grant = await activePluginGrant(
      {
        grantId: input.grantId,
        userId: user,
        packageHash: input.packageHash,
        revision: input.grantRevision,
        capability: pluginMethodCapabilities[input.method],
      },
      db,
    );
    const {
      rows: [count],
    } = await db.query(
      "SELECT count(*)::int AS value FROM plugin_activity WHERE user_id=$1 AND method LIKE 'rpc:%' AND created_at>now()-interval '1 minute'",
      [user],
    );
    if (count.value >= pluginLimits.callsPerMinute)
      throw new HttpError(
        429,
        "Extension request limit reached. Wait a minute before retrying.",
      );
    const {
      rows: [call],
    } = await db.query(
      "INSERT INTO plugin_activity(user_id,installation_id,grant_id,space_id,package_hash,method,outcome) VALUES($1,$2,$3,$4,$5,$6,'running') RETURNING id",
      [
        user,
        grant.installation_id,
        grant.id,
        grant.space_id,
        grant.package_hash,
        "rpc:" + input.method,
      ],
    );
    return { grant, callId: call.id };
  });
}
async function rpc(request: Request, user: string) {
  const input = pluginRpcSchema.parse(await body(request)),
    { grant, callId } = await claimCall(user, input);
  const authority = {
    grantId: grant.id,
    userId: user,
    packageHash: grant.package_hash,
    revision: grant.revision,
  };
  let result: unknown;
  try {
    if (input.method === "changes.prepare") {
      const change = changeSetInput.parse(input.args);
      if (
        change.spaceIds.length !== 1 ||
        change.spaceIds[0] !== grant.space_id ||
        change.actions.some(
          (a) =>
            a.spaceId !== grant.space_id ||
            !grant.capabilities.includes(pluginActionCapability(a)),
        )
      )
        throw new HttpError(
          403,
          "Proposal exceeds this extension's approved workspace or permissions.",
        );
      result = await createChangeSet(
        {
          userId: user,
          spaceIds: [grant.space_id],
          pluginGrantId: grant.id,
          pluginPackageHash: grant.package_hash,
          pluginGrantRevision: grant.revision,
        },
        change,
      );
      await query("UPDATE plugin_activity SET change_set_id=$2 WHERE id=$1", [
        callId,
        (result as { id: string }).id,
      ]);
    } else if (input.method === "documents.read") {
      const args = z
        .object({ resourceId: z.uuid() })
        .strict()
        .parse(input.args);
      const { resource } = await resourceAccess(user, args.resourceId);
      if (resource.space_id !== grant.space_id || !resource.note_id)
        throw new HttpError(
          403,
          "Document is outside this approved workspace.",
        );
      const current = await currentRevisionDoc(resource.note_id);
      try {
        const source = documentSource(current.doc, current.format);
        if (Buffer.byteLength(source) > 1_000_000)
          throw new HttpError(
            413,
            "This snapshot is too large for an extension.",
          );
        result = {
          resourceId: resource.id,
          noteId: resource.note_id,
          title: resource.name,
          source,
          format: current.format,
          generation: current.generation,
          hash: sourceHash(source),
        };
        await transaction(async (db) => {
          await activePluginGrant(authority, db);
          const {
            rows: [live],
          } = await db.query(
            "SELECT space_id,deleted_at FROM resources WHERE id=$1 FOR SHARE",
            [resource.id],
          );
          if (!live || live.deleted_at || live.space_id !== grant.space_id)
            throw new HttpError(403, "Document moved or became unavailable.");
        });
      } finally {
        current.doc.destroy();
      }
    } else {
      result = await transaction(async (db) => {
        if (input.method === "storage.set")
          await db.query(
            "SELECT id FROM plugin_installations WHERE id=$1 AND user_id=$2 FOR UPDATE",
            [grant.installation_id, user],
          );
        await activePluginGrant(authority, db);
        if (input.method === "resources.list") {
          const args = z
            .object({
              search: z.string().max(200).default(""),
              kind: z.enum(["folder", "note", "file"]).optional(),
            })
            .strict()
            .parse(input.args);
          const { rows } = await db.query(
            "SELECT r.id,r.note_id,r.name,r.kind,r.parent_id,n.source_format,r.description,r.updated_at FROM resources r LEFT JOIN notes n ON n.id=r.note_id WHERE r.space_id=$1 AND r.deleted_at IS NULL AND r.name ILIKE $2 AND ($3::text IS NULL OR r.kind=$3) AND NOT EXISTS(WITH RECURSIVE ancestors AS (SELECT id,parent_id,deleted_at FROM resources WHERE id=r.parent_id UNION SELECT p.id,p.parent_id,p.deleted_at FROM resources p JOIN ancestors a ON a.parent_id=p.id) SELECT 1 FROM ancestors WHERE deleted_at IS NOT NULL) ORDER BY r.name,r.id LIMIT 101",
            [grant.space_id, "%" + args.search + "%", args.kind ?? null],
          );
          return { items: rows.slice(0, 100), hasMore: rows.length > 100 };
        }
        if (input.method === "references.list") {
          z.object({}).strict().parse(input.args);
          const { rows } = await db.query(
            "SELECT id,cite_key,title,authors,year,doi,arxiv,version FROM reference_catalog WHERE space_id=$1 AND deleted_at IS NULL AND merged_into IS NULL ORDER BY cite_key LIMIT 1001",
            [grant.space_id],
          );
          return { items: rows.slice(0, 1000), hasMore: rows.length > 1000 };
        }
        if (input.method === "planning.read") {
          z.object({}).strict().parse(input.args);
          const {
            rows: [space],
          } = await db.query(
            "SELECT planning_version,timezone FROM spaces WHERE id=$1",
            [grant.space_id],
          );
          const blocked =
            "EXISTS(SELECT 1 FROM task_dependencies d JOIN tasks p ON p.id=d.depends_on WHERE d.task_id=t.id AND p.deleted_at IS NULL AND p.status NOT IN ('done','cancelled'))";
          const overdue =
            "t.status NOT IN ('done','cancelled') AND t.due_on<(now() AT TIME ZONE $2)::date";
          const {
            rows: [summary],
          } = await db.query(
            `SELECT count(*)::int AS total,count(*) FILTER(WHERE t.status='done')::int AS done,count(*) FILTER(WHERE t.status NOT IN ('done','cancelled') AND ${blocked})::int AS blocked,count(*) FILTER(WHERE ${overdue})::int AS overdue FROM tasks t WHERE t.space_id=$1 AND t.deleted_at IS NULL`,
            [grant.space_id, space.timezone],
          );
          const { rows: tasks } = await db.query(
            `SELECT t.id,t.title,t.status,t.due_on,t.start_on,t.version,t.progress_percent,${blocked} AS blocked,(${overdue}) AS overdue FROM tasks t WHERE t.space_id=$1 AND t.deleted_at IS NULL ORDER BY t.due_on NULLS LAST,t.id LIMIT 1001`,
            [grant.space_id, space.timezone],
          );
          const { rows: milestones } = await db.query(
            "SELECT id,title,due_on FROM project_milestones WHERE space_id=$1 AND completed_at IS NULL AND (due_on IS NULL OR due_on >= (now() AT TIME ZONE $2)::date) ORDER BY due_on NULLS LAST,id LIMIT 101",
            [grant.space_id, space.timezone],
          );
          return {
            version: space.planning_version,
            summary,
            tasks: tasks.slice(0, 1000),
            milestones: milestones.slice(0, 100),
            hasMore: tasks.length > 1000 || milestones.length > 100,
          };
        }
        if (input.method === "storage.get") {
          z.object({}).strict().parse(input.args);
          const {
            rows: [row],
          } = await db.query(
            "SELECT private_state AS data,storage_version AS version FROM plugin_installations WHERE id=$1 AND user_id=$2",
            [grant.installation_id, user],
          );
          return row;
        }
        if (input.method === "storage.set") {
          const args = z
            .object({
              version: revision,
              data: z.record(
                z.string().regex(/^[a-z][a-z0-9.-]{0,119}$/),
                z.unknown(),
              ),
            })
            .strict()
            .parse(input.args);
          if (
            Object.keys(args.data).some((k) =>
              ["constructor", "prototype", "__proto__"].includes(k),
            ) ||
            Buffer.byteLength(JSON.stringify(args.data)) >
              pluginLimits.stateBytes
          )
            throw new HttpError(
              400,
              "Private extension state is invalid or exceeds 256 KiB.",
            );
          const {
            rows: [row],
          } = await db.query(
            "UPDATE plugin_installations SET private_state=$3,storage_version=storage_version+1 WHERE id=$1 AND user_id=$2 AND storage_version=$4 RETURNING storage_version AS version",
            [
              grant.installation_id,
              user,
              JSON.stringify(args.data),
              args.version,
            ],
          );
          if (!row)
            throw new HttpError(
              409,
              "Private extension state changed. Read it again before saving.",
            );
          return row;
        }
        throw new HttpError(400, "Unknown extension method.");
      });
    }
    await activePluginGrant(authority);
    await query("UPDATE plugin_activity SET outcome='complete' WHERE id=$1", [
      callId,
    ]);
    if (Buffer.byteLength(JSON.stringify(result)) > pluginLimits.messageBytes)
      throw new HttpError(413, "Extension response is too large.");
    return json(result);
  } catch (error) {
    await query("UPDATE plugin_activity SET outcome=$2 WHERE id=$1", [
      callId,
      error instanceof HttpError ? `denied:${error.status}` : "failed",
    ]);
    throw error;
  }
}

export async function pluginsApi(
  request: Request,
  path: string[],
  user: string,
): Promise<Response | null> {
  if (path[0] !== "plugins") return null;
  if (path.length === 1 && request.method === "GET") {
    if (!pluginsEnabled())
      return json({
        enabled: false,
        importsEnabled: false,
        catalog: [],
        installations: [],
        grants: [],
        approvals: [],
        activity: [],
      });
    const pilots = await registerPilots();
    const catalog = await query(
      "SELECT DISTINCT p.hash,p.manifest FROM plugin_packages p WHERE (p.builtin AND p.hash=ANY($2::text[])) OR EXISTS(SELECT 1 FROM plugin_package_owners o WHERE o.package_hash=p.hash AND o.user_id=$1) OR EXISTS(SELECT 1 FROM plugin_group_approvals a JOIN members m ON m.group_id=a.group_id WHERE a.package_hash=p.hash AND a.enabled AND m.user_id=$1 AND EXISTS(SELECT 1 FROM unnest(a.space_ids) s(id) WHERE axiom_space_role($1,s.id) IS NOT NULL)) ORDER BY p.hash LIMIT 100",
      [user, pilots.map((p) => p.hash)],
    );
    const installations = await query(
      "SELECT i.id,i.plugin_id,i.package_hash,i.previous_hash,i.enabled,i.revision,i.settings,i.bindings,i.updated_at,p.manifest FROM plugin_installations i JOIN plugin_packages p ON p.hash=i.package_hash WHERE i.user_id=$1 AND i.uninstalled_at IS NULL ORDER BY p.manifest->>'name'",
      [user],
    );
    const grants = await query(
      "SELECT g.id,g.installation_id,g.space_id,g.package_hash,g.revision,g.approval_revision,g.capabilities,g.revoked_at,(g.revoked_at IS NULL AND i.enabled AND i.uninstalled_at IS NULL AND i.package_hash=g.package_hash AND axiom_space_role($1,g.space_id) IS NOT NULL AND axiom_space_state(g.space_id)='active' AND (s.kind='personal' OR EXISTS(SELECT 1 FROM plugin_group_approvals a WHERE a.group_id=s.group_id AND a.plugin_id=i.plugin_id AND a.enabled AND a.package_hash=g.package_hash AND a.revision=g.approval_revision AND g.space_id=ANY(a.space_ids)))) AS authorized FROM plugin_grants g JOIN plugin_installations i ON i.id=g.installation_id JOIN spaces s ON s.id=g.space_id WHERE g.user_id=$1",
      [user],
    );
    const approvals = await query(
      "SELECT a.group_id,g.name AS group_name,a.plugin_id,a.package_hash,a.space_ids,a.revision,a.enabled FROM plugin_group_approvals a JOIN groups g ON g.id=a.group_id JOIN members m ON m.group_id=g.id WHERE m.user_id=$1 AND m.role IN ('owner','admin') ORDER BY g.name,a.plugin_id",
      [user],
    );
    const activity = await query(
      "SELECT a.id,a.installation_id,a.space_id,a.package_hash,a.method,a.outcome,a.change_set_id,a.created_at,s.status AS change_set_status FROM plugin_activity a LEFT JOIN workspace_change_sets s ON s.id=a.change_set_id AND s.owner_id=a.user_id WHERE a.user_id=$1 ORDER BY a.created_at DESC LIMIT 100",
      [user],
    );
    return json({
      enabled: true,
      importsEnabled: pluginImportsEnabled(),
      catalog,
      installations,
      grants,
      approvals,
      activity,
    });
  }
  requirePlugins();
  if (
    path[1] === "proposals" &&
    path[2] &&
    path.length === 3 &&
    request.method === "DELETE"
  ) {
    // Cancelling your own proposal narrows authority. It must remain possible
    // after disable, uninstall, membership loss or approval withdrawal.
    const rows = await query(
      "UPDATE workspace_change_sets SET status=CASE WHEN approved_at IS NULL THEN 'cancelled' ELSE 'partial' END,error='Cancelled. Already completed changes remain.',updated_at=now() WHERE id=$1 AND owner_id=$2 AND plugin_grant_id IS NOT NULL AND status IN ('draft','queued','applying') RETURNING id",
      [z.uuid().parse(path[2]), user],
    );
    if (!rows.length)
      throw new HttpError(
        409,
        "This proposal is unavailable or already finished.",
      );
    return json({ cancelled: true });
  }
  if (
    path[1] === "packages" &&
    path.length === 2 &&
    request.method === "POST"
  ) {
    if (!pluginImportsEnabled())
      throw new HttpError(
        403,
        "Third-party imports are disabled pending security acceptance.",
      );
    let p: ReturnType<typeof readPluginPackage>;
    try {
      p = readPluginPackage(
        await boundedBody(request, pluginLimits.compressedBytes),
      );
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        400,
        error instanceof Error ? error.message : "Invalid extension package.",
      );
    }
    if (p.manifest.id.startsWith("axiom."))
      throw new HttpError(
        400,
        "The axiom namespace is reserved for shipped extensions.",
      );
    await transaction(async (db) => {
      // Serialize identity and quota checks so concurrent imports cannot bypass them.
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "plugins:imports:" + user,
      ]);
      const {
        rows: [quota],
      } = await db.query(
        "SELECT count(*)::int AS count,coalesce(sum(octet_length(p.archive)),0)::bigint AS bytes,bool_or(p.hash=$2) AS owned FROM plugin_package_owners o JOIN plugin_packages p ON p.hash=o.package_hash WHERE o.user_id=$1",
        [user, p.hash],
      );
      if (
        !quota.owned &&
        (quota.count >= pluginLimits.packagesPerAccount ||
          Number(quota.bytes) + p.archive.length >
            pluginLimits.packageBytesPerAccount)
      )
        throw new HttpError(
          413,
          "Extension package storage is limited to 32 packages and 64 MiB per account.",
        );
      const {
        rows: [existing],
      } = await db.query(
        "SELECT p.hash FROM plugin_packages p JOIN plugin_package_owners o ON o.package_hash=p.hash WHERE o.user_id=$1 AND p.plugin_id=$2 AND p.version=$3 AND p.hash<>$4",
        [user, p.manifest.id, p.manifest.version, p.hash],
      );
      if (existing)
        throw new HttpError(
          409,
          "A different package already uses this version. Increment the version instead of replacing it.",
        );
      await db.query(
        "INSERT INTO plugin_packages(hash,plugin_id,version,manifest,bundle,archive) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(hash) DO NOTHING",
        [
          p.hash,
          p.manifest.id,
          p.manifest.version,
          JSON.stringify(p.manifest),
          p.bundle,
          p.archive,
        ],
      );
      await db.query(
        "INSERT INTO plugin_package_owners(package_hash,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [p.hash, user],
      );
    });
    await log(user, null, "package.import", "complete", p.hash);
    return json({ hash: p.hash, manifest: p.manifest }, 201);
  }
  if (
    path[1] === "packages" &&
    path[2] &&
    path.length === 3 &&
    request.method === "GET"
  ) {
    await registerPilots();
    const p = await packageAccess(user, hash.parse(path[2]));
    return new Response(p.archive, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${p.plugin_id}-${p.version}.zip"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
  if (
    path[1] === "installations" &&
    path.length === 2 &&
    request.method === "POST"
  ) {
    await registerPilots();
    const input = z
      .object({ packageHash: hash, expectedRevision: revision.optional() })
      .strict()
      .parse(await body(request));
    const p = await packageAccess(user, input.packageHash);
    const id = await transaction(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "plugins:install:" + user + ":" + p.plugin_id,
      ]);
      const {
        rows: [old],
      } = await db.query(
        "SELECT * FROM plugin_installations WHERE user_id=$1 AND plugin_id=$2 FOR UPDATE",
        [user, p.plugin_id],
      );
      if (old && !old.uninstalled_at && input.expectedRevision !== old.revision)
        throw new HttpError(
          409,
          "Review the current installation before updating it.",
        );
      if (old && old.package_hash === p.hash && !old.uninstalled_at)
        return old.id;
      if (old) {
        await revokeInstallationGrants(db, old.id);
        await db.query(
          "UPDATE plugin_installations SET package_hash=$2,previous_hash=CASE WHEN package_hash<>$2 THEN package_hash ELSE previous_hash END,previous_settings=CASE WHEN package_hash<>$2 THEN settings ELSE previous_settings END,previous_bindings=CASE WHEN package_hash<>$2 THEN bindings ELSE previous_bindings END,settings=$3,bindings=$4,enabled=false,revision=revision+1,uninstalled_at=NULL,updated_at=now() WHERE id=$1",
          [
            old.id,
            p.hash,
            JSON.stringify(compatiblePluginSettings(p.manifest, old.settings)),
            JSON.stringify(
              Object.fromEntries(
                Object.entries(old.bindings).filter(([id]) =>
                  p.manifest.commands.some(
                    (c: PluginManifest["commands"][number]) =>
                      c.id === id && !c.panelOnly,
                  ),
                ),
              ),
            ),
          ],
        );
        return old.id;
      }
      const {
        rows: [created],
      } = await db.query(
        "INSERT INTO plugin_installations(user_id,plugin_id,package_hash,settings) VALUES($1,$2,$3,$4) RETURNING id",
        [
          user,
          p.plugin_id,
          p.hash,
          JSON.stringify(compatiblePluginSettings(p.manifest, {})),
        ],
      );
      return created.id;
    });
    await log(user, null, "installation.install", "complete", p.hash, id);
    await notifyWorkspace();
    return json({ id }, 201);
  }
  if (
    path[1] === "installations" &&
    path[2] &&
    path.length === 3 &&
    request.method === "PATCH"
  ) {
    const input = z
      .object({
        revision,
        enabled: z.boolean().optional(),
        settings: z.unknown().optional(),
        bindings: z.record(z.string().max(120), z.string().max(80)).optional(),
        rollback: z.boolean().optional(),
      })
      .strict()
      .parse(await body(request));
    const row = await transaction(async (db) => {
      const old = await installation(db, user, path[2], input.revision);
      if (input.rollback) {
        if (!old.previous_hash)
          throw new HttpError(409, "No earlier package is available.");
        await packageAccess(user, old.previous_hash, db);
        await revokeInstallationGrants(db, old.id);
        await db.query(
          "UPDATE plugin_installations SET package_hash=previous_hash,previous_hash=package_hash,settings=COALESCE(previous_settings,'{}'::jsonb),previous_settings=settings,bindings=COALESCE(previous_bindings,'{}'::jsonb),previous_bindings=bindings,enabled=false,revision=revision+1,updated_at=now() WHERE id=$1",
          [old.id],
        );
        return old;
      }
      const settings =
        input.settings === undefined
          ? old.settings
          : settingsValues(old.manifest, input.settings);
      if (
        input.bindings &&
        Object.keys(input.bindings).some(
          (key) =>
            !old.manifest.commands.some(
              (c: PluginManifest["commands"][number]) => c.id === key,
            ),
        )
      )
        throw new HttpError(400, "Shortcut belongs to an undeclared command.");
      if (input.bindings) {
        const {
          rows: [record],
        } = await db.query(
          "SELECT preferences FROM user_editor_preferences WHERE user_id=$1",
          [user],
        );
        const preferences = editorPreferencesSchema.parse(
          record?.preferences ?? editorDefaults,
        );
        const other = (
          await db.query(
            "SELECT bindings FROM plugin_installations WHERE user_id=$1 AND id<>$2 AND uninstalled_at IS NULL",
            [user, old.id],
          )
        ).rows.flatMap((r) => Object.values(r.bindings) as string[]);
        const used = new Set<string>();
        for (const [id, key] of Object.entries(input.bindings)) {
          if (!key) continue;
          const problem = bindingProblem(key);
          if (
            problem ||
            used.has(key) ||
            other.includes(key) ||
            ["Mod-k", "Mod-Shift-p", "Mod-Shift-u"].includes(key) ||
            editorCommands.some((c) =>
              ["mac", "windowsLinux"].some((platform) =>
                keysFor(
                  c.id,
                  preferences,
                  platform as "mac" | "windowsLinux",
                ).includes(key),
              ),
            )
          )
            throw new HttpError(
              400,
              problem ||
                "This shortcut conflicts with an editor, workspace or extension command.",
            );
          if (
            old.manifest.commands.find(
              (c: PluginManifest["commands"][number]) => c.id === id,
            )?.panelOnly
          )
            throw new HttpError(
              400,
              "Panel actions cannot have global shortcuts.",
            );
          used.add(key);
        }
      }
      if (input.enabled === true) {
        settingsValues(old.manifest, settings);
        await packageAccess(user, old.package_hash, db);
      }
      if (input.enabled === false) await revokeInstallationGrants(db, old.id);
      await db.query(
        "UPDATE plugin_installations SET enabled=$2,settings=$3,bindings=$4,revision=revision+1,updated_at=now() WHERE id=$1",
        [
          old.id,
          input.enabled ?? old.enabled,
          JSON.stringify(settings),
          JSON.stringify(input.bindings ?? old.bindings),
        ],
      );
      return old;
    });
    await log(
      user,
      null,
      input.rollback ? "installation.rollback" : "installation.configure",
      "complete",
      row.package_hash,
      row.id,
    );
    await notifyWorkspace();
    return json({ ok: true });
  }
  if (
    path[1] === "installations" &&
    path[2] &&
    path.length === 3 &&
    request.method === "DELETE"
  ) {
    const input = z
      .object({ revision, clearSettings: z.boolean().default(false) })
      .strict()
      .parse(await body(request));
    const row = await transaction(async (db) => {
      const old = await installation(db, user, path[2], input.revision);
      await revokeInstallationGrants(db, old.id);
      await db.query(
        "UPDATE plugin_installations SET enabled=false,uninstalled_at=now(),revision=revision+1,settings=CASE WHEN $2 THEN '{}'::jsonb ELSE settings END,bindings=CASE WHEN $2 THEN '{}'::jsonb ELSE bindings END,previous_settings=CASE WHEN $2 THEN NULL ELSE previous_settings END,previous_bindings=CASE WHEN $2 THEN NULL ELSE previous_bindings END,private_state=CASE WHEN $2 THEN '{}'::jsonb ELSE private_state END,storage_version=storage_version+1,updated_at=now() WHERE id=$1",
        [old.id, input.clearSettings],
      );
      return old;
    });
    await log(
      user,
      null,
      "installation.uninstall",
      "complete",
      row.package_hash,
      row.id,
    );
    await notifyWorkspace();
    return json({ ok: true });
  }
  if (path[1] === "grants" && path.length === 2 && request.method === "POST") {
    const input = z
      .object({
        installationId: z.uuid(),
        installationRevision: revision,
        spaceId: z.uuid(),
        capabilities: z
          .array(z.enum(pluginCapabilities))
          .max(pluginCapabilities.length),
        grantRevision: revision.optional(),
      })
      .strict()
      .parse(await body(request));
    await spaceAccess(user, input.spaceId);
    const grant = await transaction(async (db) => {
      const i = await installation(
        db,
        user,
        input.installationId,
        input.installationRevision,
      );
      if (!i.enabled)
        throw new HttpError(
          409,
          "Enable this installation before reviewing workspace permissions.",
        );
      await packageAccess(user, i.package_hash, db);
      if (
        new Set(input.capabilities).size !== input.capabilities.length ||
        input.capabilities.some((c) => !i.manifest.capabilities.includes(c))
      )
        throw new HttpError(
          400,
          "Choose only permissions declared by this package.",
        );
      const {
        rows: [space],
      } = await db.query(
        "SELECT *,axiom_space_role($2,id) AS role,axiom_space_state(id) AS state FROM spaces WHERE id=$1 FOR SHARE",
        [input.spaceId, user],
      );
      if (!space?.role || space.state !== "active")
        throw new HttpError(403, "Choose an active workspace you can read.");
      let approvalRevision: number | null = null;
      if (space.kind !== "personal") {
        const {
          rows: [a],
        } = await db.query(
          "SELECT revision FROM plugin_group_approvals WHERE group_id=$1 AND plugin_id=$2 AND package_hash=$3 AND enabled AND $4=ANY(space_ids) FOR SHARE",
          [space.group_id, i.plugin_id, i.package_hash, space.id],
        );
        if (!a)
          throw new HttpError(
            403,
            "A group manager must approve this exact package for this workspace first.",
          );
        approvalRevision = a.revision;
      }
      const {
        rows: [old],
      } = await db.query(
        "SELECT * FROM plugin_grants WHERE installation_id=$1 AND space_id=$2 FOR UPDATE",
        [i.id, space.id],
      );
      if (old && input.grantRevision !== old.revision)
        throw new HttpError(
          409,
          "Workspace permissions changed. Refresh before granting access.",
        );
      const {
        rows: [g],
      } = await db.query(
        "INSERT INTO plugin_grants(installation_id,user_id,space_id,package_hash,capabilities,approval_revision) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(installation_id,space_id) DO UPDATE SET package_hash=EXCLUDED.package_hash,capabilities=EXCLUDED.capabilities,approval_revision=EXCLUDED.approval_revision,revoked_at=NULL,revision=plugin_grants.revision+1,updated_at=now() RETURNING *",
        [
          i.id,
          user,
          space.id,
          i.package_hash,
          input.capabilities,
          approvalRevision,
        ],
      );
      await activePluginGrant(
        {
          grantId: g.id,
          userId: user,
          packageHash: g.package_hash,
          revision: g.revision,
        },
        db,
      );
      return g;
    });
    await log(user, grant, "grant.consent", "complete");
    await notifyWorkspace();
    return json(grant, 201);
  }
  if (
    path[1] === "grants" &&
    path[2] &&
    path.length === 3 &&
    request.method === "DELETE"
  ) {
    const input = z
      .object({ revision })
      .strict()
      .parse(await body(request));
    const rows = await query(
      "UPDATE plugin_grants SET revoked_at=now(),revision=revision+1,updated_at=now() WHERE id=$1 AND user_id=$2 AND revision=$3 RETURNING installation_id,package_hash",
      [z.uuid().parse(path[2]), user, input.revision],
    );
    if (!rows.length)
      throw new HttpError(409, "Permissions changed. Refresh before revoking.");
    await log(
      user,
      null,
      "grant.revoke",
      "complete",
      rows[0].package_hash,
      rows[0].installation_id,
    );
    await notifyWorkspace();
    return json({ ok: true });
  }
  if (
    path[1] === "approvals" &&
    path.length === 2 &&
    request.method === "POST"
  ) {
    const input = z
      .object({
        groupId: z.uuid(),
        packageHash: hash,
        spaceIds: z.array(z.uuid()).max(100),
        enabled: z.boolean(),
        revision: revision.optional(),
      })
      .strict()
      .parse(await body(request));
    await memberAccess(user, input.groupId, true);
    const p = await packageAccess(user, input.packageHash);
    await transaction(async (db) => {
      // Match the locks used by runtime authorization. No content read is
      // implied by administrative approval for a restricted project.
      const {
        rows: [manager],
      } = await db.query(
        "SELECT role FROM members WHERE group_id=$1 AND user_id=$2 FOR SHARE",
        [input.groupId, user],
      );
      const {
        rows: [group],
      } = await db.query(
        "SELECT lifecycle_status FROM groups WHERE id=$1 FOR SHARE",
        [input.groupId],
      );
      if (
        !manager ||
        manager.role === "member" ||
        group?.lifecycle_status !== "active"
      )
        throw new HttpError(403, "Group management access changed.");
      const { rows: spaces } = await db.query(
        "SELECT id FROM spaces WHERE id=ANY($1::uuid[]) AND group_id=$2",
        [input.spaceIds, input.groupId],
      );
      if (
        spaces.length !== new Set(input.spaceIds).size ||
        spaces.length !== input.spaceIds.length
      )
        throw new HttpError(
          400,
          "Approve distinct workspaces belonging to this group.",
        );
      const {
        rows: [old],
      } = await db.query(
        "SELECT revision FROM plugin_group_approvals WHERE group_id=$1 AND plugin_id=$2 FOR UPDATE",
        [input.groupId, p.plugin_id],
      );
      if (old && old.revision !== input.revision)
        throw new HttpError(
          409,
          "Group approval changed. Refresh before updating it.",
        );
      await db.query(
        "INSERT INTO plugin_group_approvals(group_id,plugin_id,package_hash,space_ids,enabled,approved_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(group_id,plugin_id) DO UPDATE SET package_hash=EXCLUDED.package_hash,space_ids=EXCLUDED.space_ids,enabled=EXCLUDED.enabled,approved_by=EXCLUDED.approved_by,revision=plugin_group_approvals.revision+1,updated_at=now()",
        [
          input.groupId,
          p.plugin_id,
          p.hash,
          input.spaceIds,
          input.enabled,
          user,
        ],
      );
      // approval_revision fences every existing grant without acquiring grant
      // locks after the approval lock (which would invert runtime lock order).
    });
    await log(user, null, "group.approval", "complete", p.hash);
    await notifyWorkspace();
    return json({ ok: true });
  }
  if (
    path[1] === "runtime" &&
    path[2] === "start" &&
    path.length === 3 &&
    request.method === "POST"
  ) {
    const input = z
      .object({
        installationId: z.uuid(),
        spaceId: z.uuid(),
        resourceId: z.uuid().optional(),
        command: z.string().max(120),
      })
      .strict()
      .parse(await body(request));
    const [g] = await query(
      "SELECT id,package_hash,revision FROM plugin_grants WHERE installation_id=$1 AND space_id=$2 AND user_id=$3",
      [input.installationId, input.spaceId, user],
    );
    if (!g)
      throw new HttpError(
        403,
        "Review workspace permissions in Settings → Extensions first.",
      );
    const grant = await activePluginGrant({
      grantId: g.id,
      userId: user,
      packageHash: g.package_hash,
      revision: g.revision,
    });
    if (!grant.manifest.commands.some((c) => c.id === input.command))
      throw new HttpError(400, "Unknown extension command.");
    if (input.resourceId) {
      const { resource } = await resourceAccess(user, input.resourceId);
      if (resource.space_id !== grant.space_id)
        throw new HttpError(403, "Selected file is outside this workspace.");
    }
    const [p] = await query(
      "SELECT bundle FROM plugin_packages WHERE hash=$1",
      [grant.package_hash],
    );
    await activePluginGrant({
      grantId: g.id,
      userId: user,
      packageHash: g.package_hash,
      revision: g.revision,
    });
    await log(user, grant, "runtime.start", "complete");
    return json({
      bundle: p.bundle,
      manifest: grant.manifest,
      grantId: g.id,
      grantRevision: g.revision,
      packageHash: g.package_hash,
      context: {
        spaceId: grant.space_id,
        spaceName: grant.space_name,
        resourceId: input.resourceId,
        command: input.command,
        inputs: {},
        settings: grant.settings,
      },
    });
  }
  if (
    path[1] === "runtime" &&
    path[2] === "validate" &&
    path.length === 3 &&
    request.method === "POST"
  ) {
    const input = z
      .object({ grantId: z.uuid(), grantRevision: revision, packageHash: hash })
      .strict()
      .parse(await body(request));
    await activePluginGrant({
      grantId: input.grantId,
      userId: user,
      packageHash: input.packageHash,
      revision: input.grantRevision,
    });
    return json({ ok: true });
  }
  if (
    path[1] === "reviews" &&
    path[2] &&
    path.length === 3 &&
    request.method === "POST"
  ) {
    const input = z
      .object({ grantId: z.uuid(), grantRevision: revision, packageHash: hash })
      .strict()
      .parse(await body(request));
    const grant = await activePluginGrant({
      grantId: input.grantId,
      userId: user,
      packageHash: input.packageHash,
      revision: input.grantRevision,
    });
    const view = await changeSetView(z.uuid().parse(path[2]), user);
    if (
      view.plugin_grant_id !== grant.id ||
      view.plugin_package_hash !== grant.package_hash
    )
      throw new HttpError(403, "This proposal belongs to another extension.");
    return json({ id: view.id });
  }
  if (path[1] === "rpc" && path.length === 2 && request.method === "POST")
    return rpc(request, user);
  throw new HttpError(404, "Extension operation unavailable.");
}

import { z } from "zod";
import { parseMarkdown, documentAssets } from "@axiom/markdown";
import { query, transaction } from "./db";
import { HttpError, resourceAccess } from "./access";
import {
  requireScope,
  recordActivity,
  workspaceJson as json,
} from "./workspace-service";
import {
  snippetInput,
  type EditorSnippet,
  type ResolvedAsset,
} from "./editor-media";
import { currentAuditContext } from "./audit-context";

export async function editorMediaApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  const [endpoint, id, action] = path;
  const url = new URL(request.url);
  if (endpoint === "media-assets" && request.method === "POST") {
    const input = z
      .object({ versions: z.array(z.uuid()).max(200) })
      .parse(await request.json());
    const rows = await query<ResolvedAsset>(
      `SELECT v.id AS "versionId",r.id AS "resourceId",r.name,a.mime,a.bytes::float8,r.reference_code AS "referenceCode",r.current_version_id AS "currentVersionId",r.space_id AS "spaceId" FROM file_versions v JOIN resources r ON r.id=v.resource_id JOIN attachments a ON a.id=v.id WHERE v.id=ANY($2::uuid[]) AND r.deleted_at IS NULL AND axiom_space_role($1,r.space_id) IS NOT NULL`,
      [userId, input.versions],
    );
    const allowed = new Set<string>();
    await transaction(async (client) => {
      for (const space of new Set(rows.map((row) => row.spaceId!))) {
        try {
          await requireScope(client, userId, space);
          allowed.add(space);
        } catch (error) {
          if (!(
            error instanceof HttpError && [403, 404, 410].includes(error.status)
          ))
            throw error;
        }
      }
    });
    const resolved = new Map(
      rows
        .filter((row) => allowed.has(row.spaceId!))
        .map((row) => [row.versionId, row]),
    );
    // Missing and inaccessible identities deliberately have the same response.
    return json(
      input.versions.map(
        (versionId) =>
          resolved.get(versionId) ?? { versionId, unavailable: true },
      ),
    );
  }
  if (endpoint === "resource-code" && id && request.method === "GET") {
    const [resource] = await query<{ id: string }>(
      "SELECT id FROM resources WHERE reference_code=$2 AND deleted_at IS NULL AND axiom_space_role($1,space_id) IS NOT NULL",
      [userId, id.toUpperCase()],
    );
    if (!resource) throw new HttpError(404, "File unavailable.");
    const value = (await resourceAccess(userId, resource.id)).resource;
    await transaction((client) => requireScope(client, userId, value.space_id));
    return json(value);
  }
  if (endpoint === "spaces" && id && action === "reference-prefix") {
    z.uuid().parse(id);
    if (request.method === "GET")
      return json(
        await transaction(async (client) => {
          await requireScope(client, userId, id);
          return (
            await client.query(
              "SELECT reference_prefix FROM spaces WHERE id=$1",
              [id],
            )
          ).rows[0];
        }),
      );
    if (request.method === "PUT") {
      const { prefix } = z
        .object({
          prefix: z
            .string()
            .trim()
            .toUpperCase()
            .regex(/^[A-Z][A-Z0-9]{1,11}$/),
        })
        .parse(await request.json());
      return json(
        await transaction(async (client) => {
          await requireScope(client, userId, id, "manage");
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
            "file-code:" + id,
          ]);
          const existing = (
            await client.query(
              "INSERT INTO resource_code_prefixes(prefix,space_id) VALUES($1,$2) ON CONFLICT(prefix) DO UPDATE SET prefix=EXCLUDED.prefix RETURNING space_id",
              [prefix, id],
            )
          ).rows[0];
          if (existing.space_id !== id)
            throw new HttpError(
              409,
              "That prefix is reserved. Choose another.",
            );
          await client.query(
            "UPDATE spaces SET reference_prefix=$1 WHERE id=$2",
            [prefix, id],
          );
          await recordActivity(client, {
            userId,
            spaceId: id,
            kind: "updated",
            title: `Changed file reference prefix to ${prefix}`,
          });
          return { reference_prefix: prefix };
        }),
      );
    }
  }
  if (endpoint !== "editor-snippets") return null;
  // Personal snippets are outside a workspace-scoped integration grant.
  if (
    currentAuditContext()?.integrationId ||
    currentAuditContext()?.allowedSpaceIds
  )
    throw new HttpError(
      403,
      "Snippet management requires an interactive account session.",
    );
  if (request.method === "GET" && !id) {
    const space = url.searchParams.get("spaceId");
    if (space) z.uuid().parse(space);
    if (space)
      await transaction((client) => requireScope(client, userId, space));
    const search = (url.searchParams.get("q") ?? "").slice(0, 200),
      cursor = Number(url.searchParams.get("offset") ?? 0);
    const offset = z.number().int().min(0).max(100_000).parse(cursor);
    const rows = await query<EditorSnippet>(
      `SELECT * FROM editor_snippets WHERE ((space_id IS NULL AND owner_id=$1) OR (space_id=$2::uuid AND axiom_space_role($1,space_id) IS NOT NULL)) AND archived=$3 AND (name ILIKE '%'||$4||'%' OR array_to_string(tags,' ') ILIKE '%'||$4||'%') ORDER BY updated_at DESC,id LIMIT 51 OFFSET $5`,
      [
        userId,
        space,
        url.searchParams.get("archived") === "true",
        search,
        offset,
      ],
    );
    return json({
      items: rows.slice(0, 50),
      nextOffset: rows.length > 50 ? offset + 50 : null,
    });
  }
  if (!["POST", "PATCH"].includes(request.method)) return null;
  const raw = await request.json();
  const input = id
    ? snippetInput
        .omit({ tags: true, spaceId: true })
        .partial()
        .extend({
          tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
          spaceId: z.uuid().nullable().optional(),
          version: z.number().int().positive(),
          archived: z.boolean().optional(),
        })
        .parse(raw)
    : snippetInput.parse(raw);
  if (id) z.uuid().parse(id);
  return json(
    await transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock_shared(hashtext('axiom:file-references'))",
      );
      const previous: EditorSnippet | undefined = id
        ? (
            await client.query(
              "SELECT * FROM editor_snippets WHERE id=$1 FOR UPDATE",
              [id],
            )
          ).rows[0]
        : undefined;
      if (id && !previous) throw new HttpError(404, "Snippet unavailable.");
      if (previous) {
        if (previous.space_id)
          await requireScope(client, userId, previous.space_id, "edit");
        else if (previous.owner_id !== userId)
          throw new HttpError(404, "Snippet unavailable.");
        if (previous.version !== (input as { version: number }).version)
          throw new HttpError(
            409,
            "This snippet changed. Reload before saving.",
          );
        if (input.spaceId !== undefined && input.spaceId !== previous.space_id)
          throw new HttpError(
            400,
            "Duplicate a snippet to change its sharing scope.",
          );
      }
      const scope = previous?.space_id ?? input.spaceId ?? null;
      if (scope) await requireScope(client, userId, scope, "edit");
      const body = input.body ?? previous!.body;
      const versions = [
        ...new Set(
          documentAssets(parseMarkdown(body)).flatMap((asset) =>
            asset.versionId ? [asset.versionId] : [],
          ),
        ),
      ];
      if (versions.length) {
        const files = await client.query(
          "SELECT v.id,r.space_id FROM file_versions v JOIN resources r ON r.id=v.resource_id WHERE v.id=ANY($2::uuid[]) AND r.deleted_at IS NULL AND axiom_space_role($1,r.space_id) IS NOT NULL",
          [userId, versions],
        );
        if (
          files.rowCount !== versions.length ||
          (scope && files.rows.some((r) => r.space_id !== scope))
        )
          throw new HttpError(
            403,
            "Snippet attachments must be accessible in its destination workspace.",
          );
        for (const space of new Set<string>(
          files.rows.map((row) => row.space_id),
        ))
          await requireScope(client, userId, space);
      }
      const saved: EditorSnippet = previous
        ? (
            await client.query(
              "UPDATE editor_snippets SET name=$2,body=$3,tags=$4,archived=$5,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
              [
                id,
                input.name ?? previous.name,
                body,
                input.tags ?? previous.tags,
                (input as { archived?: boolean }).archived ?? previous.archived,
              ],
            )
          ).rows[0]
        : (
            await client.query(
              "INSERT INTO editor_snippets(owner_id,space_id,name,body,tags) VALUES($1,$2,$3,$4,$5) RETURNING *",
              [userId, scope, input.name, body, input.tags ?? []],
            )
          ).rows[0];
      await client.query(
        "DELETE FROM snippet_asset_references WHERE snippet_id=$1",
        [saved.id],
      );
      if (versions.length)
        await client.query(
          "INSERT INTO snippet_asset_references(snippet_id,version_id) SELECT $1,unnest($2::uuid[])",
          [saved.id, versions],
        );
      if (scope)
        await recordActivity(client, {
          userId,
          spaceId: scope,
          kind: previous ? "updated" : "created",
          title: `${saved.archived ? "Archived" : previous?.archived ? "Restored" : previous ? "Updated" : "Created"} research snippet: ${saved.name}`,
        });
      return saved;
    }),
  );
}

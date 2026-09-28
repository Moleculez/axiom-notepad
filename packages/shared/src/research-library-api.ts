import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { query, transaction } from "./db";
import { researchLocation } from "./research-location";
import { HttpError, resourceAccess, fileAccess } from "./access";
import { notifyWorkspace } from "./documents";
import { updateBibtexEntry, formatBibtex } from "./bibliography";
import { referenceDetailsSchema } from "./research";
import {
  workspaceJson as json,
  workspaceMutation,
  requireScope,
} from "./workspace-service";
import {
  libraryDraftSchema,
  libraryScopeSchema,
  referenceTagsSchema,
  parseReferenceImport,
  referenceIdentityKeys,
  formatRis,
  type LibraryReference,
  type LibraryScope,
  type ReferenceImportItem,
} from "./research-library";
import {
  checkLibraryScope,
  libraryPredicate,
  libraryWrite,
  libraryAudit,
  lockReferences,
  referenceAccess,
  referenceLinks,
  requireLibraryScope,
  liveResource,
  resolveLibraryScope,
  libraryRequestInput,
} from "./research-library-service";

const id = z.uuid(),
  versions = z.record(id, z.number().int().positive());
const selection = z
  .array(id)
  .min(1)
  .max(200)
  .refine((v) => new Set(v).size === v.length, "Select each reference once.");
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const scopeOf = (url: URL, user: string) =>
  resolveLibraryScope(
    user,
    url.searchParams.get("spaceId")
      ? { spaceId: url.searchParams.get("spaceId") }
      : { groupId: url.searchParams.get("groupId") || null },
  );
const fields = (r: z.infer<typeof referenceDetailsSchema>) => ({
  title: r.title,
  author: r.authors,
  year: r.year,
  url: r.url,
  doi: r.doi,
  eprint: r.arxiv,
  journal: r.venue,
});
const renameBibtex = (source: string, key: string) =>
  source.replace(/^(@\w+\s*\{\s*)[^,]+/, `$1${key}`);
function editedBibtex(
  r: LibraryReference,
  d: z.infer<typeof referenceDetailsSchema>,
) {
  const before = fields(r),
    after = fields(d);
  return updateBibtexEntry(
    r.bibtex,
    r.cite_key,
    Object.fromEntries(
      Object.entries(after).filter(
        ([key, value]) =>
          !r.bibtex || before[key as keyof typeof before] !== value,
      ),
    ),
  );
}
const duplicateSQL = `EXISTS(SELECT 1 FROM bibliography d WHERE d.id<>b.id AND d.merged_into IS NULL AND d.deleted_at IS NULL AND d.space_id=b.space_id AND d.identity_keys && b.identity_keys)`;

async function insertReference(
  c: pg.PoolClient,
  user: string,
  scope: LibraryScope,
  d: z.infer<typeof libraryDraftSchema>,
  source?: ReferenceImportItem,
  format?: string,
) {
  const {
    rows: [r],
  } = await c.query(
    `INSERT INTO bibliography(space_id,cite_key,title,authors,year,url,doi,arxiv,venue,tags,bibtex,import_source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      scope.spaceId,
      d.citeKey,
      d.title,
      d.authors,
      d.year,
      d.url,
      d.doi.trim(),
      d.arxiv.trim(),
      d.venue,
      d.tags,
      source?.bibtex ?? updateBibtexEntry("", d.citeKey, fields(d)),
      JSON.stringify(source ? { format, raw: source.raw } : {}),
    ],
  );
  await libraryAudit(c, user, scope, r.id, r.title, "create", {
    citeKey: r.cite_key,
  });
  return r;
}
async function collectionAccess(
  c: pg.PoolClient,
  user: string,
  scope: LibraryScope,
  collection: string,
) {
  const {
    rows: [r],
  } = await c.query(
    `SELECT * FROM reference_collections b WHERE b.id=$3 AND ${libraryPredicate()} FOR UPDATE`,
    [user, scope.spaceId, collection],
  );
  if (!r) throw new HttpError(404, "Collection unavailable.");
  return r;
}
const operationSchema = z.object({
  scope: libraryScopeSchema,
  mutationId: id.optional(),
  hash: z.string().max(64).optional(),
});

export async function researchLibraryApi(
  request: Request,
  path: string[],
  user: string,
): Promise<Response | null> {
  if (path[0] !== "research" || path[1] !== "library") return null;
  const url = new URL(request.url),
    method = request.method,
    [, , section, item, action] = path;
  if (method === "GET" && section === "location")
    return json(await researchLocation(user, url.searchParams));
  if (method === "GET" && section === "collections") {
    const scope = await scopeOf(url, user);
    await checkLibraryScope(user, scope);
    return json(
      await query(
        `SELECT b.id,b.name,b.parent_id,b.version FROM reference_collections b WHERE ${libraryPredicate()} ORDER BY lower(name),id`,
        [user, scope.spaceId],
      ),
    );
  }
  if (method === "GET" && !section) {
    const scope = await scopeOf(url, user);
    const canEdit = await checkLibraryScope(user, scope);
    const p = z
      .object({
        q: z.string().max(200).default(""),
        author: z.string().max(200).default(""),
        year: z.string().max(20).default(""),
        tag: z.string().max(80).default(""),
        collection: z
          .union([id, z.literal("unfiled"), z.literal("")])
          .default(""),
        status: z
          .enum(["all", "want", "reading", "read", "archived"])
          .default("all"),
        filter: z.enum(["all", "duplicates", "trash"]).default("all"),
        sort: z
          .enum(["title", "authors", "year", "venue", "updated_at"])
          .default("updated_at"),
        direction: z.enum(["asc", "desc"]).default("desc"),
        cursor: z.coerce.number().int().min(0).max(1000000).default(0),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        spaceId: id.optional(),
        format: z.enum(["bib", "ris"]).optional(),
      })
      .parse(
        Object.fromEntries(
          [...url.searchParams].filter(([k]) => k !== "groupId"),
        ),
      );
    const values: unknown[] = [user, scope.spaceId];
    const bind = (v: unknown) => {
      values.push(v);
      return `$${values.length}`;
    };
    const terms = [
      libraryPredicate(),
      "b.merged_into IS NULL",
      p.filter === "trash"
        ? "b.deleted_at IS NOT NULL"
        : "b.deleted_at IS NULL",
    ];
    if (p.q)
      terms.push(
        `concat_ws(' ',b.title,b.authors,b.cite_key,b.doi,b.arxiv,b.venue) ILIKE '%'||${bind(p.q)}||'%'`,
      );
    if (p.author) terms.push(`b.authors ILIKE '%'||${bind(p.author)}||'%'`);
    if (p.year) terms.push(`b.year=${bind(p.year)}`);
    if (p.tag) terms.push(`${bind(p.tag)}=ANY(b.tags)`);
    if (p.collection === "unfiled")
      terms.push(
        "NOT EXISTS(SELECT 1 FROM reference_collection_items ci WHERE ci.reference_id=b.id)",
      );
    else if (p.collection)
      terms.push(
        `EXISTS(WITH RECURSIVE tree AS (SELECT id FROM reference_collections WHERE id=${bind(p.collection)}::uuid UNION SELECT rc.id FROM reference_collections rc JOIN tree ON rc.parent_id=tree.id) SELECT 1 FROM reference_collection_items ci JOIN tree ON tree.id=ci.collection_id WHERE ci.reference_id=b.id)`,
      );
    if (p.filter === "duplicates") terms.push(duplicateSQL);
    if (p.status !== "all")
      terms.push(`coalesce(ri.data->>'status','want')=${bind(p.status)}`);
    const from = `FROM bibliography b LEFT JOIN reading_items ri ON ri.user_id=$1 AND ri.target_type='reference' AND ri.target_id=b.id AND ri.kind='reading' AND NOT ri.deleted WHERE ${terms.join(" AND ")}`;
    const [{ count }] = await query(
      `SELECT count(*)::int AS count ${from}`,
      values,
    );
    if (p.format && count > 10000)
      throw new HttpError(
        413,
        "Narrow the export to 10,000 references or fewer.",
      );
    const rows = await query<LibraryReference>(
      `SELECT b.*,coalesce(ri.data->>'status','want') AS status,ARRAY(SELECT collection_id FROM reference_collection_items WHERE reference_id=b.id) AS collections,
   (SELECT count(*)::int FROM reference_notes l JOIN resources r ON r.note_id=l.note_id WHERE l.reference_id=b.id AND axiom_space_role($1,r.space_id) IS NOT NULL AND ${liveResource()}) AS note_count,
   (SELECT count(*)::int FROM reference_attachments l JOIN file_versions v ON v.id=l.attachment_id JOIN resources r ON r.id=v.resource_id WHERE l.reference_id=b.id AND axiom_space_role($1,r.space_id) IS NOT NULL AND ${liveResource()}) AS pdf_count
   ${from} ORDER BY b.${p.sort} ${p.direction},b.id LIMIT ${p.format ? 10000 : p.limit} OFFSET ${p.format ? 0 : p.cursor}`,
      values,
    );
    if (p.format) return exportResponse(rows, p.format);
    const collections = await query(
      `SELECT b.*, (SELECT count(*)::int FROM reference_collection_items ci JOIN bibliography r ON r.id=ci.reference_id WHERE ci.collection_id=b.id AND r.deleted_at IS NULL AND r.merged_into IS NULL) AS count FROM reference_collections b WHERE ${libraryPredicate()} ORDER BY lower(name),id`,
      [user, scope.spaceId],
    );
    const tags = await query(
      `SELECT DISTINCT unnest(b.tags) AS tag FROM bibliography b WHERE ${libraryPredicate()} AND b.deleted_at IS NULL AND b.merged_into IS NULL ORDER BY tag LIMIT 1000`,
      [user, scope.spaceId],
    );
    return json({
      items: rows,
      total: count,
      nextCursor:
        p.cursor + rows.length < count ? String(p.cursor + rows.length) : null,
      collections,
      tags: tags.map((r) => r.tag),
      canEdit,
    });
  }
  if (section === "items" && item && method === "GET") {
    const ref = await referenceAccess(user, id.parse(item));
    if (
      url.searchParams.get("spaceId") &&
      ref.space_id !== url.searchParams.get("spaceId")
    )
      throw new HttpError(404, "Reference unavailable in this workspace.");
    return json({
      ...ref,
      ...(await referenceLinks(user, ref.canonical_id ?? ref.id)),
    });
  }
  if (section === "items" && !item && method === "POST") {
    const input = operationSchema
      .extend({ draft: libraryDraftSchema })
      .strict()
      .parse(await libraryRequestInput(request, user));
    if (!input.mutationId)
      throw new HttpError(400, "A retry identity is required.");
    const result = await libraryWrite(
      user,
      input.scope,
      input.mutationId,
      "create",
      input,
      (c) => insertReference(c, user, input.scope, input.draft),
    );
    await notifyWorkspace();
    return json(result, 201);
  }
  if (section === "items" && item && method === "PATCH") {
    const input = operationSchema
      .extend({
        draft: referenceDetailsSchema.extend({ tags: referenceTagsSchema }),
        version: z.number().int().positive(),
      })
      .strict()
      .parse(await libraryRequestInput(request, user));
    if (!input.mutationId)
      throw new HttpError(400, "A retry identity is required.");
    const result = await libraryWrite(
      user,
      input.scope,
      input.mutationId,
      "edit:" + item,
      input,
      async (c) => {
        const [r] = await lockReferences(
          c,
          user,
          input.scope,
          [id.parse(item)],
          { [item]: input.version },
        );
        if (r.deleted_at)
          throw new HttpError(409, "Restore the reference before editing.");
        const d = input.draft;
        const {
          rows: [next],
        } = await c.query(
          "UPDATE bibliography SET title=$2,authors=$3,year=$4,url=$5,doi=$6,arxiv=$7,venue=$8,tags=$9,bibtex=$10,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
          [
            item,
            d.title,
            d.authors,
            d.year,
            d.url,
            d.doi,
            d.arxiv,
            d.venue,
            d.tags,
            editedBibtex(r, d),
          ],
        );
        await libraryAudit(c, user, input.scope, item, d.title, "update", {
          version: next.version,
        });
        return next;
      },
    );
    await notifyWorkspace();
    return json(result);
  }
  if (
    section === "items" &&
    item &&
    action === "links" &&
    ["POST", "DELETE"].includes(method)
  ) {
    const input = operationSchema
      .extend({
        version: z.number().int().positive(),
        kind: z.enum(["note", "attachment"]),
        targetId: id,
      })
      .strict()
      .parse(await libraryRequestInput(request, user));
    if (!input.mutationId)
      throw new HttpError(400, "A retry identity is required.");
    const attachment =
      input.kind === "attachment"
        ? await fileAccess(user, input.targetId)
        : null;
    const target = attachment ?? (await resourceAccess(user, input.targetId));
    const space = target.space;
    if (space.id !== input.scope.spaceId)
      throw new HttpError(
        400,
        "Choose a source from the same library context.",
      );
    if (attachment && attachment.file.mime !== "application/pdf")
      throw new HttpError(400, "Choose a PDF.");
    if (input.kind === "note" && target.resource.kind !== "note")
      throw new HttpError(400, "Choose a note.");
    const result = await libraryWrite(
      user,
      input.scope,
      input.mutationId,
      method + ":link:" + item,
      input,
      async (c) => {
        await requireScope(c, user, space.id);
        const rid = target.resource.id;
        const {
          rows: [current],
        } = await c.query(
          `SELECT * FROM resources r WHERE r.id=$1 AND r.space_id=$2 AND ${liveResource()} FOR SHARE`,
          [rid, space.id],
        );
        if (!current)
          throw new HttpError(409, "This source moved or was removed.");
        const [r] = await lockReferences(
          c,
          user,
          input.scope,
          [id.parse(item)],
          { [item]: input.version },
        );
        if (r.deleted_at)
          throw new HttpError(409, "Restore the reference before linking.");
        const table =
            input.kind === "note" ? "reference_notes" : "reference_attachments",
          column = input.kind === "note" ? "note_id" : "attachment_id";
        await c.query(
          method === "POST"
            ? `INSERT INTO ${table}(reference_id,${column}) VALUES($1,$2) ON CONFLICT DO NOTHING`
            : `DELETE FROM ${table} WHERE reference_id=$1 AND ${column}=$2`,
          [item, input.targetId],
        );
        await c.query(
          "UPDATE bibliography SET version=version+1,updated_at=now() WHERE id=$1",
          [item],
        );
        await libraryAudit(
          c,
          user,
          input.scope,
          item,
          r.title,
          method === "POST" ? "link" : "unlink",
          { kind: input.kind },
        );
        return { ok: true };
      },
    );
    await notifyWorkspace();
    return json(result);
  }
  if (
    section === "collections" &&
    ["POST", "PATCH", "DELETE"].includes(method)
  ) {
    const input = operationSchema
      .extend({
        name: z.string().trim().min(1).max(100).optional(),
        parentId: id.nullable().optional(),
        version: z.number().int().positive().optional(),
      })
      .strict()
      .parse(await libraryRequestInput(request, user));
    if (!input.mutationId)
      throw new HttpError(400, "A retry identity is required.");
    const result = await libraryWrite(
      user,
      input.scope,
      input.mutationId,
      method + ":collection:" + (item ?? "new"),
      input,
      async (c) => {
        if (input.parentId)
          await collectionAccess(c, user, input.scope, input.parentId);
        if (item && input.parentId) {
          const {
            rows: [cycle],
          } = await c.query(
            `WITH RECURSIVE descendants AS (SELECT id FROM reference_collections WHERE id=$1 UNION SELECT c.id FROM reference_collections c JOIN descendants d ON c.parent_id=d.id) SELECT EXISTS(SELECT 1 FROM descendants WHERE id=$2) AS invalid`,
            [item, input.parentId],
          );
          if (cycle.invalid)
            throw new HttpError(
              400,
              "A collection cannot be placed inside itself or its descendants.",
            );
        }
        if (method === "POST") {
          if (!input.name) throw new HttpError(400, "Name this collection.");
          const {
            rows: [r],
          } = await c.query(
            "INSERT INTO reference_collections(space_id,name,parent_id) VALUES($1,$2,$3) RETURNING *",
            [input.scope.spaceId, input.name, input.parentId ?? null],
          );
          await libraryAudit(
            c,
            user,
            input.scope,
            r.id,
            r.name,
            "create-collection",
            {},
          );
          return r;
        }
        const r = await collectionAccess(c, user, input.scope, id.parse(item));
        if (r.version !== input.version)
          throw new HttpError(
            409,
            "This collection changed. Refresh and try again.",
          );
        if (method === "DELETE")
          await c.query("DELETE FROM reference_collections WHERE id=$1", [
            item,
          ]);
        else
          await c.query(
            "UPDATE reference_collections SET name=$2,parent_id=$3,version=version+1 WHERE id=$1",
            [
              item,
              input.name ?? r.name,
              input.parentId === undefined ? r.parent_id : input.parentId,
            ],
          );
        await libraryAudit(
          c,
          user,
          input.scope,
          r.id,
          r.name,
          method === "DELETE" ? "remove-collection" : "update-collection",
          {},
        );
        return { ok: true };
      },
    );
    await notifyWorkspace();
    return json(result);
  }
  if (section === "batch" && method === "POST") {
    const input = operationSchema
      .extend({
        ids: selection,
        versions,
        operation: z.enum([
          "trash",
          "restore",
          "tag-add",
          "tag-remove",
          "collection-add",
          "collection-remove",
          "reading",
          "export",
        ]),
        tags: referenceTagsSchema.optional(),
        collectionId: id.optional(),
        status: z.enum(["want", "reading", "read", "archived"]).optional(),
        format: z.enum(["bib", "ris"]).optional(),
      })
      .strict()
      .parse(await libraryRequestInput(request, user));
    if (input.operation === "export") {
      await checkLibraryScope(user, input.scope);
      const rows = await query<LibraryReference>(
        `SELECT * FROM reference_catalog b WHERE ${libraryPredicate()} AND id=ANY($3::uuid[])`,
        [user, input.scope.spaceId, input.ids],
      );
      if (rows.length !== input.ids.length)
        throw new HttpError(404, "Some references are unavailable.");
      return exportResponse(rows, input.format ?? "bib");
    }
    if (!input.mutationId)
      throw new HttpError(400, "A retry identity is required.");
    const work = async (c: pg.PoolClient) => {
      await requireLibraryScope(
        c,
        user,
        input.scope,
        input.operation !== "reading",
      );
      const rows = await lockReferences(
        c,
        user,
        input.scope,
        input.ids,
        input.versions,
      );
      if (input.operation.startsWith("collection-"))
        await collectionAccess(
          c,
          user,
          input.scope,
          id.parse(input.collectionId),
        );
      for (const r of rows) {
        if (input.operation === "reading") {
          if (!input.status)
            throw new HttpError(400, "Choose a reading status.");
          await c.query(
            `INSERT INTO reading_items(id,user_id,group_id,kind,target_type,target_id,data,mutation_id) VALUES($1,$2,$3,'reading','reference',$4,$5,$6) ON CONFLICT(user_id,kind,target_type,target_id) WHERE kind IN ('progress','reading') AND NOT deleted DO UPDATE SET data=excluded.data,version=reading_items.version+1,mutation_id=excluded.mutation_id,updated_at=now()`,
            [
              randomUUID(),
              user,
              input.scope.spaceId,
              r.id,
              JSON.stringify({ label: r.title, status: input.status }),
              input.mutationId,
            ],
          );
          continue;
        }
        if (input.operation === "trash" || input.operation === "restore")
          await c.query(
            `UPDATE bibliography SET deleted_at=${input.operation === "trash" ? "now()" : "NULL"},updated_at=now(),version=version+1 WHERE id=$1`,
            [r.id],
          );
        else if (input.operation.startsWith("tag-"))
          await c.query(
            "UPDATE bibliography SET tags=$2,updated_at=now(),version=version+1 WHERE id=$1",
            [
              r.id,
              input.operation === "tag-add"
                ? referenceTagsSchema.parse([
                    ...new Set([...r.tags, ...(input.tags ?? [])]),
                  ])
                : r.tags.filter((t) => !input.tags?.includes(t)),
            ],
          );
        else {
          await c.query(
            input.operation === "collection-add"
              ? "INSERT INTO reference_collection_items(collection_id,reference_id) VALUES($1,$2) ON CONFLICT DO NOTHING"
              : "DELETE FROM reference_collection_items WHERE collection_id=$1 AND reference_id=$2",
            [input.collectionId, r.id],
          );
          await c.query(
            "UPDATE bibliography SET version=version+1,updated_at=now() WHERE id=$1",
            [r.id],
          );
        }
        await libraryAudit(
          c,
          user,
          input.scope,
          r.id,
          r.title,
          input.operation,
          { version: r.version + 1 },
        );
      }
      return { ok: true, count: rows.length };
    };
    await checkLibraryScope(user, input.scope, input.operation !== "reading");
    const result =
      input.operation === "reading"
        ? await workspaceMutation(
            user,
            input.mutationId,
            "library:reading",
            input,
            work,
          )
        : await libraryWrite(
            user,
            input.scope,
            input.mutationId,
            input.operation,
            input,
            work,
          );
    await notifyWorkspace();
    return json(result);
  }
  if (
    ["import", "copy"].includes(section) &&
    ["preview", "apply"].includes(item) &&
    method === "POST"
  ) {
    const input = operationSchema
      .extend({
        source: z.string().max(2_000_000).optional(),
        format: z.enum(["bib", "ris"]).optional(),
        sourceScope: libraryScopeSchema.optional(),
        ids: selection.optional(),
        skipDuplicates: z.boolean().default(true),
        confirmAudience: z.boolean().default(false),
        collectionId: id.optional(),
      })
      .strict()
      .parse(await libraryRequestInput(request, user));
    await checkLibraryScope(user, input.scope, true);
    const prepare = async (c: pg.PoolClient) => {
      let parsed: { items: ReferenceImportItem[]; warnings: string[] },
        sourceRevisions: unknown = [];
      if (section === "copy") {
        if (!input.sourceScope || !input.ids)
          throw new HttpError(400, "Select source references.");
        await requireLibraryScope(c, user, input.sourceScope);
        const sources = await lockReferences(
          c,
          user,
          input.sourceScope,
          input.ids,
        );
        if (sources.some((r) => r.deleted_at))
          throw new HttpError(409, "Restore references before copying.");
        sourceRevisions = sources.map((r) => [r.id, r.version]);
        parsed = {
          items: sources.map((r) => ({
            ...libraryDraftSchema.parse({
              ...fieldsForDraft(r),
              citeKey: r.cite_key,
              tags: r.tags,
            }),
            bibtex: r.bibtex,
            raw: r.bibtex,
          })),
          warnings: [],
        };
      } else {
        try {
          parsed = parseReferenceImport(
            input.source ?? "",
            input.format ?? "bib",
          );
        } catch (e) {
          throw new HttpError(400, (e as Error).message);
        }
      }
      const { rows: existing } = await c.query<LibraryReference>(
        `SELECT id,cite_key,title,identity_keys,merged_into,deleted_at,version FROM bibliography b WHERE ${libraryPredicate()} ORDER BY id LIMIT 50001`,
        [user, input.scope.spaceId],
      );
      if (existing.length > 50000)
        throw new HttpError(
          413,
          "Bulk import is limited to libraries with up to 50,000 references.",
        );
      const identities = new Map<string, { id: string; title: string }>();
      for (const r of existing as (LibraryReference & {
        identity_keys: string[];
      })[])
        if (!r.deleted_at && !r.merged_into)
          for (const key of r.identity_keys) identities.set(key, r);
      const keys = new Set(existing.map((r) => r.cite_key)),
        duplicates: { key: string; id: string; title: string }[] = [],
        items: ReferenceImportItem[] = [];
      for (const r of parsed.items) {
        const identityKeys = referenceIdentityKeys(r);
        const dupe = identityKeys
          .map((key) => identities.get(key))
          .find(Boolean);
        if (dupe) {
          duplicates.push({ key: r.citeKey, id: dupe.id, title: dupe.title });
          if (input.skipDuplicates) continue;
        }
        const original = r.citeKey;
        let suffix = 2;
        while (keys.has(r.citeKey))
          r.citeKey = `${original.slice(0, 90)}-${suffix++}`;
        if (r.citeKey !== original) {
          parsed.warnings.push(`${original} will be imported as ${r.citeKey}.`);
          r.bibtex = renameBibtex(r.bibtex, r.citeKey);
        }
        keys.add(r.citeKey);
        items.push(r);
        for (const key of identityKeys)
          identities.set(key, { id: "", title: r.title });
      }
      const {
        rows: [audience],
      } = await c.query(
        "SELECT EXISTS(SELECT 1 FROM spaces WHERE id=$1 AND kind='personal') AND EXISTS(SELECT 1 FROM spaces WHERE id=$2 AND kind<>'personal') AS private_copy",
        [input.sourceScope?.spaceId ?? null, input.scope.spaceId],
      );
      const privateCopy = section === "copy" && audience.private_copy;
      return {
        items,
        warnings: parsed.warnings,
        duplicates,
        count: items.length,
        privateCopy,
        hash: hash({
          items,
          sourceRevisions,
          existing: existing.map((r) => [r.id, r.version]),
          scope: input.scope,
          collectionId: input.collectionId,
        }),
      };
    };
    if (item === "preview") return json(await transaction(prepare));
    if (!input.mutationId || !input.hash)
      throw new HttpError(400, "Preview this operation first.");
    const result = await libraryWrite(
      user,
      input.scope,
      input.mutationId,
      section,
      input,
      async (c) => {
        const preview = await prepare(c);
        if (preview.hash !== input.hash)
          throw new HttpError(
            409,
            "The library or selected sources changed. Refresh the preview.",
          );
        if (preview.privateCopy && !input.confirmAudience)
          throw new HttpError(
            400,
            "Confirm that private metadata will be copied to the group.",
          );
        if (input.collectionId)
          await collectionAccess(c, user, input.scope, input.collectionId);
        const ids: string[] = [];
        for (const r of preview.items) {
          const created = await insertReference(
            c,
            user,
            input.scope,
            r,
            r,
            section === "copy" ? "copy" : input.format,
          );
          ids.push(created.id);
          if (input.collectionId)
            await c.query(
              "INSERT INTO reference_collection_items(collection_id,reference_id) VALUES($1,$2)",
              [input.collectionId, created.id],
            );
        }
        return { ids, added: ids.length, skipped: preview.duplicates.length };
      },
    );
    await notifyWorkspace();
    return json(result, 201);
  }
  if (
    section === "merge" &&
    ["preview", "apply"].includes(item) &&
    method === "POST"
  ) {
    const input = operationSchema
      .extend({
        ids: z
          .array(id)
          .min(2)
          .max(20)
          .refine((v) => new Set(v).size === v.length),
        targetId: id,
        versions,
        draft: referenceDetailsSchema,
      })
      .strict()
      .parse(await libraryRequestInput(request, user));
    if (!input.ids.includes(input.targetId))
      throw new HttpError(
        400,
        "Choose the retained reference from this selection.",
      );
    await checkLibraryScope(user, input.scope, true);
    const prepare = async (c: pg.PoolClient) => {
      const rows = await lockReferences(
        c,
        user,
        input.scope,
        input.ids,
        input.versions,
      );
      if (rows.some((r) => r.deleted_at))
        throw new HttpError(409, "Restore references before merging.");
      return {
        rows,
        hash: hash({ rows, draft: input.draft, target: input.targetId }),
      };
    };
    if (item === "preview") {
      const p = await transaction(prepare);
      return json({
        hash: p.hash,
        targetId: input.targetId,
        keys: p.rows.map((r) => r.cite_key),
        draft: input.draft,
      });
    }
    if (!input.mutationId || !input.hash)
      throw new HttpError(400, "Review a merge preview first.");
    const result = await libraryWrite(
      user,
      input.scope,
      input.mutationId,
      "merge",
      input,
      async (c) => {
        const p = await prepare(c);
        if (p.hash !== input.hash)
          throw new HttpError(
            409,
            "These references changed. Review the merge again.",
          );
        const others = input.ids.filter((v) => v !== input.targetId),
          target = p.rows.find((r) => r.id === input.targetId)!,
          d = input.draft;
        for (const [table, column] of [
          ["reference_notes", "note_id"],
          ["reference_attachments", "attachment_id"],
        ])
          await c.query(
            `INSERT INTO ${table}(reference_id,${column}) SELECT $1,${column} FROM ${table} WHERE reference_id=ANY($2::uuid[]) ON CONFLICT DO NOTHING`,
            [input.targetId, others],
          );
        await c.query(
          "INSERT INTO reference_collection_items(collection_id,reference_id) SELECT collection_id,$1 FROM reference_collection_items WHERE reference_id=ANY($2::uuid[]) ON CONFLICT DO NOTHING",
          [input.targetId, others],
        );
        // Keep the newest status independently for each reader; never copy it to another user.
        await c.query(
          `INSERT INTO reading_items(id,user_id,group_id,kind,target_type,target_id,data,mutation_id,updated_at) SELECT gen_random_uuid(),r.user_id,r.group_id,'reading','reference',$1,r.data,gen_random_uuid(),r.updated_at FROM (SELECT DISTINCT ON(user_id) * FROM reading_items WHERE target_type='reference' AND kind='reading' AND NOT deleted AND target_id=ANY($2::uuid[]) ORDER BY user_id,updated_at DESC) r ON CONFLICT(user_id,kind,target_type,target_id) WHERE kind IN ('progress','reading') AND NOT deleted DO UPDATE SET data=CASE WHEN excluded.updated_at>reading_items.updated_at THEN excluded.data ELSE reading_items.data END,updated_at=greatest(excluded.updated_at,reading_items.updated_at),version=reading_items.version+1,mutation_id=excluded.mutation_id`,
          [input.targetId, others],
        );
        await c.query(
          "UPDATE reading_items SET deleted=true,version=version+1,updated_at=now() WHERE kind='reading' AND target_type='reference' AND target_id=ANY($1::uuid[]) AND NOT deleted",
          [others],
        );
        await c.query(
          "UPDATE bibliography SET title=$2,authors=$3,year=$4,url=$5,doi=$6,arxiv=$7,venue=$8,tags=$9,bibtex=$10,version=version+1,updated_at=now() WHERE id=$1",
          [
            input.targetId,
            d.title,
            d.authors,
            d.year,
            d.url,
            d.doi,
            d.arxiv,
            d.venue,
            referenceTagsSchema.parse([
              ...new Set(p.rows.flatMap((r) => r.tags)),
            ]),
            editedBibtex(target, d),
          ],
        );
        await c.query(
          "UPDATE bibliography SET merged_into=$1,version=version+1,updated_at=now() WHERE merged_into=ANY($2::uuid[])",
          [input.targetId, others],
        );
        await c.query(
          "UPDATE bibliography SET merged_into=$1,version=version+1,updated_at=now() WHERE id=ANY($2::uuid[])",
          [input.targetId, others],
        );
        await libraryAudit(
          c,
          user,
          input.scope,
          input.targetId,
          d.title,
          "merge",
          { retainedKeys: p.rows.map((r) => r.cite_key) },
        );
        return { id: input.targetId };
      },
    );
    await notifyWorkspace();
    return json(result);
  }
  return json({ error: "Unknown library action." }, 405);
}
function fieldsForDraft(r: LibraryReference) {
  return {
    title: r.title,
    authors: r.authors,
    year: r.year,
    url: r.url,
    doi: r.doi,
    arxiv: r.arxiv,
    venue: r.venue,
  };
}
function exportResponse(rows: LibraryReference[], format: "bib" | "ris") {
  return new Response(
    rows
      .map((r) => (format === "bib" ? formatBibtex(r) : formatRis(r)))
      .join("\n\n"),
    {
      headers: {
        "content-type":
          format === "bib"
            ? "application/x-bibtex"
            : "application/x-research-info-systems",
        "content-disposition": `attachment; filename="references.${format}"`,
        "cache-control": "private, no-store",
      },
    },
  );
}

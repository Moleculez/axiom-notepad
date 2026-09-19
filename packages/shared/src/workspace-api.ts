import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query } from "./db";
import { fileRoute } from "./file-routes";
import {
  HttpError,
  fileAccess,
  noteAccess,
  resourceAccess,
  spaceAccess,
} from "./access";
import { createNote, notifyWorkspace } from "./documents";
import {
  resourceNameSchema,
  resourceKindSchema,
  type Resource,
  type ResourceLocation,
} from "./workspace";
import {
  workspaceJson as json,
  workspaceMutation,
  requireScope,
  recordActivity,
  assertRevision,
} from "./workspace-service";

const uuid = z.uuid();
const mutationId = uuid.default(() => randomUUID());
const rowFields = `r.*,a.mime,a.bytes,coalesce((SELECT t.kind FROM tool_projects t WHERE t.resource_id=r.id),CASE WHEN r.kind='note' THEN 'markdown' END) AS document_type,(SELECT p.color FROM resource_personalization p WHERE p.user_id=$1 AND p.resource_id=r.id) AS folder_color,EXISTS(SELECT 1 FROM resource_favorites f WHERE f.user_id=$1 AND f.resource_id=r.id) AS favorite,EXISTS(SELECT 1 FROM resources c WHERE c.parent_id=r.id AND c.deleted_at IS NULL) AS has_children,axiom_space_role($1,r.space_id) AS role`;
const fileJoin = "LEFT JOIN attachments a ON a.id=r.current_version_id";
const live = `r.deleted_at IS NULL AND NOT EXISTS(WITH RECURSIVE parents AS (SELECT id,parent_id,deleted_at FROM resources WHERE id=r.parent_id UNION SELECT p.id,p.parent_id,p.deleted_at FROM resources p JOIN parents x ON x.parent_id=p.id) SELECT 1 FROM parents WHERE deleted_at IS NOT NULL)`;
const permitted = "axiom_space_role($1,r.space_id) IS NOT NULL";

export async function workspaceApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  const [endpoint, id, action] = path,
    method = request.method,
    url = new URL(request.url);
  if (
    endpoint === "attachments" &&
    id &&
    action === "resource" &&
    method === "GET"
  ) {
    const { resource } = await fileAccess(userId, uuid.parse(id));
    return json({
      id: resource.id,
      space_id: resource.space_id,
      name: resource.name,
    });
  }
  if (endpoint === "notes" && id && action === "context" && method === "GET") {
    const note = await noteAccess(userId, uuid.parse(id)),
      space = await spaceAccess(userId, note.space_id!);
    const [notes, references, members, links] = await Promise.all([
      query(
        "SELECT n.id,n.title,n.project_id,n.tags,n.visibility FROM notes n JOIN resources r ON r.note_id=n.id WHERE r.space_id=$2 AND axiom_can_read_note($1,n.id) AND n.deleted_at IS NULL ORDER BY n.updated_at DESC LIMIT 200",
        [userId, space.id],
      ),
      query(
        "SELECT data.* FROM personal_citations c CROSS JOIN LATERAL jsonb_to_record(c.data) AS data(cite_key text,title text,authors text,year text,url text,bibtex text) WHERE c.note_id=$1 UNION ALL SELECT b.cite_key,b.title,b.authors,b.year,b.url,b.bibtex FROM bibliography b WHERE b.group_id=$2 AND NOT EXISTS(SELECT 1 FROM personal_citations c WHERE c.note_id=$1 AND c.cite_key=b.cite_key) LIMIT 2000",
        [id, space.group_id],
      ),
      space.group_id
        ? query(
            'SELECT u.id,u.name,m.role AS group_role,axiom_space_role(u.id,$2) AS role FROM members m JOIN "user" u ON u.id=m.user_id WHERE m.group_id=$1 AND axiom_space_role(u.id,$2) IS NOT NULL ORDER BY u.name LIMIT 200',
            [space.group_id, space.id],
          )
        : [],
      query(
        "SELECT l.*,n.title AS source_title,t.title AS target_title FROM note_links l JOIN notes n ON n.id=l.source_id LEFT JOIN notes t ON t.id=l.target_id WHERE (l.source_id=$2 OR l.target_id=$2) AND axiom_can_read_note($1,l.source_id) AND (l.target_id IS NULL OR axiom_can_read_note($1,l.target_id)) LIMIT 200",
        [userId, id],
      ),
    ]);
    return json({ space, notes, references, members, links });
  }
  if (endpoint === "spaces" && method === "GET") {
    if (id) return json(await spaceAccess(userId, uuid.parse(id)));
    return json(
      await query(
        `SELECT s.*,g.name AS group_name,p.audience,axiom_space_role($1,s.id) AS role,axiom_manage_space($1,s.id) AS can_manage FROM spaces s LEFT JOIN groups g ON g.id=s.group_id LEFT JOIN projects p ON p.id=s.project_id WHERE axiom_space_role($1,s.id) IS NOT NULL ORDER BY CASE s.kind WHEN 'personal' THEN 0 ELSE 1 END,g.name,s.name`,
        [userId],
      ),
    );
  }
  if (endpoint === "dashboard" && method === "GET") {
    const [recent, tasks, reviews, totals] = await Promise.all([
      query(
        `SELECT ${rowFields} FROM resources r ${fileJoin} JOIN resource_recents x ON x.resource_id=r.id AND x.user_id=$1 WHERE ${permitted} AND ${live} ORDER BY x.opened_at DESC LIMIT 12`,
        [userId],
      ),
      query(
        `SELECT t.*,s.name AS project_name FROM tasks t JOIN spaces s ON s.id=t.space_id WHERE t.assignee_id=$1 AND t.deleted_at IS NULL AND t.status NOT IN ('done','cancelled') AND axiom_space_role($1,s.id) IS NOT NULL ORDER BY t.due_on NULLS LAST,t.updated_at DESC LIMIT 20`,
        [userId],
      ),
      query(
        `SELECT v.*,n.title AS note_title FROM review_requests v JOIN notes n ON n.id=v.note_id WHERE v.reviewer_id=$1 AND v.status='pending' AND axiom_can_read_note($1,n.id) ORDER BY v.created_at DESC LIMIT 10`,
        [userId],
      ),
      query(
        `SELECT count(*)::int AS resources,count(*) FILTER(WHERE r.kind='note')::int AS notes,count(*) FILTER(WHERE r.kind='file')::int AS files FROM resources r WHERE ${permitted} AND ${live}`,
        [userId],
      ),
    ]);
    return json({ recent, tasks, reviews, totals: totals[0] });
  }
  if (endpoint === "resources" && !id && method === "GET") {
    const spaceId = url.searchParams.get("spaceId"),
      parentId = url.searchParams.get("parentId"),
      view = z
        .enum(["folder", "all", "recent", "favorites", "trash"])
        .parse(url.searchParams.get("view") ?? "folder");
    const kind = url.searchParams.get("kind"),
      search = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .parse(url.searchParams.get("limit") ?? 60);
    if (spaceId) await spaceAccess(userId, uuid.parse(spaceId));
    if (parentId) {
      const parent = await resourceAccess(userId, uuid.parse(parentId));
      if (spaceId && parent.resource.space_id !== spaceId)
        throw new HttpError(400, "Folder and space do not match.");
    }
    const sort = z
      .enum(["name", "updated", "size"])
      .parse(url.searchParams.get("sort") ?? "name");
    const direction =
      url.searchParams.get("direction") === "desc" ? "DESC" : "ASC";
    const column = {
      name: "lower(r.name)",
      updated: "r.updated_at",
      size: "coalesce(a.bytes,0)",
    }[sort];
    const values: unknown[] = [userId];
    const bind = (value: unknown) => {
      values.push(value);
      return "$" + values.length;
    };
    const where = [
      permitted,
      view === "trash" ? "r.deleted_at IS NOT NULL" : live,
    ];
    if (spaceId) where.push("r.space_id=" + bind(spaceId));
    if (kind) where.push("r.kind=" + bind(resourceKindSchema.parse(kind)));
    const mime = url.searchParams.get("mime"),
      tag = url.searchParams.get("tag");
    if (mime)
      where.push(
        "a.mime LIKE " +
          bind(z.string().max(100).parse(mime).replace(/[%_]/g, "") + "%"),
      );
    if (tag) where.push(bind(z.string().max(40).parse(tag)) + "=ANY(r.tags)");
    for (const key of ["after", "before"] as const) {
      const value = url.searchParams.get(key);
      if (value) {
        const date = z.iso.date().parse(value);
        where.push(
          `r.updated_at ${key === "after" ? ">=" : "<"} ${bind(date)}::date${key === "before" ? " + interval '1 day'" : ""}`,
        );
      }
    }
    for (const key of ["minSize", "maxSize"] as const) {
      const value = url.searchParams.get(key);
      if (value)
        where.push(
          `a.bytes ${key === "minSize" ? ">=" : "<="} ${bind(z.coerce.number().int().min(0).max(1e12).parse(value))}`,
        );
    }
    if (view === "folder" && !search)
      where.push(
        parentId ? "r.parent_id=" + bind(parentId) : "r.parent_id IS NULL",
      );
    if (view === "favorites")
      where.push(
        "EXISTS(SELECT 1 FROM resource_favorites f WHERE f.resource_id=r.id AND f.user_id=$1)",
      );
    if (view === "recent")
      where.push(
        "EXISTS(SELECT 1 FROM resource_recents x WHERE x.resource_id=r.id AND x.user_id=$1)",
      );
    if (search) {
      const param = bind(search);
      where.push(
        `(r.name ILIKE '%'||${param}||'%' OR r.description ILIKE '%'||${param}||'%' OR array_to_string(r.tags,' ') ILIKE '%'||${param}||'%' OR EXISTS(SELECT 1 FROM notes n WHERE n.id=r.note_id AND to_tsvector('simple',n.title||' '||n.plain_text) @@ plainto_tsquery('simple',${param})))`,
      );
    }
    const encoded = url.searchParams.get("cursor");
    if (encoded) {
      let raw: unknown;
      try {
        if (encoded.length > 1600) throw new Error();
        raw = JSON.parse(Buffer.from(encoded, "base64url").toString());
      } catch {
        throw new HttpError(400, "Invalid page cursor.");
      }
      const cursor = z
        .object({
          sort: z.literal(sort),
          direction: z.literal(direction),
          value: z.union([z.string().max(500), z.number()]),
          id: uuid,
        })
        .parse(raw);
      const value = bind(cursor.value),
        identity = bind(cursor.id);
      where.push(
        `(${column},r.id) ${direction === "ASC" ? ">" : "<"} (${value},${identity}::uuid)`,
      );
    }
    const rows = await query<Resource & { cursor_value: string | number }>(
      `SELECT ${rowFields},${column}::text AS cursor_value FROM resources r ${fileJoin} WHERE ${where.join(" AND ")} ORDER BY ${column} ${direction},r.id ${direction} LIMIT ${bind(limit + 1)}`,
      values,
    );
    const items = rows.slice(0, limit),
      last = items.at(-1);
    const breadcrumbs = parentId
      ? await query(
          `WITH RECURSIVE trail AS (SELECT id,name,kind,parent_id,0 AS depth FROM resources WHERE id=$2 AND axiom_space_role($1,space_id) IS NOT NULL UNION ALL SELECT r.id,r.name,r.kind,r.parent_id,t.depth+1 FROM resources r JOIN trail t ON r.id=t.parent_id WHERE t.depth<100 AND axiom_space_role($1,r.space_id) IS NOT NULL) SELECT id,name,kind FROM trail ORDER BY depth DESC`,
          [userId, parentId],
        )
      : [];
    return json({
      items,
      breadcrumbs,
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({
                sort,
                direction,
                value: last.cursor_value,
                id: last.id,
              }),
            ).toString("base64url")
          : null,
    });
  }
  if (endpoint === "resources" && !id && method === "POST") {
    const input = z
      .object({
        mutationId,
        id: uuid.optional(),
        spaceId: uuid,
        parentId: uuid.nullable().default(null),
        kind: z.enum(["folder", "note"]),
        name: resourceNameSchema,
        body: z.string().max(1_000_000).default(""),
        initialState: z.string().max(8_000_000).optional(),
      })
      .parse(await request.json());
    const space = await spaceAccess(userId, input.spaceId, "edit");
    const result = await workspaceMutation(
      userId,
      input.mutationId,
      "create-resource",
      input,
      async (client) => {
        await requireScope(client, userId, input.spaceId, "edit");
        if (input.parentId) {
          const {
            rows: [parent],
          } = await client.query("SELECT * FROM resources WHERE id=$1", [
            input.parentId,
          ]);
          if (
            !parent ||
            parent.space_id !== input.spaceId ||
            parent.kind !== "folder" ||
            parent.deleted_at
          )
            throw new HttpError(
              400,
              "Choose an available folder in this space.",
            );
        }
        let resource: Resource;
        if (input.kind === "note") {
          const note = await createNote(
            {
              userId,
              id: input.id,
              initialState: input.initialState,
              groupId: space.group_id,
              projectId: space.project_id,
              visibility: space.kind === "personal" ? "private" : "shared",
              title: input.name,
              body: input.body,
            },
            client,
          );
          const {
            rows: [row],
          } = await client.query(
            "UPDATE resources SET parent_id=$2 WHERE id=$1 RETURNING *",
            [note.id, input.parentId],
          );
          resource = row;
        } else {
          const {
            rows: [row],
          } = await client.query(
            "INSERT INTO resources(space_id,parent_id,kind,name,owner_id,id) VALUES($1,$2,'folder',$3,$4,coalesce($5::uuid,gen_random_uuid())) RETURNING *",
            [
              input.spaceId,
              input.parentId,
              input.name,
              userId,
              input.id ?? null,
            ],
          );
          resource = row;
        }
        await recordActivity(client, {
          spaceId: input.spaceId,
          userId,
          kind: "created",
          title: `Created ${input.name}`,
          resourceId: resource.id,
        });
        return resource;
      },
    );
    await notifyWorkspace();
    return json(result, 201);
  }
  if (endpoint === "resources" && id) {
    uuid.parse(id);
    const { resource, space } = await resourceAccess(
      userId,
      id,
      "read",
      action !== "location",
    );
    if (action === "location" && method === "GET") {
      // Recheck the scope in the same query as the ancestry: a concurrent
      // cross-space move must not expose names from a newly private location.
      const trail = await query<ResourceLocation["resource"]>(
        `WITH RECURSIVE trail AS (
          SELECT r.id,r.space_id,r.parent_id,r.name,r.kind,0 AS depth,ARRAY[r.id] AS seen
          FROM resources r WHERE r.id=$2 AND r.space_id=$3 AND ${permitted} AND ${live}
          UNION ALL
          SELECT r.id,r.space_id,r.parent_id,r.name,r.kind,t.depth+1,t.seen||r.id
          FROM resources r JOIN trail t ON r.id=t.parent_id
          WHERE r.space_id=t.space_id AND ${permitted} AND r.deleted_at IS NULL
            AND t.depth<100 AND NOT r.id=ANY(t.seen)
        ) SELECT id,space_id,parent_id,name,kind FROM trail ORDER BY depth DESC`,
        [userId, id, space.id],
      );
      if (!trail.length)
        throw new HttpError(404, "This item's location is unavailable.");
      if (trail[0].parent_id)
        throw new HttpError(409, "The folder path is incomplete or too deep.");
      return json({
        resource: trail.at(-1)!,
        space: { id: space.id, name: space.name, kind: space.kind },
        ancestors: trail
          .slice(0, -1)
          .map(({ id, name, kind }) => ({ id, name, kind })),
      } satisfies ResourceLocation);
    }
    if (!action && method === "GET") {
      const [row] = await query(
        `SELECT ${rowFields} FROM resources r ${fileJoin} WHERE r.id=$2`,
        [userId, id],
      );
      return json({ ...row, space });
    }
    if (action === "access" && method === "GET") {
      const search = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
      const page = Math.min(
        10000,
        Math.max(0, Number(url.searchParams.get("page")) || 0),
      );
      const members = space.group_id
        ? await query(
            `SELECT u.id,u.name,u.image,m.role AS group_role,axiom_space_role(u.id,$2) AS role
         FROM members m JOIN "user" u ON u.id=m.user_id
         WHERE m.group_id=$1 AND axiom_space_role(u.id,$2) IS NOT NULL
           AND ($3='' OR position(lower($3) in lower(u.name))>0)
           AND EXISTS(SELECT 1 FROM resources r WHERE r.id=$4 AND r.space_id=$2 AND axiom_space_role($5,r.space_id) IS NOT NULL)
         ORDER BY lower(u.name),u.id LIMIT 51 OFFSET $6`,
            [
              space.group_id,
              space.id,
              search,
              resource.id,
              userId,
              Math.floor(page) * 50,
            ],
          )
        : [];
      // Revalidate before returning identity information after a concurrent move/revocation.
      const current = await resourceAccess(userId, id, "read", true);
      if (current.space.id !== space.id)
        throw new HttpError(
          409,
          "This file moved. Reopen sharing to refresh its access.",
        );
      const [row] = await query<Resource>(
        `SELECT ${rowFields} FROM resources r ${fileJoin} WHERE r.id=$2 AND r.space_id=$3 AND ${permitted}`,
        [userId, id, space.id],
      );
      if (!row) throw new HttpError(404, "This file is unavailable.");
      return json({
        resource: { id: resource.id, name: resource.name },
        path: fileRoute(row),
        space: current.space,
        members: members.slice(0, 50),
        nextPage: members.length > 50 ? Math.floor(page) + 1 : null,
      });
    }
    if (action === "opened" && method === "POST") {
      await query(
        "INSERT INTO resource_recents(user_id,resource_id) VALUES($1,$2) ON CONFLICT(user_id,resource_id) DO UPDATE SET opened_at=now()",
        [userId, id],
      );
      return json({ ok: true });
    }
    if (action === "favorite" && method === "POST") {
      const input = z
        .object({ favorite: z.boolean() })
        .parse(await request.json());
      if (input.favorite)
        await query(
          "INSERT INTO resource_favorites(user_id,resource_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [userId, id],
        );
      else
        await query(
          "DELETE FROM resource_favorites WHERE user_id=$1 AND resource_id=$2",
          [userId, id],
        );
      if (resource.kind === "note") {
        if (input.favorite)
          await query(
            "INSERT INTO favorites(user_id,note_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
            [userId, id],
          );
        else
          await query("DELETE FROM favorites WHERE user_id=$1 AND note_id=$2", [
            userId,
            id,
          ]);
      }
      return json(input);
    }
    if (!action && method === "PATCH") {
      const input = z
        .object({
          mutationId,
          version: z.number().int().positive(),
          name: resourceNameSchema.optional(),
          description: z.string().max(3000).optional(),
          tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
          parentId: uuid.nullable().optional(),
        })
        .parse(await request.json());
      await spaceAccess(userId, resource.space_id, "edit");
      const result = await workspaceMutation(
        userId,
        input.mutationId,
        "update-resource:" + id,
        input,
        async (client) => {
          await requireScope(client, userId, resource.space_id, "edit");
          const {
            rows: [current],
          } = await client.query(
            "SELECT * FROM resources WHERE id=$1 FOR UPDATE",
            [id],
          );
          assertRevision(current.version, input.version);
          if (current.deleted_at)
            throw new HttpError(409, "Restore this item before editing it.");
          await client.query(
            "SELECT set_config('axiom.resource_write','1',true)",
          );
          const {
            rows: [row],
          } = await client.query(
            "UPDATE resources SET name=$2,description=$3,tags=$4,parent_id=$5,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
            [
              id,
              input.name ?? current.name,
              input.description ?? current.description,
              input.tags ?? current.tags,
              input.parentId === undefined ? current.parent_id : input.parentId,
            ],
          );
          if (current.note_id)
            await client.query(
              "UPDATE notes SET title=$2,tags=$3,version=version+1,updated_at=now() WHERE id=$1",
              [id, row.name, row.tags],
            );
          await recordActivity(client, {
            spaceId: resource.space_id,
            userId,
            kind: "updated",
            title: `Updated ${row.name}`,
            resourceId: id,
          });
          return row;
        },
      );
      await notifyWorkspace();
      return json(result);
    }
    if (["trash", "restore"].includes(action) && method === "POST") {
      const input = z
        .object({ mutationId, version: z.number().int().positive() })
        .parse(await request.json());
      await spaceAccess(userId, resource.space_id, "edit");
      const result = await workspaceMutation(
        userId,
        input.mutationId,
        action + ":" + id,
        input,
        async (client) => {
          await requireScope(client, userId, resource.space_id, "edit");
          const {
            rows: [current],
          } = await client.query(
            "SELECT * FROM resources WHERE id=$1 FOR UPDATE",
            [id],
          );
          assertRevision(current.version, input.version);
          await client.query(
            "SELECT set_config('axiom.resource_write','1',true)",
          );
          const subtree =
            "WITH RECURSIVE tree AS (SELECT id FROM resources WHERE id=$1 UNION ALL SELECT r.id FROM resources r JOIN tree t ON r.parent_id=t.id)";
          const changed =
            action === "trash"
              ? await client.query(
                  `${subtree} UPDATE resources SET deleted_at=now(),version=version+1 WHERE id IN (SELECT id FROM tree) AND deleted_at IS NULL RETURNING id,note_id`,
                  [id],
                )
              : await client.query(
                  `${subtree} UPDATE resources SET deleted_at=NULL,version=version+1 WHERE id IN (SELECT id FROM tree) AND deleted_at=(SELECT deleted_at FROM resources WHERE id=$1) RETURNING id,note_id`,
                  [id],
                );
          if (action === "restore")
            await client.query(
              "UPDATE resources SET parent_id=NULL WHERE id=$1 AND EXISTS(SELECT 1 FROM resources p WHERE p.id=resources.parent_id AND p.deleted_at IS NOT NULL)",
              [id],
            );
          const ids = changed.rows.filter((r) => r.note_id).map((r) => r.id);
          if (ids.length)
            await client.query(
              `UPDATE notes SET deleted_at=${action === "trash" ? "now()" : "NULL"},version=version+1 WHERE id=ANY($1::uuid[])`,
              [ids],
            );
          await recordActivity(client, {
            spaceId: resource.space_id,
            userId,
            kind: action,
            title: `${action === "trash" ? "Moved to trash" : "Restored"}: ${resource.name}`,
            resourceId: id,
          });
          // Keep the resulting revision inside the idempotent receipt so Undo
          // never guesses at a later collaborator's version after a retry.
          const {
            rows: [resultResource],
          } = await client.query(
            "SELECT id,name,version,space_id,parent_id,kind FROM resources WHERE id=$1",
            [id],
          );
          return {
            ok: true,
            count: changed.rowCount,
            resource: resultResource,
          };
        },
      );
      await notifyWorkspace(true);
      return json(result);
    }
    if (action === "activity" && method === "GET")
      return json(
        await query(
          'SELECT a.*,u.name AS actor_name FROM workspace_activity a LEFT JOIN "user" u ON u.id=a.actor_id WHERE a.resource_id=$1 AND a.space_id=$2 ORDER BY a.created_at DESC LIMIT 50',
          [id, resource.space_id],
        ),
      );
  }
  if (endpoint === "inbox") {
    if (method === "GET")
      return json(
        await query(
          `SELECT e.* FROM inbox_events e WHERE e.user_id=$1 AND axiom_space_role($1,e.space_id) IS NOT NULL ORDER BY e.created_at DESC LIMIT 100`,
          [userId],
        ),
      );
    if (method === "POST") {
      const input = z
        .object({
          ids: z.array(uuid).max(100).optional(),
          read: z.boolean().default(true),
        })
        .parse(await request.json());
      await query(
        `UPDATE inbox_events SET read_at=${input.read ? "now()" : "NULL"} WHERE user_id=$1 ${input.ids ? "AND id=ANY($2::uuid[])" : ""}`,
        input.ids ? [userId, input.ids] : [userId],
      );
      return json({ ok: true });
    }
  }
  if (endpoint === "saved-views") {
    if (method === "GET")
      return json(
        await query(
          "SELECT * FROM saved_views WHERE user_id=$1 ORDER BY name",
          [userId],
        ),
      );
    if (method === "POST") {
      const input = z
        .object({
          name: resourceNameSchema,
          filters: z.object({
            spaceId: uuid.optional(),
            q: z.string().max(200).optional(),
            kind: resourceKindSchema.optional(),
            view: z
              .enum(["all", "recent", "favorites", "folder"])
              .default("all"),
          }),
        })
        .parse(await request.json());
      return json(
        (
          await query(
            "INSERT INTO saved_views(user_id,name,filters) VALUES($1,$2,$3) RETURNING *",
            [userId, input.name, JSON.stringify(input.filters)],
          )
        )[0],
        201,
      );
    }
    if (id && method === "DELETE") {
      await query("DELETE FROM saved_views WHERE id=$1 AND user_id=$2", [
        uuid.parse(id),
        userId,
      ]);
      return json({ ok: true });
    }
  }
  return null;
}

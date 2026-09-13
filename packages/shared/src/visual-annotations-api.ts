import { createHash } from "node:crypto";
import { z } from "zod";
import { HttpError, resourceAccess } from "./access";
import { query, transaction } from "./db";
import { notifyWorkspace } from "./documents";
import {
  assertSpaceActive,
  requireScope,
  workspaceJson as json,
} from "./workspace-service";
import {
  samePlacement,
  sameVisualSource,
  visualWriteSchema,
  type VisualAnnotation,
  type VisualWrite,
} from "./visual-annotations";

type Row = {
  id: string;
  resource_id: string;
  author_id: string;
  author_name: string;
  parent_id: string | null;
  data: VisualWrite;
  visibility: "private" | "shared";
  version: number;
  mutation_id: string;
  mutation_hash: string;
  deleted: boolean;
  created_at: string;
  updated_at: string;
};
function present(r: Row, visibility = r.visibility): VisualAnnotation {
  return {
    ...r.data,
    id: r.id,
    authorId: r.author_id,
    authorName: r.author_name,
    parentId: r.parent_id,
    version: r.version,
    mutationId: r.mutation_id,
    visibility,
    deleted: r.deleted,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(r.deleted ? { shape: null, body: "" } : {}),
  };
}
const missing = () =>
  new HttpError(404, "This visual annotation is unavailable.");
export async function visualAnnotationsApi(
  request: Request,
  path: string[],
  user: { id: string; name: string },
) {
  const [endpoint, id, action] = path;
  const collection =
    endpoint === "resources" &&
    action === "visual-annotations" &&
    path.length === 3;
  const entry = endpoint === "visual-annotations" && path.length === 2;
  if (!collection && !entry) return null;
  z.uuid().parse(id);
  const [initial] = entry
    ? await query<Row>(
        'SELECT a.*,u.name AS author_name FROM visual_annotations a JOIN "user" u ON u.id=a.author_id WHERE a.id=$1',
        [id],
      )
    : [];
  if (
    entry &&
    (!initial ||
      (initial.visibility === "private" && initial.author_id !== user.id))
  )
    throw missing();
  const resourceId = collection ? id : initial.resource_id;
  const { resource, space } = await resourceAccess(user.id, resourceId);
  if (
    space.effective_status === "trashed" ||
    space.effective_status === "purging"
  )
    throw missing();
  if (collection && request.method === "GET") {
    const rows = await query<Row & { root_visibility: Row["visibility"] }>(
      `SELECT a.*,u.name AS author_name,root.visibility AS root_visibility
       FROM visual_annotations a JOIN visual_annotations root ON root.id=coalesce(a.parent_id,a.id)
       JOIN "user" u ON u.id=a.author_id
       LEFT JOIN file_versions v ON v.id=(a.data->'placement'->>'versionId')::uuid
       LEFT JOIN resources ref ON ref.id=v.resource_id
       WHERE a.resource_id=$1 AND (root.visibility='shared' OR root.author_id=$2)
       AND (a.data->'placement'->>'versionId' IS NULL OR
         (ref.deleted_at IS NULL AND axiom_space_role($2,ref.space_id) IS NOT NULL
          AND axiom_space_state(ref.space_id) IN ('active','archived')))
       ORDER BY a.created_at,a.id LIMIT 5000`,
      [resourceId, user.id],
    );
    return json(rows.map((r) => present(r, r.root_visibility)));
  }
  if (
    !(collection && request.method === "POST") &&
    !(entry && ["PATCH", "DELETE"].includes(request.method))
  )
    return json({ error: "Method not allowed." }, 405);
  const input = visualWriteSchema.parse({
    ...(await request.json()),
    ...(request.method === "DELETE" ? { deleted: true } : {}),
  });
  if (input.placement.resourceId !== resourceId || (entry && input.id !== id))
    throw new HttpError(
      400,
      "Annotation placement does not match its resource.",
    );
  const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const result = await transaction(async (client) => {
    await requireScope(client, user.id, resource.space_id, "read");
    await assertSpaceActive(client, resource.space_id);
    const {
      rows: [locked],
    } = await client.query(
      "SELECT space_id,deleted_at FROM resources WHERE id=$1 FOR SHARE",
      [resourceId],
    );
    if (!locked || locked.deleted_at || locked.space_id !== resource.space_id)
      throw missing();
    if (input.placement.versionId) {
      const {
        rows: [ref],
      } = await client.query(
        "SELECT r.id,r.space_id,r.deleted_at FROM file_versions v JOIN resources r ON r.id=v.resource_id WHERE v.id=$1 FOR SHARE OF r",
        [input.placement.versionId],
      );
      if (
        !ref ||
        ref.deleted_at ||
        (resource.kind === "file" && ref.id !== resourceId)
      )
        throw missing();
      await requireScope(client, user.id, ref.space_id, "read");
      if (!input.deleted) await assertSpaceActive(client, ref.space_id);
    }
    if (input.placement.anchor && !input.deleted && resource.note_id) {
      const {
        rows: [note],
      } = await client.query("SELECT generation FROM notes WHERE id=$1", [
        resource.note_id,
      ]);
      if (!note || note.generation !== input.placement.anchor.generation)
        throw new HttpError(
          409,
          "The document was restored or replaced. Review the current placement before attaching this draft.",
        );
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      input.id,
    ]);
    const {
      rows: [old],
    } = await client.query<Row>(
      'SELECT a.*,u.name AS author_name FROM visual_annotations a JOIN "user" u ON u.id=a.author_id WHERE a.id=$1 FOR UPDATE OF a',
      [input.id],
    );
    if (
      old &&
      (old.resource_id !== resourceId ||
        old.parent_id !== input.parentId ||
        (old.visibility === "private" && old.author_id !== user.id))
    )
      throw missing();
    if (old?.mutation_id === input.mutationId && old.mutation_hash === hash)
      return { record: present(old) };
    if ((old?.version ?? 0) !== input.version)
      return { conflict: old ? present(old) : null };
    if (!old) {
      // Keep the bounded collection response complete, never silently truncate.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "visual-capacity:" + resourceId,
      ]);
      const {
        rows: [count],
      } = await client.query(
        "SELECT count(*)::int AS n FROM visual_annotations WHERE resource_id=$1",
        [resourceId],
      );
      if (count.n >= 5000)
        throw new HttpError(
          409,
          "This document has reached its 5,000 visual annotation entry limit.",
        );
    }
    if (old && old.author_id !== user.id) {
      if (!input.deleted)
        throw new HttpError(403, "Only the author can edit this annotation.");
      await requireScope(client, user.id, resource.space_id, "manage");
    }
    const {
      rows: [root],
    } = input.parentId
      ? await client.query<Row>(
          "SELECT * FROM visual_annotations WHERE id=$1 AND resource_id=$2 AND parent_id IS NULL FOR UPDATE",
          [input.parentId, resourceId],
        )
      : { rows: [] };
    if (
      input.parentId &&
      (!root || root.visibility !== "shared" || root.deleted)
    )
      throw missing();
    if (
      root &&
      (!samePlacement(input.placement, root.data.placement) ||
        !sameVisualSource(input.source, root.data.source) ||
        input.shape)
    )
      throw new HttpError(400, "Replies belong to their original region.");
    const visibility = root?.visibility ?? input.visibility;
    if (visibility === "shared")
      await requireScope(client, user.id, resource.space_id, "comment");
    if (visibility === "shared" && space.kind === "personal")
      throw new HttpError(400, "Personal-space annotations cannot be shared.");
    if (old?.visibility === "shared" && visibility === "private") {
      const {
        rows: [reply],
      } = await client.query(
        "SELECT id FROM visual_annotations WHERE parent_id=$1 AND NOT deleted LIMIT 1",
        [input.id],
      );
      if (reply)
        throw new HttpError(
          409,
          "A shared annotation with replies cannot be made private.",
        );
    }
    const data = old && old.author_id !== user.id ? old.data : input;
    const {
      rows: [row],
    } = await client.query<Row>(
      `INSERT INTO visual_annotations(id,resource_id,author_id,parent_id,data,visibility,mutation_id,mutation_hash,deleted) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET data=excluded.data,visibility=excluded.visibility,mutation_id=excluded.mutation_id,mutation_hash=excluded.mutation_hash,deleted=excluded.deleted,version=visual_annotations.version+1,updated_at=now() RETURNING *`,
      [
        input.id,
        resourceId,
        old?.author_id ?? user.id,
        input.parentId,
        data,
        old && old.author_id !== user.id ? old.visibility : visibility,
        input.mutationId,
        hash,
        input.deleted,
      ],
    );
    return {
      record: present({ ...row, author_name: old?.author_name ?? user.name }),
      shared: visibility === "shared" || old?.visibility === "shared",
    };
  });
  if ("conflict" in result)
    return json(
      {
        error: "This annotation changed. Your draft was retained.",
        current: result.conflict,
      },
      409,
    );
  if (result.shared) await notifyWorkspace();
  return json(result.record);
}

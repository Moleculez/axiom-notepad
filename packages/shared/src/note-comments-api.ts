import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { query, transaction } from "./db";
import { HttpError, noteAccess } from "./access";
import {
  assertSpaceActive,
  requireNoteScope,
  requireScope,
} from "./workspace-service";
import { notifyWorkspace } from "./documents";
import {
  commentCreateSchema,
  commentPatchSchema,
  visibleThread,
  type NoteComment,
} from "./note-comments";

const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
const unavailable = () => new HttpError(404, "This discussion is unavailable.");
type RecordRow = NoteComment & { mutation_hash: string | null };
function present(row: RecordRow, root: RecordRow = row): NoteComment {
  const { mutation_hash: _hash, ...item } = row;
  return {
    ...item,
    visibility: root.visibility,
    ...(row.deleted
      ? { body: "", title: "Removed entry", anchor: null, tags: [] }
      : {}),
  };
}
export async function noteCommentsApi(
  request: Request,
  path: string[],
  user: { id: string; name: string },
) {
  const [resource, id, action] = path,
    method = request.method;
  const collection =
    resource === "notes" && action === "comments" && path.length === 3;
  const entry = resource === "comments" && id && path.length === 2;
  if (!collection && !entry) return null;
  z.uuid().parse(id);
  const [initial] = entry
    ? await query<RecordRow>("SELECT * FROM comments WHERE id=$1", [id])
    : [];
  if (entry && !initial) throw unavailable();
  const note = await noteAccess(user.id, collection ? id : initial.note_id);
  const spaceId = note.space_id;
  if (!spaceId) throw unavailable();
  if (collection && method === "GET") {
    const rows = await query<RecordRow>(
      `SELECT c.*,u.name AS author_name,
      root.visibility AS root_visibility FROM comments c
      JOIN comments root ON root.id=coalesce(c.parent_id,c.id)
      JOIN "user" u ON u.id=c.author_id WHERE c.note_id=$1
      AND (root.visibility='shared' OR root.author_id=$2)
      ORDER BY c.created_at,c.id`,
      [id, user.id],
    );
    return json(
      rows.map((row) => {
        const { root_visibility, ...rest } = row as RecordRow & {
          root_visibility: "private" | "shared";
        };
        return present({ ...rest, visibility: root_visibility });
      }),
    );
  }
  if (
    (collection && method !== "POST") ||
    (entry && !["PATCH", "DELETE"].includes(method))
  )
    return json({ error: "Method not allowed." }, 405);
  const input = collection
    ? commentCreateSchema.parse(await request.json())
    : commentPatchSchema.parse({
        ...(await request.json()),
        ...(method === "DELETE" ? { deleted: true } : {}),
      });
  const mutation = input.mutationId ?? randomUUID();
  const hash = createHash("sha256")
    .update(JSON.stringify({ method, input }))
    .digest("hex");
  const result = await transaction(async (client) => {
    // Serialize scope/audience changes before locking entries. Private authoring
    // needs read access, not permission to mutate the document itself.
    await requireNoteScope(client, user.id, note.id, "read");
    await assertSpaceActive(client, spaceId);
    const {
      rows: [resourceRow],
    } = await client.query(
      "SELECT deleted_at FROM resources WHERE note_id=$1",
      [note.id],
    );
    if (!resourceRow || resourceRow.deleted_at) throw unavailable();
    if (collection) {
      const value = commentCreateSchema.parse(input);
      const createdId = value.id ?? randomUUID();
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        createdId,
      ]);
      const {
        rows: [old],
      } = await client.query<RecordRow>("SELECT * FROM comments WHERE id=$1", [
        createdId,
      ]);
      if (old) {
        if (old.author_id !== user.id || old.note_id !== note.id)
          throw unavailable();
        if (old.mutation_id === mutation && old.mutation_hash === hash)
          return { row: old, changed: false, shared: false };
        return { conflict: present(old) };
      }
      const {
        rows: [root],
      } = value.parentId
        ? await client.query<RecordRow>(
            "SELECT * FROM comments WHERE id=$1 AND note_id=$2 AND parent_id IS NULL FOR UPDATE",
            [value.parentId, note.id],
          )
        : { rows: [] };
      if (
        value.parentId &&
        (!root || !visibleThread(root.author_id, root.visibility, user.id))
      )
        throw unavailable();
      if (root && (root.deleted || root.visibility !== "shared"))
        throw new HttpError(
          409,
          "Share an active card before starting a discussion.",
        );
      const visibility =
        root?.visibility ??
        value.visibility ??
        (value.kind === "annotation" ? "private" : "shared");
      if (visibility === "shared")
        await requireScope(client, user.id, spaceId, "comment");
      const {
        rows: [row],
      } = await client.query<RecordRow>(
        `INSERT INTO comments
        (id,note_id,author_id,parent_id,body,anchor,kind,visibility,title,category,tags,body_format,mutation_id,mutation_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [
          createdId,
          note.id,
          user.id,
          value.parentId,
          value.body,
          root ? null : value.anchor,
          root?.kind ?? value.kind,
          visibility,
          value.title,
          value.category,
          value.tags,
          value.bodyFormat,
          mutation,
          hash,
        ],
      );
      return {
        row,
        root,
        changed: true,
        shared: visibility === "shared",
        notify: true,
      };
    }
    // Lock the root first for both replies and sharing transitions.
    const {
      rows: [root],
    } = await client.query<RecordRow>(
      "SELECT * FROM comments WHERE id=$1 FOR UPDATE",
      [initial.parent_id ?? initial.id],
    );
    if (!root || !visibleThread(root.author_id, root.visibility, user.id))
      throw unavailable();
    const {
      rows: [current],
    } = await client.query<RecordRow>(
      "SELECT * FROM comments WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!current) throw unavailable();
    const patch = commentPatchSchema.parse(input);
    if (current.mutation_id === mutation) {
      if (current.mutation_hash !== hash)
        throw new HttpError(
          409,
          "This retry identifier belongs to another change.",
        );
      return { row: current, root, changed: false, shared: false };
    }
    const ownership = current.author_id === user.id;
    const keys = Object.keys(patch).filter(
      (key) => !["version", "mutationId", "expectedVisibility"].includes(key),
    );
    const resolveOnly = keys.every((key) => key === "resolved");
    const removalOnly =
      keys.every((key) => key === "deleted") && patch.deleted === true;
    const scope = await requireScope(
      client,
      user.id,
      spaceId,
      root.visibility === "shared"
        ? removalOnly && !ownership
          ? "manage"
          : "comment"
        : "read",
    );
    if (
      !ownership &&
      !resolveOnly &&
      !(removalOnly && scope.manage && root.visibility === "shared")
    )
      throw new HttpError(403, "Only the author can edit this entry.");
    if (
      current.parent_id &&
      (patch.visibility !== undefined ||
        patch.anchor !== undefined ||
        patch.resolved !== undefined)
    )
      throw new HttpError(
        400,
        "Change visibility, location or status on the parent thread.",
      );
    if (!resolveOnly && patch.version === undefined)
      throw new HttpError(428, "Reload this entry before changing it.");
    if (patch.version !== undefined && patch.version !== current.version)
      return { conflict: present(current, root) };
    if (
      patch.expectedVisibility &&
      patch.expectedVisibility !== root.visibility
    )
      return { conflict: present(current, root) };
    if (patch.visibility === "shared")
      await requireScope(client, user.id, spaceId, "comment");
    if (patch.visibility === "private" && root.visibility === "shared") {
      const { rows } = await client.query(
        "SELECT 1 FROM comments WHERE parent_id=$1 AND author_id<>$2 LIMIT 1",
        [root.id, root.author_id],
      );
      if (rows.length)
        throw new HttpError(
          409,
          "Other people have contributed. Copy this card privately instead.",
        );
    }
    const next = { ...current, ...patch };
    const {
      rows: [row],
    } = await client.query<RecordRow>(
      `UPDATE comments SET body=$2,title=$3,category=$4,tags=$5,anchor=$6,visibility=$7,resolved=$8,deleted=$9,
      version=version+1,mutation_id=$10,mutation_hash=$11,updated_at=now(),body_format=$12 WHERE id=$1 RETURNING *`,
      [
        id,
        next.body,
        next.title,
        next.category,
        next.tags,
        next.anchor,
        next.visibility,
        next.resolved,
        next.deleted,
        mutation,
        hash,
        patch.bodyFormat ?? current.body_format,
      ],
    );
    return {
      row,
      root: current.parent_id ? root : row,
      changed: true,
      shared: root.visibility === "shared" || row.visibility === "shared",
      notify: patch.visibility === "shared" && root.visibility !== "shared",
    };
  });
  if ("conflict" in result)
    return json(
      {
        error: "This entry changed elsewhere. Your draft is retained.",
        current: result.conflict,
      },
      409,
    );
  if (result.changed && result.shared) {
    if (result.notify) {
      // Private-thread participation must not subscribe someone to public alerts.
      await query(
        `INSERT INTO notifications(user_id,note_id,message)
        SELECT DISTINCT recipient,$1,$3 FROM (
          SELECT c.author_id AS recipient FROM comments c JOIN comments root ON root.id=coalesce(c.parent_id,c.id)
          WHERE c.note_id=$1 AND root.visibility='shared' AND NOT c.deleted
          UNION SELECT author_id FROM notes WHERE id=$1
        ) recipients WHERE recipient<>$2 AND axiom_can_read_note(recipient,$1)`,
        [note.id, user.id, `${user.name} commented on ${note.title}`],
      );
    }
    await notifyWorkspace();
  }
  return json(present(result.row, result.root), collection ? 201 : 200);
}

import { z } from "zod";
import { query, transaction } from "./db";
import { resourceAccess, HttpError } from "./access";
import { requireScope, workspaceJson as json } from "./workspace-service";
import { parseCanvas } from "./canvas";
const uuid = z.uuid();
export const resourceAnchor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("whole") }),
  z.object({
    kind: z.literal("canvas-node"),
    nodeId: z.string().min(1).max(200),
  }),
  z.object({
    kind: z.literal("time"),
    seconds: z.number().finite().min(0).max(604800),
  }),
  z.object({
    kind: z.literal("image"),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }),
  z.object({
    kind: z.literal("line"),
    line: z.number().int().min(1).max(10000000),
  }),
  z.object({
    kind: z.literal("page"),
    page: z.number().int().min(1).max(100000),
  }),
  z.object({
    kind: z.literal("cell"),
    sheet: z.string().max(160),
    cell: z.string().regex(/^[A-Z]{1,3}[1-9]\d{0,6}$/),
  }),
]);
export async function resourceCommentsApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  const [endpoint, id, commentId] = path;
  if (endpoint !== "resource-comments" || !id) return null;
  const read = request.method === "GET",
    { resource } = await resourceAccess(
      userId,
      uuid.parse(id),
      read ? "read" : "comment",
      read,
    ),
    url = new URL(request.url);
  if (read) {
    const version = url.searchParams.get("version");
    if (version) uuid.parse(version);
    return json(
      await query(
        'SELECT c.*,u.name AS author FROM resource_comments c JOIN "user" u ON u.id=c.author_id WHERE c.resource_id=$1 AND c.version_id IS NOT DISTINCT FROM $2::uuid ORDER BY c.created_at LIMIT 500',
        [id, version],
      ),
    );
  }
  const input = z
    .object({
      body: z.string().trim().min(1).max(20000).optional(),
      versionId: uuid.nullable().default(null),
      anchor: resourceAnchor.default({ kind: "whole" }),
      resolved: z.boolean().optional(),
    })
    .parse(await request.json());
  return json(
    await transaction(async (client) => {
      const scope = await requireScope(
        client,
        userId,
        resource.space_id,
        "comment",
      );
      const {
        rows: [target],
      } = await client.query("SELECT * FROM resources WHERE id=$1 FOR SHARE", [
        id,
      ]);
      if (!target || target.deleted_at || target.space_id !== resource.space_id)
        throw new HttpError(
          409,
          "This resource moved or was deleted. Reload before commenting.",
        );
      if (commentId) {
        const {
          rows: [comment],
        } = await client.query(
          "SELECT * FROM resource_comments WHERE id=$1 AND resource_id=$2 FOR UPDATE",
          [uuid.parse(commentId), id],
        );
        if (!comment) throw new HttpError(404, "Comment unavailable.");
        if (comment.author_id !== userId && !scope.manage)
          throw new HttpError(
            403,
            "Only the author or a space manager can change this comment.",
          );
        if (request.method === "DELETE") {
          await client.query("DELETE FROM resource_comments WHERE id=$1", [
            commentId,
          ]);
          return { ok: true };
        }
        await client.query(
          "UPDATE resource_comments SET body=coalesce($2,body),resolved=coalesce($3,resolved),updated_at=now() WHERE id=$1",
          [commentId, input.body ?? null, input.resolved ?? null],
        );
        return { ok: true };
      }
      if (!input.body) throw new HttpError(400, "Write a comment first.");
      if (input.anchor.kind === "canvas-node") {
        const note = (
          await client.query(
            "SELECT source_format,body FROM notes WHERE id=$1",
            [target.note_id ?? id],
          )
        ).rows[0];
        if (
          !note ||
          note.source_format !== "canvas" ||
          !parseCanvas(note.body).nodes.some(
            (n) => n.id === (input.anchor as { nodeId: string }).nodeId,
          )
        )
          throw new HttpError(
            409,
            "This card is not saved yet or has been removed. Wait for synchronization, then try again.",
          );
      }
      if (resource.kind === "file" && !input.versionId)
        throw new HttpError(
          400,
          "Comments must be attached to a saved file version.",
        );
      if (
        input.versionId &&
        !(
          await client.query(
            "SELECT 1 FROM file_versions WHERE id=$1 AND resource_id=$2",
            [input.versionId, id],
          )
        ).rowCount
      )
        throw new HttpError(404, "This file version is unavailable.");
      return (
        await client.query(
          "INSERT INTO resource_comments(resource_id,version_id,author_id,body,anchor) VALUES($1,$2,$3,$4,$5) RETURNING id",
          [
            id,
            input.versionId,
            userId,
            input.body,
            JSON.stringify(input.anchor),
          ],
        )
      ).rows[0];
    }),
    commentId ? 200 : 201,
  );
}

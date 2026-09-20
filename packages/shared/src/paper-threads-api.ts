import { z } from "zod";
import { transaction } from "./db";
import { fileAccess, HttpError } from "./access";
import { requireScope, workspaceJson as json } from "./workspace-service";
import { notifyWorkspace } from "./documents";
import type { Annotation } from "./research";

export async function paperThreadsApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  if (path[0] !== "paper-threads") return null;
  const id = z.uuid().parse(path[1]),
    method = request.method;
  const input =
    method === "GET"
      ? null
      : z
          .discriminatedUnion("action", [
            z.object({ action: z.literal("read") }).strict(),
            z
              .object({
                action: z.literal("resolve"),
                resolved: z.boolean(),
                version: z.number().int().positive(),
                mutationId: z.uuid(),
              })
              .strict(),
            z
              .object({
                action: z.literal("reply"),
                id: z.uuid(),
                version: z.number().int().nonnegative(),
                mutationId: z.uuid(),
                body: z.string().trim().min(1).max(12000),
                deleted: z.boolean().default(false),
              })
              .strict(),
          ])
          .parse(await request.json());
  if (!["GET", "POST"].includes(method))
    throw new HttpError(405, "Method not allowed.");
  const result = await transaction(async (client) => {
    // Discover scope, then lock scope/resource/annotation in write order. Do not
    // expose even the thread's existence before its annotation ACL is checked.
    const {
      rows: [lookup],
    } = await client.query<Annotation>(
      "SELECT * FROM paper_annotations WHERE id=$1",
      [id],
    );
    if (!lookup) throw new HttpError(404, "Annotation unavailable.");
    const { file, space } = await fileAccess(userId, lookup.attachment_id);
    await requireScope(client, userId, space.id, "read");
    const {
      rows: [permissions],
    } = await client.query("SELECT axiom_manage_space($1,$2) AS can_manage", [
      userId,
      space.id,
    ]);
    const {
      rows: [resource],
    } = await client.query(
      "SELECT id FROM resources WHERE id=$1 AND space_id=$2 AND deleted_at IS NULL FOR SHARE",
      [file.resource_id, space.id],
    );
    const {
      rows: [mark],
    } = await client.query<Annotation & { resolved: boolean }>(
      "SELECT * FROM paper_annotations WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (
      !resource ||
      !mark ||
      mark.deleted ||
      (!mark.shared && mark.author_id !== userId)
    )
      throw new HttpError(404, "Annotation unavailable.");
    if (input && input.action !== "read" && mark.shared)
      await requireScope(client, userId, space.id, "comment");
    if (input?.action === "read") {
      await client.query(
        "INSERT INTO paper_annotation_reads(annotation_id,user_id) VALUES($1,$2) ON CONFLICT(annotation_id,user_id) DO UPDATE SET read_at=now()",
        [id, userId],
      );
    } else if (input?.action === "resolve") {
      if (mark.author_id !== userId && !permissions.can_manage)
        throw new HttpError(
          403,
          "Only the annotation author or a manager can resolve this thread.",
        );
      if (mark.mutation_id !== input.mutationId) {
        if (mark.version !== input.version)
          throw new HttpError(
            409,
            "The annotation changed. Refresh before resolving it.",
          );
        await client.query(
          "UPDATE paper_annotations SET resolved=$2,version=version+1,mutation_id=$3,updated_at=now() WHERE id=$1",
          [id, input.resolved, input.mutationId],
        );
      }
    } else if (input?.action === "reply") {
      const {
        rows: [previous],
      } = await client.query(
        "SELECT * FROM paper_annotation_replies WHERE id=$1 FOR UPDATE",
        [input.id],
      );
      if (
        previous &&
        (previous.annotation_id !== id ||
          (previous.author_id !== userId &&
            !(mark.shared && permissions.can_manage && input.deleted)))
      )
        throw new HttpError(
          403,
          "Only the reply author can edit its contents.",
        );
      if (previous?.mutation_id !== input.mutationId) {
        if ((previous?.version ?? 0) !== input.version)
          throw new HttpError(
            409,
            "This reply changed. Your draft has not been discarded.",
          );
        if (previous)
          await client.query(
            "UPDATE paper_annotation_replies SET body=$2,deleted=$3,version=version+1,mutation_id=$4,updated_at=now() WHERE id=$1",
            [
              input.id,
              previous.author_id === userId ? input.body : previous.body,
              input.deleted,
              input.mutationId,
            ],
          );
        else {
          const {
            rows: [count],
          } = await client.query(
            "SELECT count(*)::int AS count FROM paper_annotation_replies WHERE annotation_id=$1",
            [id],
          );
          if (count.count >= 500)
            throw new HttpError(
              413,
              "This thread has reached its 500-reply limit. Continue in a new annotation.",
            );
          await client.query(
            "INSERT INTO paper_annotation_replies(id,annotation_id,author_id,body,mutation_id,deleted) VALUES($1,$2,$3,$4,$5,$6)",
            [input.id, id, userId, input.body, input.mutationId, input.deleted],
          );
        }
      }
    }
    const { rows: replies } = await client.query(
      'SELECT r.*,u.name AS author_name FROM paper_annotation_replies r JOIN "user" u ON u.id=r.author_id WHERE annotation_id=$1 AND NOT r.deleted ORDER BY r.created_at,r.id',
      [id],
    );
    const {
      rows: [current],
    } = await client.query(
      "SELECT version,resolved FROM paper_annotations WHERE id=$1",
      [id],
    );
    return { ...current, shared: mark.shared, replies };
  });
  if (input && input.action !== "read") await notifyWorkspace();
  return json(result);
}

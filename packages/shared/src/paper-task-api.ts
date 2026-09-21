import { z } from "zod";
import { query, transaction } from "./db";
import { fileAccess, HttpError, spaceAccess } from "./access";
import { lockPlanning, mutatePlanningTask } from "./planning-api";
import {
  requireScope,
  workspaceJson as json,
  workspaceMutation,
  recordActivity,
} from "./workspace-service";
import { notifyWorkspace } from "./documents";

/** Anchors contain no copied quotation. Every read follows the current paper and
 * annotation permissions; a removed version is never replaced with the latest. */
export async function paperTaskApi(
  request: Request,
  path: string[],
  user: string,
): Promise<Response | null> {
  const [root, id, section, child] = path;
  if (
    section !== "paper-links" ||
    !["tasks", "paper-annotations"].includes(root)
  )
    return null;
  z.uuid().parse(id);
  if (root === "tasks") {
    const [task] = await query(
      "SELECT space_id FROM tasks WHERE id=$1 AND deleted_at IS NULL",
      [id],
    );
    if (!task) throw new HttpError(404, "Task unavailable.");
    await spaceAccess(
      user,
      task.space_id,
      request.method === "GET" ? "read" : "edit",
    );
    if (request.method === "GET")
      return json(
        await transaction(async (db) => {
          await requireScope(db, user, task.space_id);
          return (
            await db.query(
              `SELECT l.id,l.annotation_id,l.version_id,l.page,r.id AS resource_id,r.name,a.shared
        FROM task_paper_links l JOIN tasks t ON t.id=l.task_id JOIN paper_annotations a ON a.id=l.annotation_id
        JOIN file_versions v ON v.id=l.version_id JOIN resources r ON r.id=v.resource_id
        WHERE t.id=$1 AND t.space_id=$2 AND t.deleted_at IS NULL AND r.space_id=$2 AND r.deleted_at IS NULL
        AND NOT a.deleted AND (a.shared OR a.author_id=$3) ORDER BY l.created_at LIMIT 100`,
              [id, task.space_id, user],
            )
          ).rows;
        }),
      );
    if (request.method !== "DELETE" || !child)
      throw new HttpError(405, "Unsupported paper link operation.");
    const input = z
      .object({ mutationId: z.uuid() })
      .strict()
      .parse(await request.json());
    const result = await workspaceMutation(
      user,
      input.mutationId,
      `task-paper-unlink:${id}:${child}`,
      input,
      async (db) => {
        await lockPlanning(db, user, task.space_id);
        await db.query(
          `DELETE FROM task_paper_links l USING paper_annotations a WHERE l.id=$1 AND l.task_id=$2 AND a.id=l.annotation_id AND (a.shared OR a.author_id=$3)`,
          [z.uuid().parse(child), id, user],
        );
        await recordActivity(db, {
          spaceId: task.space_id,
          userId: user,
          taskId: id,
          kind: "planning",
          title: "Removed a paper task link",
        });
        return { ok: true };
      },
    );
    await notifyWorkspace();
    return json(result);
  }
  if (request.method !== "POST")
    throw new HttpError(405, "Use a task to read its paper links.");
  const input = z
    .object({
      mutationId: z.uuid(),
      taskId: z.uuid().optional(),
      taskVersion: z.number().int().positive().optional(),
      title: z.string().trim().min(1).max(300).optional(),
      annotationVersion: z.number().int().positive(),
    })
    .strict()
    .refine(
      (v) => (v.taskId ? !!v.taskVersion && !v.title : !!v.title),
      "Choose an existing task or name a new one.",
    )
    .parse(await request.json());
  const [lookup] = await query(
    "SELECT * FROM paper_annotations WHERE id=$1 AND NOT deleted AND (shared OR author_id=$2)",
    [id, user],
  );
  if (!lookup) throw new HttpError(404, "Annotation unavailable.");
  const { file, space, resource } = await fileAccess(
    user,
    lookup.attachment_id,
  );
  if (resource.deleted_at) throw new HttpError(404, "Paper unavailable.");
  await spaceAccess(user, space.id, "edit");
  const result = await workspaceMutation(
    user,
    input.mutationId,
    `paper-task:${id}`,
    input,
    async (db) => {
      const currentSpace = await lockPlanning(db, user, space.id);
      const {
        rows: [r],
      } = await db.query(
        "SELECT id FROM resources WHERE id=$1 AND space_id=$2 AND deleted_at IS NULL FOR SHARE",
        [resource.id, space.id],
      );
      const {
        rows: [a],
      } = await db.query(
        "SELECT * FROM paper_annotations WHERE id=$1 AND NOT deleted AND (shared OR author_id=$2) FOR SHARE",
        [id, user],
      );
      if (!r || !a)
        throw new HttpError(404, "Paper or annotation unavailable.");
      if (a.version !== input.annotationVersion)
        throw new HttpError(
          409,
          "The annotation changed. Reopen it before linking.",
        );
      let task;
      if (input.taskId) {
        task = (
          await db.query(
            "SELECT id,version FROM tasks WHERE id=$1 AND space_id=$2 AND deleted_at IS NULL FOR UPDATE",
            [input.taskId, space.id],
          )
        ).rows[0];
        if (!task)
          throw new HttpError(404, "Choose a task in this paper's workspace.");
        if (task.version !== input.taskVersion)
          throw new HttpError(409, "The task changed. Refresh before linking.");
      } else
        task = await mutatePlanningTask(
          db,
          user,
          space.id,
          currentSpace,
          undefined,
          { title: input.title },
        );
      const {
        rows: [count],
      } = await db.query(
        "SELECT count(*)::int AS n FROM task_paper_links WHERE task_id=$1",
        [task.id],
      );
      if (count.n >= 100)
        throw new HttpError(
          413,
          "This task has reached its 100-paper-link limit.",
        );
      await db.query(
        "INSERT INTO task_paper_links(task_id,annotation_id,version_id,page,author_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(task_id,annotation_id) DO NOTHING",
        [task.id, id, file.id, a.data.page, user],
      );
      await recordActivity(db, {
        spaceId: space.id,
        userId: user,
        taskId: task.id,
        kind: "planning",
        title: "Linked a paper annotation to a task",
      });
      return { taskId: task.id, spaceId: space.id };
    },
  );
  await notifyWorkspace();
  return json(result);
}

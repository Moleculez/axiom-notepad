import { z } from "zod";
import { query, transaction } from "./db";
import { resourceAccess, spaceAccess, HttpError } from "./access";
import {
  referenceAccess,
  requireLibraryScope,
  liveResource,
} from "./research-library-service";
import { lockPlanning, mutatePlanningTask } from "./planning-api";
import {
  requireScope,
  workspaceMutation,
  recordActivity,
  workspaceJson as json,
} from "./workspace-service";
import { notifyWorkspace } from "./documents";

export type ResearchTaskLink = {
  id: string;
  source_kind: "manuscript" | "reference";
  available: boolean;
  name: string;
  label: string | null;
  note_id: string | null;
  snapshot_id: string | null;
  reference_id: string | null;
  reference_event_id: string | null;
  version: number | null;
};
export async function researchTaskApi(
  request: Request,
  path: string[],
  user: string,
): Promise<Response | null> {
  const [root, id, action, child] = path;
  if (root === "tasks" && action === "research-links") {
    const [task] = await query(
      "SELECT id,space_id FROM tasks WHERE id=$1 AND deleted_at IS NULL",
      [z.uuid().parse(id)],
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
          const { rows } = await db.query(
            `SELECT l.id,l.source_kind,
       CASE WHEN l.source_kind='manuscript' THEN s.id IS NOT NULL AND r.space_id=$2 AND ${liveResource()} AND axiom_space_role($3,r.space_id) IS NOT NULL
       ELSE e.id IS NOT NULL AND b.id IS NOT NULL AND b.deleted_at IS NULL AND b.space_id=$2 AND axiom_space_role($3,b.space_id) IS NOT NULL END AS available,
       l.note_id,l.snapshot_id,l.reference_id,l.reference_event_id,s.label,e.version,
       CASE WHEN l.source_kind='manuscript' THEN r.name ELSE b.title END AS name
       FROM task_research_links l LEFT JOIN snapshots s ON s.id=l.snapshot_id LEFT JOIN resources r ON r.note_id=l.note_id
       LEFT JOIN reference_provenance e ON e.id=l.reference_event_id LEFT JOIN bibliography b ON b.id=l.reference_id WHERE l.task_id=$1 ORDER BY l.created_at LIMIT 100`,
            [id, task.space_id, user],
          );
          return rows.map((row) =>
            row.available
              ? row
              : {
                  id: row.id,
                  source_kind: row.source_kind,
                  available: false,
                  name: "Source unavailable",
                  label: null,
                  note_id: null,
                  snapshot_id: null,
                  reference_id: null,
                  reference_event_id: null,
                  version: null,
                },
          );
        }),
      );
    if (request.method !== "DELETE" || !child)
      throw new HttpError(405, "Unsupported research link operation.");
    const input = z
      .object({ mutationId: z.uuid() })
      .strict()
      .parse(await request.json());
    const result = await workspaceMutation(
      user,
      input.mutationId,
      `research-unlink:${id}:${child}`,
      input,
      async (db) => {
        await lockPlanning(db, user, task.space_id);
        await db.query(
          "DELETE FROM task_research_links WHERE id=$1 AND task_id=$2",
          [z.uuid().parse(child), id],
        );
        await recordActivity(db, {
          spaceId: task.space_id,
          userId: user,
          taskId: id,
          kind: "planning",
          title: "Removed a research source link",
        });
        return { ok: true };
      },
    );
    await notifyWorkspace();
    return json(result);
  }
  const manuscript = root === "resources" && action === "research-tasks";
  const reference =
    root === "research" &&
    path[1] === "library" &&
    path[2] === "items" &&
    path[4] === "research-tasks";
  if (!manuscript && !reference) return null;
  if (request.method !== "POST")
    throw new HttpError(405, "Use POST to create a reviewed research handoff.");
  const sourceId = z.uuid().parse(manuscript ? id : path[3]);
  const input = z
    .object({
      mutationId: z.uuid(),
      snapshotId: z.uuid().optional(),
      referenceEventId: z.uuid().optional(),
      taskId: z.uuid().optional(),
      taskVersion: z.number().int().positive().optional(),
      title: z.string().trim().min(1).max(300).optional(),
    })
    .strict()
    .refine(
      (v) => (v.taskId ? !!v.taskVersion && !v.title : !!v.title),
      "Choose a task or name a new one.",
    )
    .parse(await request.json());
  const source = manuscript
    ? await resourceAccess(user, sourceId)
    : await referenceAccess(user, sourceId);
  const spaceId = manuscript
    ? (source as Awaited<ReturnType<typeof resourceAccess>>).space.id
    : (source as Awaited<ReturnType<typeof referenceAccess>>).space_id;
  if (
    manuscript
      ? !input.snapshotId || !!input.referenceEventId
      : !input.referenceEventId || !!input.snapshotId
  )
    throw new HttpError(
      400,
      "Choose an immutable milestone or reference history event.",
    );
  const result = await workspaceMutation(
    user,
    input.mutationId,
    `research-task:${sourceId}`,
    input,
    async (db) => {
      const space = await lockPlanning(db, user, spaceId);
      let noteId: string | null = null,
        referenceId: string | null = null;
      if (manuscript) {
        const {
          rows: [row],
        } = await db.query(
          `SELECT r.note_id FROM resources r JOIN snapshots s ON s.note_id=r.note_id WHERE r.id=$1 AND r.space_id=$2 AND s.id=$3 AND s.source_format='markdown' AND ${liveResource()} FOR SHARE OF r,s`,
          [sourceId, spaceId, input.snapshotId],
        );
        if (!row)
          throw new HttpError(
            404,
            "Choose an available Markdown milestone in this workspace.",
          );
        noteId = row.note_id;
      } else {
        await requireLibraryScope(db, user, { spaceId }, true);
        const {
          rows: [row],
        } = await db.query(
          "SELECT b.id FROM bibliography b JOIN reference_provenance e ON e.reference_id=b.id WHERE b.id=$1 AND b.space_id=$2 AND b.deleted_at IS NULL AND e.id=$3 FOR SHARE OF b,e",
          [sourceId, spaceId, input.referenceEventId],
        );
        if (!row)
          throw new HttpError(
            404,
            "The selected reference event is unavailable.",
          );
        referenceId = row.id;
      }
      let task;
      if (input.taskId) {
        task = (
          await db.query(
            "SELECT id,version FROM tasks WHERE id=$1 AND space_id=$2 AND deleted_at IS NULL FOR UPDATE",
            [input.taskId, spaceId],
          )
        ).rows[0];
        if (!task)
          throw new HttpError(404, "Choose a task in this source's workspace.");
        if (task.version !== input.taskVersion)
          throw new HttpError(409, "The task changed. Refresh before linking.");
      } else
        task = await mutatePlanningTask(db, user, spaceId, space, undefined, {
          title: input.title,
        });
      const {
        rows: [count],
      } = await db.query(
        "SELECT count(*)::int AS n FROM task_research_links WHERE task_id=$1",
        [task.id],
      );
      const existing = await db.query(
        "SELECT id FROM task_research_links WHERE task_id=$1 AND (snapshot_id=$2::uuid OR reference_event_id=$3::uuid)",
        [task.id, input.snapshotId ?? null, input.referenceEventId ?? null],
      );
      if (!existing.rowCount && count.n >= 100)
        throw new HttpError(
          413,
          "This task has reached its 100-research-link limit.",
        );
      if (!existing.rowCount)
        await db.query(
          "INSERT INTO task_research_links(task_id,source_kind,note_id,snapshot_id,reference_id,reference_event_id,author_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            task.id,
            manuscript ? "manuscript" : "reference",
            noteId,
            input.snapshotId ?? null,
            referenceId,
            input.referenceEventId ?? null,
            user,
          ],
        );
      await recordActivity(db, {
        userId: user,
        spaceId,
        taskId: task.id,
        kind: "planning",
        title: "Linked an immutable research source to a task",
      });
      return { taskId: task.id, spaceId };
    },
  );
  await notifyWorkspace();
  return json(result);
}

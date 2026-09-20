import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { query } from "./db";
import { HttpError, spaceAccess } from "./access";
import { notifyWorkspace } from "./documents";
import {
  workspaceJson as json,
  workspaceMutation,
  requireScope,
  assertRevision,
  recordActivity,
  deliverEvent,
} from "./workspace-service";
import {
  dateOnlySchema,
  resourceNameSchema,
  taskStatusSchema,
  taskPrioritySchema,
  recurrenceSchema,
} from "./workspace";
import {
  calendarSchema,
  dependencyOrder,
  planSchedule,
  type PlanningTask,
  type SchedulePlan,
  type ScheduleChange,
} from "./planning";

const uuid = z.uuid(),
  mutationId = uuid.default(() => randomUUID());
const taskInput = z.object({
  title: z.string().trim().min(1).max(300),
  body: z.string().max(100000).default(""),
  status: taskStatusSchema.default("todo"),
  priority: taskPrioritySchema.default("normal"),
  assigneeId: z.string().max(100).nullable().default(null),
  parentId: uuid.nullable().default(null),
  startOn: dateOnlySchema.nullable().default(null),
  dueOn: dateOnlySchema.nullable().default(null),
  estimateHours: z.number().min(0).max(10000).nullable().default(null),
  labels: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  milestoneId: uuid.nullable().default(null),
  noteId: uuid.nullable().default(null),
  resourceIds: z.array(uuid).max(100).default([]),
  dependencies: z.array(uuid).max(100).default([]),
  position: z.number().finite().default(0),
});
const changeSchema = z.object({
  id: uuid,
  version: z.number().int().positive(),
  startOn: dateOnlySchema.nullable(),
  dueOn: dateOnlySchema.nullable(),
});
const taskFields = (
  includeBody = false,
) => `t.id,t.space_id,t.project_id,t.title,t.status,t.priority,t.assignee_id,t.parent_id,t.start_on,t.due_on,t.estimate_hours,t.labels,t.milestone_id,t.note_id,t.position,t.version,t.created_by,t.created_at,t.updated_at,t.deleted_at,${includeBody ? "t.body" : "''::text AS body"},u.name AS assignee_name,
 coalesce((SELECT jsonb_agg(d.depends_on ORDER BY d.depends_on) FROM task_dependencies d JOIN tasks b ON b.id=d.depends_on WHERE d.task_id=t.id AND b.deleted_at IS NULL),'[]'::jsonb) AS dependencies,
 coalesce((SELECT jsonb_agg(r.resource_id) FROM task_resources r WHERE r.task_id=t.id),'[]'::jsonb) AS resource_ids,
 EXISTS(SELECT 1 FROM task_dependencies d JOIN tasks b ON b.id=d.depends_on WHERE d.task_id=t.id AND b.deleted_at IS NULL AND b.status NOT IN ('done','cancelled')) AS blocked`;
export async function planningTasks(client: PoolClient, spaceId: string) {
  const rows = (
    await client.query<PlanningTask>(
      `SELECT ${taskFields()} FROM tasks t LEFT JOIN "user" u ON u.id=t.assignee_id WHERE t.space_id=$1 AND t.deleted_at IS NULL ORDER BY t.position,t.created_at,t.id LIMIT 50001`,
      [spaceId],
    )
  ).rows;
  if (rows.length > 50000)
    throw new HttpError(
      413,
      "This workspace exceeds the 50,000-task scheduling limit. Split the plan into workspaces.",
    );
  return rows.map(normalizeTask);
}
function normalizeTask<T extends PlanningTask>(task: T): T {
  return { ...task, start_on: date(task.start_on), due_on: date(task.due_on) };
}
function date(value: unknown): string | null {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : typeof value === "string"
      ? value.slice(0, 10)
      : null;
}
export async function lockPlanning(
  client: PoolClient,
  userId: string,
  spaceId: string,
  capability: "edit" | "manage" | "comment" = "edit",
) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    "planning:" + spaceId,
  ]);
  await client.query("SELECT id FROM spaces WHERE id=$1 FOR UPDATE", [spaceId]);
  await requireScope(client, userId, spaceId, capability);
  return (await client.query("SELECT * FROM spaces WHERE id=$1", [spaceId]))
    .rows[0];
}
async function event(
  client: PoolClient,
  userId: string,
  spaceId: string,
  title: string,
  taskId?: string,
) {
  await recordActivity(client, {
    userId,
    spaceId,
    title,
    taskId,
    kind: "planning",
  });
}
async function validateTask(
  client: PoolClient,
  spaceId: string,
  input: z.infer<typeof taskInput>,
  id: string,
) {
  if (input.startOn && input.dueOn && input.startOn > input.dueOn)
    throw new HttpError(400, "A task cannot end before it starts.");
  if (
    input.assigneeId &&
    !(
      await client.query("SELECT 1 WHERE axiom_space_role($1,$2) IS NOT NULL", [
        input.assigneeId,
        spaceId,
      ])
    ).rowCount
  )
    throw new HttpError(
      400,
      "The assignee must have access to this workspace.",
    );
  const tasks = await planningTasks(client, spaceId),
    byId = new Map(tasks.map((t) => [t.id, t]));
  const ancestors = new Set([id]);
  let parent = input.parentId;
  while (parent) {
    if (ancestors.has(parent) || !byId.has(parent))
      throw new HttpError(
        400,
        "Choose a parent in this workspace without creating a cycle.",
      );
    ancestors.add(parent);
    parent = byId.get(parent)!.parent_id;
  }
  if (
    input.milestoneId &&
    !(
      await client.query(
        "SELECT 1 FROM project_milestones WHERE id=$1 AND space_id=$2",
        [input.milestoneId, spaceId],
      )
    ).rowCount
  )
    throw new HttpError(400, "Choose a milestone in this workspace.");
  const resources = [
    ...new Set([...input.resourceIds, ...(input.noteId ? [input.noteId] : [])]),
  ];
  if (
    resources.length &&
    (
      await client.query(
        "SELECT id FROM resources WHERE id=ANY($1::uuid[]) AND space_id=$2 AND deleted_at IS NULL FOR SHARE",
        [resources, spaceId],
      )
    ).rowCount !== resources.length
  )
    throw new HttpError(
      400,
      "Linked evidence must be available in this workspace.",
    );
  try {
    dependencyOrder([
      ...tasks.filter((t) => t.id !== id),
      { id, dependencies: input.dependencies },
    ]);
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  return resources;
}

/** One workspace-scoped implementation used by modern routes and legacy task/project adapters. */
export async function planningApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  let [endpoint, id, section, child] = path;
  const method = request.method,
    url = new URL(request.url);
  if (endpoint === "tasks" && id) {
    const [task] = await query("SELECT space_id FROM tasks WHERE id=$1", [
      uuid.parse(id),
    ]);
    if (!task) throw new HttpError(404, "Task unavailable.");
    child = id;
    id = task.space_id;
    section = "tasks";
    endpoint = "spaces";
  } else if (
    endpoint === "projects" &&
    id &&
    ["tasks", "milestones", "recurrences", "discussions", "workload"].includes(
      section,
    )
  ) {
    const [space] = await query("SELECT id FROM spaces WHERE project_id=$1", [
      uuid.parse(id),
    ]);
    if (!space) throw new HttpError(404, "Workspace unavailable.");
    id = space.id;
    endpoint = "spaces";
  }
  if (
    endpoint !== "spaces" ||
    !id ||
    ![
      "planning",
      "tasks",
      "schedule",
      "milestones",
      "recurrences",
      "discussions",
      "workload",
      "reviews",
      "planning-members",
      "planning-settings",
      "overview",
    ].includes(section)
  )
    return null;
  uuid.parse(id);
  const space = await spaceAccess(userId, id);
  if (method === "GET") {
    if (section === "planning-members")
      return json(
        await query(
          'SELECT u.id,u.name,u.image,coalesce(p.weekly_capacity,40) AS weekly_capacity,axiom_space_role(u.id,$1) AS role FROM "user" u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE (u.id=$2 OR EXISTS(SELECT 1 FROM members WHERE user_id=u.id AND group_id=$3)) AND axiom_space_role(u.id,$1) IS NOT NULL ORDER BY u.name',
          [id, space.owner_id, space.group_id],
        ),
      );
    if (section === "planning-settings") {
      const [row] = await query(
        "SELECT planning_calendar,timezone,planning_version FROM spaces WHERE id=$1",
        [id],
      );
      return json({
        calendar: calendarSchema.parse({
          ...row.planning_calendar,
          timezone: row.timezone,
        }),
        version: row.planning_version,
      });
    }
    if (section === "tasks" && child) {
      const [task] = await query<PlanningTask>(
        `SELECT ${taskFields(true)} FROM tasks t LEFT JOIN "user" u ON u.id=t.assignee_id WHERE t.id=$1 AND t.space_id=$2`,
        [uuid.parse(child), id],
      );
      if (!task) throw new HttpError(404, "Task unavailable.");
      return json(normalizeTask(task));
    }
    if (section === "tasks" || section === "planning") {
      const limit = z.coerce
        .number()
        .int()
        .min(1)
        .max(section === "planning" ? 5000 : 200)
        .parse(url.searchParams.get("limit") ?? 100);
      const offset = z.coerce
        .number()
        .int()
        .min(0)
        .max(100000)
        .parse(url.searchParams.get("offset") ?? 0);
      const status = taskStatusSchema
        .nullable()
        .parse(url.searchParams.get("status"));
      const priority = taskPrioritySchema
        .nullable()
        .parse(url.searchParams.get("priority"));
      const search = z
        .string()
        .max(200)
        .parse(url.searchParams.get("q") ?? "");
      const args = [
        id,
        status,
        priority,
        url.searchParams.get("assignee"),
        url.searchParams.get("milestone"),
        "%" + search.replace(/[\\%_]/g, "\\$&") + "%",
        url.searchParams.get("deleted") === "1",
      ];
      if (args[4]) uuid.parse(args[4]);
      const where = `t.space_id=$1 AND (t.deleted_at IS NOT NULL)=$7 AND ($2::text IS NULL OR t.status=$2) AND ($3::text IS NULL OR t.priority=$3) AND ($4::text IS NULL OR t.assignee_id=$4) AND ($5::uuid IS NULL OR t.milestone_id=$5) AND (t.title ILIKE $6 OR array_to_string(t.labels,' ') ILIKE $6)`;
      const sort =
        {
          title: "lower(t.title)",
          due: "t.due_on NULLS LAST",
          updated: "t.updated_at DESC",
          position: "t.position,t.created_at",
        }[url.searchParams.get("sort") ?? "position"] ??
        "t.position,t.created_at";
      const [items, [totals], milestones, [settings]] = await Promise.all([
        query<PlanningTask>(
          `SELECT ${taskFields(section !== "planning")} FROM tasks t LEFT JOIN "user" u ON u.id=t.assignee_id WHERE ${where} ORDER BY ${sort},t.id LIMIT $8 OFFSET $9`,
          [...args, limit + 1, offset],
        ),
        query(
          `SELECT count(*)::int AS total,count(*) FILTER(WHERE t.status='done')::int AS completed FROM tasks t WHERE ${where}`,
          args,
        ),
        query(
          "SELECT * FROM project_milestones WHERE space_id=$1 ORDER BY due_on NULLS LAST,id",
          [id],
        ),
        query(
          "SELECT planning_calendar,timezone,planning_version FROM spaces WHERE id=$1",
          [id],
        ),
      ]);
      return json({
        items: items.slice(0, limit).map(normalizeTask),
        total: totals.total,
        completed: totals.completed,
        nextOffset: items.length > limit ? offset + limit : null,
        milestones: milestones.map((m) => ({ ...m, due_on: date(m.due_on) })),
        calendar: calendarSchema.parse({
          ...settings.planning_calendar,
          timezone: settings.timezone,
        }),
        version: settings.planning_version,
      });
    }
    if (section === "milestones")
      return json(
        await query(
          "SELECT m.*,(SELECT count(*)::int FROM tasks WHERE milestone_id=m.id AND deleted_at IS NULL) AS tasks,(SELECT count(*)::int FROM tasks WHERE milestone_id=m.id AND deleted_at IS NULL AND status='done') AS completed_tasks FROM project_milestones m WHERE m.space_id=$1 ORDER BY m.due_on NULLS LAST,m.title",
          [id],
        ),
      );
    if (section === "recurrences")
      return json(
        await query(
          "SELECT * FROM task_recurrences WHERE space_id=$1 ORDER BY id",
          [id],
        ),
      );
    if (section === "discussions") {
      const taskId = uuid.nullable().parse(url.searchParams.get("task"));
      return json(
        await query(
          'SELECT d.*,u.name AS author_name FROM project_discussions d JOIN "user" u ON u.id=d.author_id WHERE d.space_id=$1 AND d.deleted_at IS NULL AND ($2::uuid IS NULL OR d.task_id=$2) ORDER BY d.created_at DESC LIMIT 200',
          [id, taskId],
        ),
      );
    }
    if (section === "reviews")
      return json(
        await query(
          'SELECT q.*,r.name AS note_title,u.name AS reviewer_name FROM review_requests q JOIN resources r ON r.id=coalesce(q.resource_id,q.note_id) JOIN "user" u ON u.id=q.reviewer_id WHERE q.space_id=$1 AND r.deleted_at IS NULL ORDER BY q.created_at DESC LIMIT 200',
          [id],
        ),
      );
    if (section === "workload")
      return json(
        await query(
          "SELECT u.id,u.name,coalesce(p.weekly_capacity,40) AS weekly_capacity,count(t.id)::int AS open_tasks,count(t.id) FILTER(WHERE t.estimate_hours IS NULL)::int AS unestimated,coalesce(sum(t.estimate_hours),0)::float8 AS estimated_hours FROM \"user\" u LEFT JOIN user_profiles p ON p.user_id=u.id LEFT JOIN tasks t ON t.assignee_id=u.id AND t.space_id=$1 AND t.deleted_at IS NULL AND t.status NOT IN ('done','cancelled') WHERE (u.id=$2 OR EXISTS(SELECT 1 FROM members WHERE user_id=u.id AND group_id=$3)) AND axiom_space_role(u.id,$1) IS NOT NULL GROUP BY u.id,u.name,p.weekly_capacity ORDER BY u.name",
          [id, space.owner_id, space.group_id],
        ),
      );
    if (section === "overview") {
      const [recent, tasks, milestones, reviews, activity] = await Promise.all([
        query(
          "SELECT id,name,kind,updated_at FROM resources WHERE space_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 8",
          [id],
        ),
        query<PlanningTask>(
          `SELECT ${taskFields()} FROM tasks t LEFT JOIN "user" u ON u.id=t.assignee_id WHERE t.space_id=$1 AND t.deleted_at IS NULL AND t.status NOT IN ('done','cancelled') ORDER BY (t.assignee_id=$2) DESC,t.due_on NULLS LAST,t.updated_at DESC LIMIT 8`,
          [id, userId],
        ),
        query(
          "SELECT * FROM project_milestones WHERE space_id=$1 AND completed_at IS NULL ORDER BY due_on NULLS LAST LIMIT 8",
          [id],
        ),
        query(
          "SELECT q.id,q.resource_id,q.note_id,r.name AS title,q.status FROM review_requests q JOIN resources r ON r.id=coalesce(q.resource_id,q.note_id) WHERE q.space_id=$1 AND q.status='pending' AND r.deleted_at IS NULL ORDER BY q.created_at DESC LIMIT 8",
          [id],
        ),
        query(
          "SELECT id,title,created_at FROM workspace_activity WHERE space_id=$1 ORDER BY created_at DESC LIMIT 8",
          [id],
        ),
      ]);
      return json({
        recent,
        tasks: tasks.map(normalizeTask),
        milestones,
        reviews,
        activity,
      });
    }
    return null;
  }
  if (!["POST", "PATCH"].includes(method))
    throw new HttpError(405, "Use POST or PATCH for planning changes.");
  const raw = await request.json();
  const operationId = mutationId.parse(raw.mutationId);
  const result = await workspaceMutation(
    userId,
    operationId,
    `planning:${id}:${section}:${child ?? ""}:${method}`,
    raw,
    async (client) => {
      const settings = await lockPlanning(
        client,
        userId,
        id,
        section === "planning-settings"
          ? "manage"
          : section === "discussions"
            ? "comment"
            : "edit",
      );
      if (section === "planning-settings") {
        const input = z
          .object({ calendar: calendarSchema, version: z.number().int() })
          .parse(raw);
        assertRevision(settings.planning_version, input.version);
        await client.query(
          "UPDATE spaces SET planning_calendar=$2,timezone=$3,planning_version=planning_version+1,version=version+1 WHERE id=$1",
          [id, input.calendar, input.calendar.timezone],
        );
        await event(
          client,
          userId,
          id,
          "Updated working calendar; existing dates unchanged",
        );
        return { ok: true, version: settings.planning_version + 1 };
      }
      if (section === "schedule") {
        if (child === "preview") {
          const input = z
            .object({ changes: z.array(changeSchema).min(1).max(1000) })
            .parse(raw);
          let plan: SchedulePlan;
          try {
            plan = planSchedule(
              await planningTasks(client, id),
              input.changes,
              calendarSchema.parse({
                ...settings.planning_calendar,
                timezone: settings.timezone,
              }),
            );
          } catch (error) {
            throw new HttpError(409, (error as Error).message);
          }
          const [preview] = (
            await client.query(
              "INSERT INTO schedule_previews(space_id,user_id,planning_version,plan) VALUES($1,$2,$3,$4) RETURNING id,expires_at",
              [id, userId, settings.planning_version, plan],
            )
          ).rows;
          await client.query(
            "DELETE FROM schedule_previews WHERE space_id=$1 AND applied_at IS NULL AND expires_at<now()",
            [id],
          );
          return { ...preview, ...plan };
        }
        const input = z
          .object({
            previewId: uuid,
            mode: z.enum(["direct", "proposed"]).default("proposed"),
          })
          .parse(raw);
        const [preview] = (
          await client.query(
            "SELECT * FROM schedule_previews WHERE id=$1 AND space_id=$2 AND user_id=$3 FOR UPDATE",
            [input.previewId, id, userId],
          )
        ).rows;
        if (!preview) throw new HttpError(404, "Schedule preview unavailable.");
        if (child === "undo") {
          if (!preview.applied_at || preview.undone_at)
            throw new HttpError(409, "This schedule cannot be undone again.");
          for (const row of preview.inverse as (ScheduleChange & {
            startOn: string | null;
            dueOn: string | null;
          })[]) {
            const update = await client.query(
              "UPDATE tasks SET start_on=$3,due_on=$4,version=version+1,updated_at=now() WHERE id=$1 AND space_id=$2 AND version=$5 AND deleted_at IS NULL",
              [row.id, id, row.startOn, row.dueOn, row.version],
            );
            if (!update.rowCount)
              throw new HttpError(
                409,
                "A scheduled task changed; Undo would overwrite newer work.",
              );
          }
          await client.query(
            "UPDATE schedule_previews SET undone_at=now() WHERE id=$1",
            [preview.id],
          );
          await event(client, userId, id, "Undid schedule change");
          return { ok: true };
        }
        if (child !== "apply")
          throw new HttpError(404, "Unknown scheduling action.");
        if (
          preview.applied_at ||
          new Date(preview.expires_at).valueOf() <= Date.now()
        )
          throw new HttpError(
            409,
            "This preview was applied or expired. Preview again.",
          );
        assertRevision(settings.planning_version, preview.planning_version);
        const changes = (preview.plan as SchedulePlan)[input.mode];
        const inverse = [];
        for (const row of changes) {
          const [before] = (
            await client.query(
              "SELECT * FROM tasks WHERE id=$1 AND space_id=$2 AND deleted_at IS NULL FOR UPDATE",
              [row.id, id],
            )
          ).rows;
          if (!before)
            throw new HttpError(409, "A scheduled task is unavailable.");
          assertRevision(before.version, row.version);
          inverse.push({
            id: row.id,
            version: row.version + 1,
            startOn: date(before.start_on),
            dueOn: date(before.due_on),
          });
          await client.query(
            "UPDATE tasks SET start_on=$2,due_on=$3,version=version+1,updated_at=now() WHERE id=$1",
            [row.id, row.startOn, row.dueOn],
          );
        }
        await client.query(
          "UPDATE schedule_previews SET applied_at=now(),inverse=$2 WHERE id=$1",
          [preview.id, JSON.stringify(inverse)],
        );
        await event(
          client,
          userId,
          id,
          `Rescheduled ${changes.length} task${changes.length === 1 ? "" : "s"}`,
        );
        return { ok: true, undoId: preview.id, count: changes.length };
      }
      if (section === "tasks")
        return mutatePlanningTask(client, userId, id, space, child, raw);
      if (section === "milestones") {
        const input = z
          .object({
            id: uuid.optional(),
            title: resourceNameSchema,
            dueOn: dateOnlySchema.nullable().default(null),
            completed: z.boolean().default(false),
            version: z.number().int().optional(),
          })
          .parse(raw);
        const target = child ?? input.id;
        if (target) {
          const [row] = (
            await client.query(
              "UPDATE project_milestones SET title=$3,due_on=$4,completed_at=CASE WHEN $5 THEN coalesce(completed_at,now()) ELSE NULL END,version=version+1 WHERE id=$1 AND space_id=$2 AND version=$6 RETURNING *",
              [
                target,
                id,
                input.title,
                input.dueOn,
                input.completed,
                input.version,
              ],
            )
          ).rows;
          if (!row)
            throw new HttpError(
              409,
              "Milestone changed. Refresh before saving.",
            );
          await event(client, userId, id, `Updated milestone: ${row.title}`);
          return row;
        }
        const [row] = (
          await client.query(
            "INSERT INTO project_milestones(space_id,project_id,title,due_on) VALUES($1,$2,$3,$4) RETURNING *",
            [id, space.project_id, input.title, input.dueOn],
          )
        ).rows;
        await event(client, userId, id, `Created milestone: ${row.title}`);
        return row;
      }
      if (section === "recurrences") {
        if (child) {
          const input = z
            .object({ enabled: z.boolean(), version: z.number().int() })
            .parse(raw);
          const [row] = (
            await client.query(
              "UPDATE task_recurrences SET enabled=$3,version=version+1 WHERE id=$1 AND space_id=$2 AND version=$4 RETURNING *",
              [child, id, input.enabled, input.version],
            )
          ).rows;
          if (!row)
            throw new HttpError(
              409,
              "Recurrence changed. Refresh before saving.",
            );
          return row;
        }
        const input = z
          .object({ rule: recurrenceSchema, template: taskInput })
          .parse(raw);
        if (input.template.parentId || input.template.dependencies.length)
          throw new HttpError(
            400,
            "Recurring instances cannot copy parent or dependency relationships.",
          );
        await validateTask(client, id, input.template, randomUUID());
        return (
          await client.query(
            "INSERT INTO task_recurrences(space_id,project_id,created_by,rule,template) VALUES($1,$2,$3,$4,$5) RETURNING *",
            [id, space.project_id, userId, input.rule, input.template],
          )
        ).rows[0];
      }
      if (section === "discussions") {
        const input = z
          .object({
            body: z.string().trim().min(1).max(100000),
            parentId: uuid.nullable().default(null),
            taskId: uuid.nullable().default(null),
          })
          .parse(raw);
        if (
          input.parentId &&
          !(
            await client.query(
              "SELECT 1 FROM project_discussions WHERE id=$1 AND space_id=$2 AND deleted_at IS NULL",
              [input.parentId, id],
            )
          ).rowCount
        )
          throw new HttpError(400, "Reply target unavailable.");
        if (
          input.taskId &&
          !(
            await client.query(
              "SELECT 1 FROM tasks WHERE id=$1 AND space_id=$2 AND deleted_at IS NULL",
              [input.taskId, id],
            )
          ).rowCount
        )
          throw new HttpError(400, "Task unavailable.");
        const [discussion] = (
          await client.query(
            "INSERT INTO project_discussions(space_id,project_id,task_id,parent_id,author_id,body) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
            [
              id,
              space.project_id,
              input.taskId,
              input.parentId,
              userId,
              input.body,
            ],
          )
        ).rows;
        await event(client, userId, id, "Added a workspace discussion");
        return discussion;
      }
      throw new HttpError(405, "Unsupported planning action.");
    },
  );
  await notifyWorkspace();
  return json(result, method === "POST" && !child ? 201 : 200);
}

/** Shared transaction-level task service; caller holds lockPlanning. */
export async function mutatePlanningTask(
  client: PoolClient,
  userId: string,
  id: string,
  space: { project_id: string | null },
  child: string | undefined,
  raw: Record<string, any>,
) {
  const [existing] = child
    ? (
        await client.query<PlanningTask>(
          `SELECT ${taskFields(true)} FROM tasks t LEFT JOIN "user" u ON u.id=t.assignee_id WHERE t.id=$1 AND t.space_id=$2 FOR UPDATE OF t`,
          [uuid.parse(child), id],
        )
      ).rows
    : [];
  if (child && !existing) throw new HttpError(404, "Task unavailable.");
  if (existing)
    assertRevision(existing.version, z.number().int().parse(raw.version));
  if (raw.deleted === true || raw.deleted === false) {
    if (!existing) throw new HttpError(400, "Choose a task first.");
    if (
      raw.deleted === true &&
      (
        await client.query(
          "SELECT 1 FROM tasks WHERE parent_id=$1 AND deleted_at IS NULL",
          [child],
        )
      ).rowCount
    )
      throw new HttpError(409, "Move or delete the subtasks first.");
    if (
      raw.deleted === false &&
      existing.parent_id &&
      !(
        await client.query(
          "SELECT 1 FROM tasks WHERE id=$1 AND space_id=$2 AND deleted_at IS NULL",
          [existing.parent_id, id],
        )
      ).rowCount
    )
      throw new HttpError(409, "Restore the parent task first.");
    const [task] = (
      await client.query(
        "UPDATE tasks SET deleted_at=CASE WHEN $2 THEN now() ELSE NULL END,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
        [child, raw.deleted],
      )
    ).rows;
    if (!raw.deleted) dependencyOrder(await planningTasks(client, id));
    await event(
      client,
      userId,
      id,
      `${raw.deleted ? "Deleted" : "Restored"} task: ${task.title}`,
      child,
    );
    return task;
  }
  if (existing?.deleted_at)
    throw new HttpError(409, "Restore this task before editing it.");
  const old = existing ? normalizeTask(existing) : null;
  const input = taskInput.parse({
    ...(old
      ? {
          title: old.title,
          body: old.body,
          status: old.status,
          priority: old.priority,
          assigneeId: old.assignee_id,
          parentId: old.parent_id,
          startOn: old.start_on,
          dueOn: old.due_on,
          estimateHours:
            old.estimate_hours == null ? null : Number(old.estimate_hours),
          labels: old.labels,
          milestoneId: old.milestone_id,
          noteId: old.note_id,
          resourceIds: old.resource_ids,
          dependencies: old.dependencies,
          position: old.position,
        }
      : {}),
    ...raw,
  });
  // The modern evidence set and the legacy single-note field describe the
  // same links. Removing a migrated note must not silently re-add it.
  if (
    old?.note_id &&
    Object.hasOwn(raw, "resourceIds") &&
    !Object.hasOwn(raw, "noteId") &&
    !input.resourceIds.includes(old.note_id)
  )
    input.noteId = null;
  if (
    old?.note_id &&
    Object.hasOwn(raw, "noteId") &&
    input.noteId !== old.note_id &&
    !Object.hasOwn(raw, "resourceIds")
  )
    input.resourceIds = input.resourceIds.filter(
      (resourceId) => resourceId !== old.note_id,
    );
  const taskId = child ?? randomUUID();
  const resources = await validateTask(client, id, input, taskId);
  const fields = [
    input.title,
    input.body,
    input.status,
    input.priority,
    input.assigneeId,
    input.parentId,
    input.startOn,
    input.dueOn,
    input.estimateHours,
    input.labels,
    input.milestoneId,
    input.noteId,
    input.position,
  ];
  const [task] = existing
    ? (
        await client.query(
          "UPDATE tasks SET title=$2,body=$3,status=$4,priority=$5,assignee_id=$6,parent_id=$7,start_on=$8,due_on=$9,estimate_hours=$10,labels=$11,milestone_id=$12,note_id=$13,position=$14,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
          [taskId, ...fields],
        )
      ).rows
    : (
        await client.query(
          "INSERT INTO tasks(id,title,body,status,priority,assignee_id,parent_id,start_on,due_on,estimate_hours,labels,milestone_id,note_id,position,space_id,project_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *",
          [taskId, ...fields, id, space.project_id, userId],
        )
      ).rows;
  // Reconcile changed links only: unchanged dependencies/evidence must not
  // produce deletion/recreation audit events or per-link round trips.
  await client.query(
    "DELETE FROM task_dependencies WHERE task_id=$1 AND NOT(depends_on=ANY($2::uuid[]))",
    [taskId, input.dependencies],
  );
  await client.query(
    "INSERT INTO task_dependencies(task_id,depends_on) SELECT $1,unnest($2::uuid[]) ON CONFLICT DO NOTHING",
    [taskId, [...new Set(input.dependencies)]],
  );
  await client.query(
    "DELETE FROM task_resources WHERE task_id=$1 AND NOT(resource_id=ANY($2::uuid[]))",
    [taskId, resources],
  );
  await client.query(
    "INSERT INTO task_resources(task_id,resource_id) SELECT $1,unnest($2::uuid[]) ON CONFLICT DO NOTHING",
    [taskId, resources],
  );
  await event(
    client,
    userId,
    id,
    `${existing ? "Updated" : "Created"} task: ${input.title}`,
    taskId,
  );
  if (
    input.assigneeId &&
    input.assigneeId !== userId &&
    input.assigneeId !== existing?.assignee_id
  )
    await deliverEvent(client, {
      userId: input.assigneeId,
      spaceId: id,
      kind: "assignments",
      title: `Assigned to you: ${input.title}`,
      taskId,
      dedupe: `assigned:${taskId}:${task.version}`,
    });
  return normalizeTask({
    ...task,
    dependencies: input.dependencies,
    resource_ids: resources,
  });
}

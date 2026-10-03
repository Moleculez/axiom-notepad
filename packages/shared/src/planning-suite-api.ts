import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { transaction } from "./db";
import { HttpError, spaceAccess } from "./access";
import {
  workspaceJson as json,
  workspaceMutation,
  requireScope,
  recordActivity,
} from "./workspace-service";
import {
  lockPlanning,
  mutatePlanningTask,
  planningTasks,
  taskInput,
  validateTask,
} from "./planning-api";
import {
  goalInputSchema,
  intakeInputSchema,
  planningViewStateSchema,
  goalProgress,
  goalProgressContext,
  planningBulkInputSchema,
  nextRecurrenceDates,
} from "./planning-suite";
import { recurrenceSchema } from "./workspace";
import { notifyWorkspace } from "./documents";
const uuid = z.uuid(),
  name = z.string().trim().min(1).max(120);
const date = (value: unknown) =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : value == null
      ? null
      : String(value).slice(0, 10);
export async function planningEntityHistory(
  db: PoolClient,
  user: string,
  space: string,
  entity: string,
  kind: string,
  title: string,
  summary: string,
) {
  await db.query(
    "INSERT INTO planning_history(space_id,entity_id,kind,actor_id,summary) VALUES($1,$2,$3,$4,$5)",
    [space, entity, kind, user, summary],
  );
  await recordActivity(db, {
    spaceId: space,
    userId: user,
    kind: "planning",
    title: `${summary}: ${title}`,
  });
  await db.query(
    `INSERT INTO audit_events(actor_id,actor_name,space_id,group_id,entity_id,entity_type,entity_name,action,after_values)
 SELECT $1,u.name,$2,s.group_id,$3,$4,$5,'update',jsonb_build_object('summary',$6::text) FROM spaces s JOIN "user" u ON u.id=$1 WHERE s.id=$2`,
    [user, space, entity, kind, title, summary],
  );
}
const history = planningEntityHistory;
async function validateGoal(
  db: PoolClient,
  space: string,
  input: z.infer<typeof goalInputSchema>,
) {
  if (
    input.ownerId &&
    !(
      await db.query("SELECT 1 WHERE axiom_space_role($1,$2) IS NOT NULL", [
        input.ownerId,
        space,
      ])
    ).rowCount
  )
    throw new HttpError(400, "Choose an owner with workspace access.");
  for (const [table, ids] of [
    ["tasks", input.taskIds],
    ["project_milestones", input.milestoneIds],
  ] as const) {
    if (
      ids.length &&
      (
        await db.query(
          `SELECT id FROM ${table} WHERE space_id=$1 AND id=ANY($2::uuid[])${table === "tasks" ? " AND deleted_at IS NULL" : ""}`,
          [space, [...new Set(ids)]],
        )
      ).rowCount !== new Set(ids).size
    )
      throw new HttpError(400, "Choose available work in this workspace.");
  }
}
/** Scope-first, version-fenced operations; never exposes anonymous intake. */
export async function planningSuiteApi(
  request: Request,
  path: string[],
  user: string,
): Promise<Response | null> {
  const [root, spaceId, section, id, action] = path,
    method = request.method,
    url = new URL(request.url);
  const recurring =
    section === "recurrences" &&
    !!id &&
    (method === "PATCH" || method === "GET");
  if (
    root !== "spaces" ||
    !spaceId ||
    (![
      "planning-options",
      "planning-views",
      "goals",
      "intake",
      "planning-history",
      "tasks-bulk",
    ].includes(section) &&
      !recurring)
  )
    return null;
  uuid.parse(spaceId);
  const scope = await spaceAccess(user, spaceId);
  if (method === "GET")
    return json(
      await transaction(async (db) => {
        await requireScope(db, user, spaceId);
        if (section === "planning-options") {
          const kind = z
              .enum(["task", "file", "milestone"])
              .parse(url.searchParams.get("kind")),
            q = (url.searchParams.get("q") ?? "").trim().slice(0, 200),
            ids = url.searchParams.get("ids")?.split(",").filter(Boolean);
          if (ids) z.array(uuid).max(100).parse(ids);
          const table =
              kind === "task"
                ? "tasks"
                : kind === "file"
                  ? "resources"
                  : "project_milestones",
            label = kind === "file" ? "name" : "title";
          const rows = (
            await db.query(
              `SELECT r.id,r.${label} AS label FROM ${table} r WHERE r.space_id=$1 ${kind !== "milestone" ? "AND r.deleted_at IS NULL" : ""}
     ${
       kind === "file"
         ? `AND r.kind<>'folder' AND (r.note_id IS NULL OR axiom_can_read_note($4,r.note_id))
       AND NOT EXISTS(WITH RECURSIVE parents AS (SELECT id,parent_id,deleted_at FROM resources WHERE id=r.parent_id UNION SELECT p.id,p.parent_id,p.deleted_at FROM resources p JOIN parents x ON x.parent_id=p.id) SELECT 1 FROM parents WHERE deleted_at IS NOT NULL)`
         : ""
     }
     AND (r.${label} ILIKE $2 OR r.id=ANY($3::uuid[])) ORDER BY r.id=ANY($3::uuid[]) DESC,r.${label},r.id LIMIT 100`,
              [
                spaceId,
                `%${q.replace(/[\\%_]/g, "\\$&")}%`,
                ids ?? [],
                ...(kind === "file" ? [user] : []),
              ],
            )
          ).rows;
          return rows.map((r) => ({ value: r.id, label: r.label }));
        }
        if (section === "planning-views")
          return (
            await db.query(
              "SELECT * FROM planning_views WHERE space_id=$1 AND (user_id=$2 OR user_id IS NULL) ORDER BY user_id NULLS LAST,name LIMIT 200",
              [spaceId, user],
            )
          ).rows;
        if (section === "planning-history")
          return (
            await db.query(
              `SELECT h.id,h.kind,h.summary,h.created_at,u.name AS actor_name FROM planning_history h LEFT JOIN "user" u ON u.id=h.actor_id WHERE space_id=$1 AND entity_id=$2 ORDER BY created_at DESC LIMIT 100`,
              [spaceId, uuid.parse(id)],
            )
          ).rows;
        if (section === "goals") {
          const goals = (
            await db.query(
              "SELECT * FROM planning_goals WHERE space_id=$1 ORDER BY archived,updated_at DESC LIMIT 200",
              [spaceId],
            )
          ).rows;
          const tasks = await planningTasks(db, spaceId),
            milestones = (
              await db.query(
                "SELECT id,completed_at FROM project_milestones WHERE space_id=$1",
                [spaceId],
              )
            ).rows;
          const progressContext = goalProgressContext(tasks, milestones);
          return goals.map((g) => ({
            ...g,
            target: Number(g.target),
            current_value: Number(g.current_value),
            progress: goalProgress(g, tasks, milestones, progressContext),
          }));
        }
        if (section === "intake")
          return {
            canReview: scope.can_manage,
            items: (
              await db.query(
                'SELECT i.*,u.name AS author_name FROM planning_intake i LEFT JOIN "user" u ON u.id=i.created_by WHERE i.space_id=$1 ORDER BY i.updated_at DESC LIMIT 200',
                [spaceId],
              )
            ).rows,
          };
        if (recurring) {
          const row = (
            await db.query(
              "SELECT * FROM task_recurrences WHERE space_id=$1 AND id=$2",
              [spaceId, uuid.parse(id)],
            )
          ).rows[0];
          if (!row) throw new HttpError(404, "Routine unavailable.");
          if (action === "occurrences")
            return (
              await db.query(
                "SELECT o.occurs_on,t.id,t.title,t.status FROM task_occurrences o JOIN tasks t ON t.id=o.task_id WHERE o.recurrence_id=$1 ORDER BY occurs_on DESC LIMIT 100",
                [id],
              )
            ).rows;
          const rule = recurrenceSchema.parse(row.rule),
            today = new Intl.DateTimeFormat("sv-SE", {
              timeZone: scope.timezone,
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(new Date());
          const dates = nextRecurrenceDates(rule, date(row.last_date), today);
          return { dates, enabled: row.enabled, archived: row.archived };
        }
        throw new HttpError(405, "Unsupported planning operation.");
      }),
    );
  if (!["POST", "PATCH", "DELETE"].includes(method))
    throw new HttpError(405, "Unsupported planning operation.");
  const raw = await request.json(),
    mutationId = uuid.parse(raw.mutationId);
  const result = await workspaceMutation(
    user,
    mutationId,
    `planning-suite:${spaceId}:${section}:${id ?? "new"}:${method}`,
    raw,
    async (db) => {
      const space = await lockPlanning(
        db,
        user,
        spaceId,
        section === "intake"
          ? "comment"
          : section === "planning-views"
            ? "read"
            : "edit",
      );
      if (section === "planning-views") {
        const old = id
          ? (
              await db.query(
                "SELECT * FROM planning_views WHERE space_id=$1 AND id=$2 FOR UPDATE",
                [spaceId, uuid.parse(id)],
              )
            ).rows[0]
          : null;
        if (id && !old) throw new HttpError(404, "View unavailable.");
        if (old) {
          if (old.user_id !== null && old.user_id !== user)
            throw new HttpError(403, "This is another member's private view.");
          if (old.version !== raw.version)
            throw new HttpError(
              409,
              "The saved view changed. Reload before saving.",
            );
        }
        const shared = z.boolean().parse(raw.shared ?? old?.user_id === null);
        if (shared || old?.user_id === null)
          await requireScope(db, user, spaceId, "manage");
        if (method === "DELETE") {
          if (!old) throw new HttpError(404, "Choose a saved view.");
          await db.query("DELETE FROM planning_views WHERE id=$1", [id]);
          if (old.user_id === null)
            await history(
              db,
              user,
              spaceId,
              id,
              "planning_view",
              old.name,
              "Deleted shared view",
            );
          return { ok: true };
        }
        const input = z
          .object({ name, state: planningViewStateSchema })
          .parse(raw);
        if (
          !old &&
          (
            await db.query(
              "SELECT count(*)::int AS n FROM planning_views WHERE space_id=$1 AND (user_id=$2 OR user_id IS NULL)",
              [spaceId, user],
            )
          ).rows[0].n >= 200
        )
          throw new HttpError(
            413,
            "This workspace has reached its saved-view limit.",
          );
        const savedView = (
          await db.query(
            old
              ? "UPDATE planning_views SET name=$3,state=$4,user_id=$5,version=version+1,updated_at=now() WHERE id=$1 AND space_id=$2 RETURNING *"
              : "INSERT INTO planning_views(id,space_id,name,state,user_id) VALUES(coalesce($1,gen_random_uuid()),$2,$3,$4,$5) RETURNING *",
            [
              id ?? null,
              spaceId,
              input.name,
              input.state,
              shared ? null : user,
            ],
          )
        ).rows[0];
        if (shared || old?.user_id === null)
          await history(
            db,
            user,
            spaceId,
            savedView.id,
            "planning_view",
            input.name,
            old ? "Updated shared view" : "Created shared view",
          );
        return savedView;
      }
      if (section === "goals") {
        if (!["POST", "PATCH"].includes(method))
          throw new HttpError(
            405,
            "Archive goals instead of deleting their history.",
          );
        const old = id
          ? (
              await db.query(
                "SELECT * FROM planning_goals WHERE space_id=$1 AND id=$2 FOR UPDATE",
                [spaceId, uuid.parse(id)],
              )
            ).rows[0]
          : null;
        if (id && !old) throw new HttpError(404, "Goal unavailable.");
        if (old && old.version !== raw.version)
          throw new HttpError(409, "The goal changed. Reload before saving.");
        const input = goalInputSchema.parse({
          ...old,
          ...(old
            ? {
                ownerId: old.owner_id,
                dueOn: date(old.due_on),
                currentValue: Number(old.current_value),
                target: Number(old.target),
                taskIds: old.task_ids,
                milestoneIds: old.milestone_ids,
              }
            : {}),
          ...raw,
        });
        if (
          !old &&
          (
            await db.query(
              "SELECT count(*)::int AS n FROM planning_goals WHERE space_id=$1",
              [spaceId],
            )
          ).rows[0].n >= 200
        )
          throw new HttpError(
            413,
            "This workspace has reached its goal limit.",
          );
        await validateGoal(db, spaceId, input);
        const values = [
          id ?? null,
          spaceId,
          input.title,
          input.body,
          input.ownerId,
          input.dueOn,
          input.kind,
          input.target,
          input.currentValue,
          input.unit,
          input.taskIds,
          input.milestoneIds,
          input.archived,
          user,
        ];
        const row = (
          await db.query(
            old
              ? `UPDATE planning_goals SET title=$3,body=$4,owner_id=$5,due_on=$6,kind=$7,target=$8,current_value=$9,unit=$10,task_ids=$11,milestone_ids=$12,archived=$13,version=version+1,updated_at=now() WHERE id=$1 AND space_id=$2 AND $14::text IS NOT NULL RETURNING *`
              : `INSERT INTO planning_goals(id,space_id,title,body,owner_id,due_on,kind,target,current_value,unit,task_ids,milestone_ids,archived,created_by) VALUES(coalesce($1,gen_random_uuid()),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
            values,
          )
        ).rows[0];
        await history(
          db,
          user,
          spaceId,
          row.id,
          "goal",
          row.title,
          old
            ? input.archived !== old.archived
              ? input.archived
                ? "Archived goal"
                : "Reopened goal"
              : "Updated goal"
            : "Created goal",
        );
        return row;
      }
      if (section === "intake") {
        if (!["POST", "PATCH"].includes(method))
          throw new HttpError(
            405,
            "Withdraw requests instead of deleting their history.",
          );
        const old = id
          ? (
              await db.query(
                "SELECT * FROM planning_intake WHERE space_id=$1 AND id=$2 FOR UPDATE",
                [spaceId, uuid.parse(id)],
              )
            ).rows[0]
          : null;
        if (id && !old) throw new HttpError(404, "Request unavailable.");
        if (old && old.version !== raw.version)
          throw new HttpError(
            409,
            "The request changed. Reload before continuing.",
          );
        if (old && raw.decision) {
          const decision = z
            .enum(["accepted", "rejected", "needs-changes", "withdrawn"])
            .parse(raw.decision);
          if (!["pending", "needs-changes"].includes(old.status))
            throw new HttpError(409, "This request has already been decided.");
          if (decision === "withdrawn") {
            if (old.created_by !== user)
              await requireScope(db, user, spaceId, "manage");
          } else await requireScope(db, user, spaceId, "manage");
          const note = z
            .string()
            .trim()
            .max(4000)
            .parse(raw.note ?? "");
          if (["rejected", "needs-changes"].includes(decision) && !note)
            throw new HttpError(
              400,
              "Explain what needs to change or why the request was rejected.",
            );
          let taskId = null;
          if (decision === "accepted") {
            await requireScope(db, user, spaceId, "edit");
            if (old.status !== "pending")
              throw new HttpError(
                409,
                "The author must resubmit this request before acceptance.",
              );
            const task = await mutatePlanningTask(
              db,
              user,
              spaceId,
              space,
              undefined,
              {
                title: old.title,
                body: old.body,
                dueOn: date(old.due_on),
                priority: old.priority,
                ...(raw.task ?? {}),
              },
            );
            taskId = task.id;
          }
          const row = (
            await db.query(
              "UPDATE planning_intake SET status=$3,decision_note=$4,reviewed_by=$5,task_id=$6,version=version+1,updated_at=now() WHERE id=$1 AND space_id=$2 RETURNING *",
              [id, spaceId, decision, note, user, taskId],
            )
          ).rows[0];
          await history(
            db,
            user,
            spaceId,
            row.id,
            "intake",
            row.title,
            `Request ${decision}`,
          );
          return row;
        }
        if (
          old &&
          (old.created_by !== user ||
            !["pending", "needs-changes"].includes(old.status))
        )
          throw new HttpError(
            403,
            "Only the author can edit an undecided request.",
          );
        const input = intakeInputSchema.parse({
          ...old,
          ...(old ? { dueOn: date(old.due_on) } : {}),
          ...raw,
        });
        const values = [
          id ?? null,
          spaceId,
          input.kind,
          input.title,
          input.body,
          input.dueOn,
          input.priority,
          user,
        ];
        const row = (
          await db.query(
            old
              ? `UPDATE planning_intake SET kind=$3,title=$4,body=$5,due_on=$6,priority=$7,status='pending',version=version+1,updated_at=now() WHERE id=$1 AND space_id=$2 AND created_by=$8 RETURNING *`
              : `INSERT INTO planning_intake(id,space_id,kind,title,body,due_on,priority,created_by) VALUES(coalesce($1,gen_random_uuid()),$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            values,
          )
        ).rows[0];
        await history(
          db,
          user,
          spaceId,
          row.id,
          "intake",
          row.title,
          old ? "Resubmitted request" : "Submitted request",
        );
        return row;
      }
      if (section === "tasks-bulk") {
        if (method !== "POST")
          throw new HttpError(405, "Use a reviewed bulk update.");
        const input = planningBulkInputSchema.parse(raw);
        const tasks = (
          await db.query(
            "SELECT id,parent_id FROM tasks WHERE space_id=$1 LIMIT 50001",
            [spaceId],
          )
        ).rows;
        if (tasks.length > 50000)
          throw new HttpError(
            413,
            "This workspace exceeds the bulk task graph limit.",
          );
        const byId = new Map(tasks.map((t) => [t.id, t]));
        const depth = (id: string) => {
          let n = 0,
            t = byId.get(id);
          while (t?.parent_id && n < 50000) {
            n++;
            t = byId.get(t.parent_id);
          }
          return n;
        };
        const items = [...input.items].sort((a, b) =>
          input.patch.deleted
            ? depth(b.id) - depth(a.id)
            : depth(a.id) - depth(b.id),
        );
        const rows = [];
        for (const item of items)
          rows.push(
            await mutatePlanningTask(db, user, spaceId, space, item.id, {
              ...input.patch,
              version: item.version,
            }),
          );
        return { count: rows.length, items: rows };
      }
      if (recurring) {
        const row = (
          await db.query(
            "SELECT * FROM task_recurrences WHERE id=$1 AND space_id=$2 FOR UPDATE",
            [uuid.parse(id), spaceId],
          )
        ).rows[0];
        if (!row) throw new HttpError(404, "Routine unavailable.");
        if (row.version !== raw.version)
          throw new HttpError(
            409,
            "The routine changed. Reload before saving.",
          );
        const rule = recurrenceSchema.parse(raw.rule ?? row.rule),
          template = taskInput.parse(raw.template ?? row.template),
          archived = z.boolean().parse(raw.archived ?? row.archived),
          enabled = !archived && z.boolean().parse(raw.enabled ?? row.enabled);
        if (
          template.parentId ||
          template.dependencies.length ||
          template.dependencyLinks?.length
        )
          throw new HttpError(
            400,
            "Recurring tasks cannot copy parent or dependency links.",
          );
        await validateTask(db, spaceId, template, randomUUID());
        const saved = (
          await db.query(
            "UPDATE task_recurrences SET rule=$3,template=$4,enabled=$5,archived=$6,version=version+1 WHERE id=$1 AND space_id=$2 RETURNING *",
            [id, spaceId, rule, template, enabled, archived],
          )
        ).rows[0];
        await history(
          db,
          user,
          spaceId,
          id,
          "routine",
          template.title,
          archived
            ? "Archived routine"
            : "Updated routine (future occurrences only)",
        );
        return saved;
      }
      throw new HttpError(405, "Unsupported planning action.");
    },
  );
  await notifyWorkspace();
  return json(result);
}

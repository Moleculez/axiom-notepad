import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import { z } from "zod";
import type pg from "pg";
import { query } from "./db";
import { HttpError, memberAccess, noteAccess, projectAccess } from "./access";
import { flushNote, notifyWorkspace } from "./documents";
import {
  contentRoleSchema,
  dateOnlySchema,
  recurrenceSchema,
  resourceNameSchema,
  taskPrioritySchema,
  taskStatusSchema,
  timezoneSchema,
} from "./workspace";
import {
  workspaceJson as json,
  workspaceMutation,
  requireScope,
  assertGroupActive,
  recordActivity,
  deliverEvent,
  assertRevision,
} from "./workspace-service";
import { lifecycleSpace, transitionSpace } from "./space-lifecycle";
import { planningApi } from "./planning-api";

const uuid = z.uuid(),
  user = z.string().min(1).max(100),
  mutationId = uuid.default(() => randomUUID());
const taskFields = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(100_000).default(""),
  status: taskStatusSchema.default("todo"),
  priority: taskPrioritySchema.default("normal"),
  parentId: uuid.nullable().default(null),
  assigneeId: user.nullable().default(null),
  startOn: dateOnlySchema.nullable().default(null),
  dueOn: dateOnlySchema.nullable().default(null),
  estimateHours: z.number().min(0).max(10000).nullable().default(null),
  labels: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  milestoneId: uuid.nullable().default(null),
  noteId: uuid.nullable().default(null),
  dependencies: z.array(uuid).max(100).default([]),
});
type TaskInput = z.infer<typeof taskFields>;
async function validateTask(
  client: pg.PoolClient,
  projectId: string,
  spaceId: string,
  input: TaskInput,
  id?: string,
) {
  if (input.startOn && input.dueOn && input.startOn > input.dueOn)
    throw new HttpError(400, "A task cannot end before it starts.");
  if (input.assigneeId) {
    const {
      rows: [access],
    } = await client.query("SELECT axiom_space_role($1,$2) AS role", [
      input.assigneeId,
      spaceId,
    ]);
    if (!access.role)
      throw new HttpError(
        400,
        "The assignee must have access to this project.",
      );
  }
  if (input.parentId) {
    const { rows } = await client.query(
      "SELECT id FROM tasks WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL",
      [input.parentId, projectId],
    );
    if (!rows.length || input.parentId === id)
      throw new HttpError(
        400,
        "Choose a different parent task in this project.",
      );
    if (
      id &&
      (
        await client.query(
          "WITH RECURSIVE parents AS (SELECT id,parent_id FROM tasks WHERE id=$1 UNION SELECT t.id,t.parent_id FROM tasks t JOIN parents p ON t.id=p.parent_id) SELECT id FROM parents WHERE id=$2",
          [input.parentId, id],
        )
      ).rowCount
    )
      throw new HttpError(400, "Subtasks cannot form a cycle.");
  }
  if (
    input.milestoneId &&
    !(
      await client.query(
        "SELECT 1 FROM project_milestones WHERE id=$1 AND project_id=$2",
        [input.milestoneId, projectId],
      )
    ).rowCount
  )
    throw new HttpError(400, "Choose a milestone in this project.");
  if (
    input.noteId &&
    !(
      await client.query(
        "SELECT 1 FROM resources WHERE note_id=$1 AND space_id=$2 AND deleted_at IS NULL",
        [input.noteId, spaceId],
      )
    ).rowCount
  )
    throw new HttpError(
      400,
      "Link a note inside this project. Copy personal work into the project explicitly first.",
    );
  const dependencies = [...new Set(input.dependencies)];
  if (dependencies.includes(id ?? ""))
    throw new HttpError(400, "A task cannot depend on itself.");
  if (dependencies.length) {
    const { rows } = await client.query(
      "SELECT id FROM tasks WHERE id=ANY($1::uuid[]) AND project_id=$2 AND deleted_at IS NULL",
      [dependencies, projectId],
    );
    if (rows.length !== dependencies.length)
      throw new HttpError(400, "Dependencies must belong to this project.");
    if (
      id &&
      (
        await client.query(
          "WITH RECURSIVE dependencies AS (SELECT depends_on FROM task_dependencies WHERE task_id=ANY($1::uuid[]) UNION SELECT d.depends_on FROM task_dependencies d JOIN dependencies x ON x.depends_on=d.task_id) SELECT 1 FROM dependencies WHERE depends_on=$2",
          [dependencies, id],
        )
      ).rowCount
    )
      throw new HttpError(400, "Task dependencies cannot form a cycle.");
  }
  return dependencies;
}
const taskSelect = `t.*,u.name AS assignee_name,EXISTS(SELECT 1 FROM task_dependencies d JOIN tasks blocker ON blocker.id=d.depends_on WHERE d.task_id=t.id AND blocker.deleted_at IS NULL AND blocker.status NOT IN ('done','cancelled')) AS blocked,coalesce((SELECT jsonb_agg(d.depends_on) FROM task_dependencies d WHERE d.task_id=t.id),'[]'::jsonb) AS dependencies,(SELECT count(*)::int FROM tasks child WHERE child.parent_id=t.id AND child.deleted_at IS NULL) AS subtask_count`;

export async function projectsApi(
  request: Request,
  path: string[],
  userId: string,
): Promise<Response | null> {
  // Legacy project URLs are adapters, never a separate planning write engine.
  const planning = await planningApi(request, path, userId);
  if (planning) return planning;
  const [endpoint, id, action, childId] = path,
    method = request.method,
    url = new URL(request.url);
  if (endpoint === "projects" && !id && method === "GET")
    return json(
      await query(
        `SELECT p.*,s.id AS space_id,g.name AS group_name,axiom_space_role($1,s.id) AS role,axiom_manage_space($1,s.id) AS can_manage,(SELECT count(*)::int FROM tasks t WHERE t.project_id=p.id AND t.deleted_at IS NULL AND t.status NOT IN ('done','cancelled')) AS open_tasks,(SELECT count(*)::int FROM resources r WHERE r.space_id=s.id AND r.deleted_at IS NULL) AS resource_count FROM projects p JOIN spaces s ON s.project_id=p.id JOIN groups g ON g.id=p.group_id WHERE axiom_space_role($1,s.id) IS NOT NULL ORDER BY p.archived_at NULLS FIRST,p.created_at DESC`,
        [userId],
      ),
    );
  if (endpoint === "projects" && !id && method === "POST") {
    const input = z
      .object({
        mutationId,
        groupId: uuid,
        name: resourceNameSchema,
        description: z.string().max(3000).default(""),
        color: z.enum(["blue", "green", "purple", "orange"]).default("blue"),
        audience: z.enum(["restricted", "group"]).default("restricted"),
        timezone: timezoneSchema.default("UTC"),
      })
      .parse(await request.json());
    const member = await memberAccess(userId, input.groupId);
    if (member.role === "member" && member.content_role !== "editor")
      throw new HttpError(
        403,
        "Your group role does not allow creating projects.",
      );
    const result = await workspaceMutation(
      userId,
      input.mutationId,
      "create-project",
      input,
      async (client) => {
        await assertGroupActive(client, input.groupId);
        const {
          rows: [project],
        } = await client.query(
          "INSERT INTO projects(group_id,name,description,color,audience,timezone,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [
            input.groupId,
            input.name,
            input.description,
            input.color,
            input.audience,
            input.timezone,
            userId,
          ],
        );
        const [space] = (
          await client.query("SELECT id FROM spaces WHERE project_id=$1", [
            project.id,
          ])
        ).rows;
        return { ...project, space_id: space.id };
      },
    );
    await notifyWorkspace();
    return json(result, 201);
  }
  if (endpoint === "projects" && id) {
    uuid.parse(id);
    const memberManager =
      action === "members" &&
      method === "GET" &&
      (
        await query(
          "SELECT axiom_manage_space($1,id) AS allowed FROM spaces WHERE project_id=$2",
          [userId, id],
        )
      )[0]?.allowed;
    const manage =
      memberManager ||
      (!action && method === "PATCH") ||
      (action === "members" && method !== "GET");
    const { project, space } = await projectAccess(
      userId,
      id,
      manage ? "manage" : "read",
      !!memberManager || (!action && method === "PATCH"),
    );
    if (!action && method === "GET") {
      const counts = (
        await query(
          "SELECT count(*) FILTER(WHERE status='todo')::int AS todo,count(*) FILTER(WHERE status='in_progress')::int AS in_progress,count(*) FILTER(WHERE status='in_review')::int AS in_review,count(*) FILTER(WHERE status='done')::int AS done FROM tasks WHERE project_id=$1 AND deleted_at IS NULL",
          [id],
        )
      )[0];
      return json({
        ...project,
        role: space.role,
        can_manage: space.can_manage,
        counts,
      });
    }
    if (!action && method === "PATCH") {
      const input = z
        .object({
          mutationId,
          version: z.number().int().positive(),
          name: resourceNameSchema.optional(),
          description: z.string().max(3000).optional(),
          timezone: timezoneSchema.optional(),
          color: z.enum(["blue", "green", "purple", "orange"]).optional(),
          audience: z.enum(["restricted", "group"]).optional(),
          confirmAudience: z.boolean().default(false),
          archived: z.boolean().optional(),
        })
        .parse(await request.json());
      if (
        input.audience &&
        input.audience !== project.audience &&
        !input.confirmAudience
      )
        throw new HttpError(
          400,
          "Confirm the new project audience before changing access.",
        );
      const result = await workspaceMutation(
        userId,
        input.mutationId,
        "update-project:" + id,
        input,
        async (client) => {
          await client.query(
            "SELECT id FROM groups WHERE id=$1 FOR NO KEY UPDATE",
            [space.group_id],
          );
          await client.query("SELECT id FROM spaces WHERE id=$1 FOR UPDATE", [
            space.id,
          ]);
          const locked = await lifecycleSpace(client, userId, space.id);
          const unarchiving =
            input.archived === false &&
            locked.lifecycle_actions.includes("unarchive");
          if (locked.effective_status !== "active" && !unarchiving)
            throw new HttpError(
              409,
              "Restore the workspace before changing project settings.",
            );
          await requireScope(
            client,
            userId,
            space.id,
            "manage",
            input.archived !== undefined,
          );
          const {
            rows: [current],
          } = await client.query(
            "SELECT * FROM projects WHERE id=$1 FOR UPDATE",
            [id],
          );
          assertRevision(current.version, input.version);
          const transitioned =
            input.archived !== undefined &&
            input.archived !== !!current.archived_at;
          if (transitioned)
            await transitionSpace(
              client,
              userId,
              space.id,
              input.archived ? "archive" : "unarchive",
            );
          else
            await client.query(
              "UPDATE spaces SET version=version+1 WHERE id=$1",
              [space.id],
            );
          const {
            rows: [row],
          } = await client.query(
            "UPDATE projects SET name=$2,description=$3,timezone=$4,audience=$5,version=version+$6,color=$7 WHERE id=$1 RETURNING *",
            [
              id,
              input.name ?? current.name,
              input.description ?? current.description,
              input.timezone ?? current.timezone,
              input.audience ?? current.audience,
              transitioned ? 0 : 1,
              input.color ?? current.color,
            ],
          );
          await recordActivity(client, {
            userId,
            spaceId: space.id,
            kind: "project-settings",
            title: "Updated project settings",
          });
          await client.query(
            "UPDATE spaces SET name=$2,description=$3,color=$4,timezone=$5,planning_version=planning_version+1 WHERE id=$1",
            [space.id, row.name, row.description, row.color, row.timezone],
          );
          return row;
        },
      );
      await notifyWorkspace(true);
      return json(result);
    }
    if (action === "members") {
      if (method === "GET")
        return json(
          await query(
            `SELECT u.id,u.name,u.image,m.role AS group_role,coalesce(pm.role,m.content_role) AS role,coalesce(pm.can_manage,false) AS can_manage,pm.user_id IS NOT NULL AS explicit FROM members m JOIN "user" u ON u.id=m.user_id LEFT JOIN project_members pm ON pm.user_id=m.user_id AND pm.project_id=$2 WHERE m.group_id=$1 AND ($3='group' OR pm.user_id IS NOT NULL) ORDER BY u.name`,
            [project.group_id, id, project.audience],
          ),
        );
      if (method === "POST") {
        const input = z
          .object({
            mutationId,
            userId: user,
            role: contentRoleSchema.default("editor"),
            canManage: z.boolean().default(false),
            remove: z.boolean().default(false),
          })
          .parse(await request.json());
        await memberAccess(input.userId, project.group_id);
        const result = await workspaceMutation(
          userId,
          input.mutationId,
          "project-member:" + id,
          input,
          async (client) => {
            await client.query("SELECT id FROM spaces WHERE id=$1 FOR UPDATE", [
              space.id,
            ]);
            await requireScope(client, userId, space.id, "manage");
            const {
              rows: [current],
            } = await client.query(
              "SELECT * FROM project_members WHERE project_id=$1 AND user_id=$2",
              [id, input.userId],
            );
            if (current?.can_manage && (input.remove || !input.canManage)) {
              const {
                rows: [count],
              } = await client.query(
                "SELECT count(*)::int AS n FROM project_members WHERE project_id=$1 AND can_manage",
                [id],
              );
              if (count.n <= 1)
                throw new HttpError(
                  409,
                  "Assign another project lead before removing the last lead.",
                );
            }
            if (input.remove)
              await client.query(
                "DELETE FROM project_members WHERE project_id=$1 AND user_id=$2",
                [id, input.userId],
              );
            else
              await client.query(
                "INSERT INTO project_members(project_id,user_id,role,can_manage) VALUES($1,$2,$3,$4) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role,can_manage=excluded.can_manage",
                [id, input.userId, input.role, input.canManage],
              );
            await recordActivity(client, {
              userId,
              spaceId: space.id,
              kind: "access",
              title: input.remove
                ? "Removed a project membership"
                : "Updated a project membership",
            });
            return { ok: true };
          },
        );
        await notifyWorkspace(true);
        return json(result);
      }
    }
    if (action === "tasks") {
      if (method === "GET") {
        const limit = z.coerce
          .number()
          .int()
          .min(1)
          .max(200)
          .parse(url.searchParams.get("limit") ?? 100);
        const offset = z.coerce
          .number()
          .int()
          .min(0)
          .max(100000)
          .parse(url.searchParams.get("offset") ?? 0);
        const status = url.searchParams.get("status")
          ? taskStatusSchema.parse(url.searchParams.get("status"))
          : null;
        const items = await query(
          `SELECT ${taskSelect} FROM tasks t LEFT JOIN "user" u ON u.id=t.assignee_id WHERE t.project_id=$1 AND t.deleted_at IS NULL AND ($2::text IS NULL OR t.status=$2) ORDER BY t.created_at DESC,t.id LIMIT $3 OFFSET $4`,
          [id, status, limit + 1, offset],
        );
        return json({
          items: items.slice(0, limit),
          nextOffset: items.length > limit ? offset + limit : null,
        });
      }
      if (method === "POST") {
        await projectAccess(userId, id, "edit");
        if (project.archived_at)
          throw new HttpError(
            409,
            "Restore the archived project before adding tasks.",
          );
        const input = taskFields
          .extend({ mutationId })
          .parse(await request.json());
        const result = await workspaceMutation(
          userId,
          input.mutationId,
          "create-task:" + id,
          input,
          async (client) => {
            await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
              id,
            ]);
            await requireScope(client, userId, space.id, "edit");
            const dependencies = await validateTask(
              client,
              id,
              space.id,
              input,
            );
            const {
              rows: [task],
            } = await client.query(
              "INSERT INTO tasks(project_id,created_by,title,body,status,priority,parent_id,assignee_id,start_on,due_on,estimate_hours,labels,milestone_id,note_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *",
              [
                id,
                userId,
                input.title,
                input.body,
                input.status,
                input.priority,
                input.parentId,
                input.assigneeId,
                input.startOn,
                input.dueOn,
                input.estimateHours,
                input.labels,
                input.milestoneId,
                input.noteId,
              ],
            );
            for (const dependency of dependencies)
              await client.query(
                "INSERT INTO task_dependencies(task_id,depends_on) VALUES($1,$2)",
                [task.id, dependency],
              );
            await recordActivity(client, {
              userId,
              spaceId: space.id,
              kind: "task",
              title: `Created ${input.title}`,
              taskId: task.id,
            });
            if (input.assigneeId && input.assigneeId !== userId)
              await deliverEvent(client, {
                userId: input.assigneeId,
                spaceId: space.id,
                kind: "assignments",
                title: `Assigned to you: ${input.title}`,
                taskId: task.id,
                dedupe: `assigned:${task.id}:1`,
              });
            return task;
          },
        );
        await notifyWorkspace();
        return json(result, 201);
      }
    }
    if (action === "milestones") {
      if (method === "GET")
        return json(
          await query(
            "SELECT m.*,(SELECT count(*)::int FROM tasks t WHERE t.milestone_id=m.id AND t.deleted_at IS NULL) AS tasks,(SELECT count(*)::int FROM tasks t WHERE t.milestone_id=m.id AND t.deleted_at IS NULL AND t.status='done') AS completed_tasks FROM project_milestones m WHERE m.project_id=$1 ORDER BY m.due_on NULLS LAST,m.title",
            [id],
          ),
        );
      if (method === "POST") {
        const input = z
          .object({
            mutationId,
            id: uuid.optional(),
            version: z.number().int().optional(),
            title: resourceNameSchema,
            dueOn: dateOnlySchema.nullable().default(null),
            completed: z.boolean().default(false),
          })
          .parse(await request.json());
        const result = await workspaceMutation(
          userId,
          input.mutationId,
          "milestone:" + id,
          input,
          async (client) => {
            await requireScope(client, userId, space.id, "edit");
            if (input.id) {
              const {
                rows: [current],
              } = await client.query(
                "SELECT * FROM project_milestones WHERE id=$1 AND project_id=$2 FOR UPDATE",
                [input.id, id],
              );
              if (!current) throw new HttpError(404, "Milestone unavailable.");
              assertRevision(current.version, input.version ?? 0);
              return (
                await client.query(
                  "UPDATE project_milestones SET title=$2,due_on=$3,completed_at=$4,version=version+1 WHERE id=$1 RETURNING *",
                  [
                    input.id,
                    input.title,
                    input.dueOn,
                    input.completed ? new Date() : null,
                  ],
                )
              ).rows[0];
            }
            return (
              await client.query(
                "INSERT INTO project_milestones(project_id,title,due_on) VALUES($1,$2,$3) RETURNING *",
                [id, input.title, input.dueOn],
              )
            ).rows[0];
          },
        );
        return json(result, 201);
      }
    }
    if (action === "recurrences") {
      if (method === "GET")
        return json(
          await query(
            "SELECT * FROM task_recurrences WHERE project_id=$1 ORDER BY id",
            [id],
          ),
        );
      if (method === "POST") {
        const input = z
          .object({ mutationId, rule: recurrenceSchema, template: taskFields })
          .parse(await request.json());
        const result = await workspaceMutation(
          userId,
          input.mutationId,
          "recurrence:" + id,
          input,
          async (client) => {
            await requireScope(client, userId, space.id, "edit");
            await validateTask(client, id, space.id, input.template);
            // Recurring instances are independent tasks, not copies of a dependency graph.
            if (input.template.dependencies.length || input.template.parentId)
              throw new HttpError(
                400,
                "Recurring tasks cannot copy dependencies or parent relationships.",
              );
            return (
              await client.query(
                "INSERT INTO task_recurrences(project_id,created_by,rule,template) VALUES($1,$2,$3,$4) RETURNING *",
                [
                  id,
                  userId,
                  JSON.stringify(input.rule),
                  JSON.stringify(input.template),
                ],
              )
            ).rows[0];
          },
        );
        return json(result, 201);
      }
      if (childId && method === "PATCH") {
        const input = z
          .object({
            version: z.number().int().positive(),
            enabled: z.boolean(),
          })
          .parse(await request.json());
        await projectAccess(userId, id, "edit");
        const [updated] = await query(
          "UPDATE task_recurrences SET enabled=$3,version=version+1 WHERE id=$1 AND project_id=$2 AND version=$4 RETURNING *",
          [uuid.parse(childId), id, input.enabled, input.version],
        );
        if (!updated)
          throw new HttpError(409, "The recurrence changed elsewhere.");
        return json(updated);
      }
    }
    if (action === "discussions") {
      if (method === "GET")
        return json(
          await query(
            'SELECT d.*,u.name AS author_name FROM project_discussions d JOIN "user" u ON u.id=d.author_id WHERE d.project_id=$1 AND d.deleted_at IS NULL ORDER BY d.created_at DESC LIMIT 100',
            [id],
          ),
        );
      if (method === "POST") {
        const input = z
          .object({
            mutationId,
            body: z.string().trim().min(1).max(20000),
            taskId: uuid.nullable().default(null),
            parentId: uuid.nullable().default(null),
            mentions: z.array(user).max(30).default([]),
          })
          .parse(await request.json());
        const result = await workspaceMutation(
          userId,
          input.mutationId,
          "discussion:" + id,
          input,
          async (client) => {
            await requireScope(client, userId, space.id, "comment");
            if (
              input.taskId &&
              !(
                await client.query(
                  "SELECT 1 FROM tasks WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL",
                  [input.taskId, id],
                )
              ).rowCount
            )
              throw new HttpError(400, "Task unavailable.");
            if (
              input.parentId &&
              !(
                await client.query(
                  "SELECT 1 FROM project_discussions WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL",
                  [input.parentId, id],
                )
              ).rowCount
            )
              throw new HttpError(400, "Discussion unavailable.");
            const {
              rows: [discussion],
            } = await client.query(
              "INSERT INTO project_discussions(project_id,task_id,parent_id,author_id,body) VALUES($1,$2,$3,$4,$5) RETURNING *",
              [id, input.taskId, input.parentId, userId, input.body],
            );
            for (const recipient of new Set(input.mentions))
              if (recipient !== userId)
                await deliverEvent(client, {
                  userId: recipient,
                  spaceId: space.id,
                  kind: "mentions",
                  title: "You were mentioned in a project discussion",
                  taskId: input.taskId ?? undefined,
                  dedupe: `mention:${discussion.id}:${recipient}`,
                });
            await recordActivity(client, {
              userId,
              spaceId: space.id,
              kind: "discussion",
              title: "Added a project discussion",
              taskId: input.taskId ?? undefined,
            });
            return discussion;
          },
        );
        await notifyWorkspace();
        return json(result, 201);
      }
    }
    if (action === "activity" && method === "GET")
      return json(
        await query(
          'SELECT a.*,u.name AS actor_name FROM workspace_activity a LEFT JOIN "user" u ON u.id=a.actor_id WHERE a.space_id=$1 ORDER BY a.created_at DESC LIMIT 100',
          [space.id],
        ),
      );
    if (action === "workload" && method === "GET")
      return json(
        await query(
          `SELECT u.id,u.name,coalesce(pr.weekly_capacity,40) AS weekly_capacity,count(t.id)::int AS open_tasks,count(t.id) FILTER(WHERE t.estimate_hours IS NULL)::int AS unestimated,coalesce(sum(t.estimate_hours),0) AS estimated_hours FROM members m JOIN "user" u ON u.id=m.user_id LEFT JOIN user_profiles pr ON pr.user_id=u.id LEFT JOIN tasks t ON t.assignee_id=u.id AND t.project_id=$1 AND t.deleted_at IS NULL AND t.status NOT IN ('done','cancelled') WHERE m.group_id=$2 AND axiom_space_role(u.id,$3) IS NOT NULL GROUP BY u.id,u.name,pr.weekly_capacity ORDER BY u.name`,
          [id, project.group_id, space.id],
        ),
      );
    if (action === "reviews") {
      if (method === "GET")
        return json(
          await query(
            `SELECT r.*,n.title AS note_title,s.body AS reviewed_body,u.name AS reviewer_name,(n.body IS DISTINCT FROM s.body OR n.generation<>s.generation) AS outdated FROM review_requests r JOIN notes n ON n.id=r.note_id JOIN snapshots s ON s.id=r.snapshot_id JOIN "user" u ON u.id=r.reviewer_id WHERE r.project_id=$1 AND axiom_can_read_note($2,n.id) ORDER BY r.created_at DESC LIMIT 100`,
            [id, userId],
          ),
        );
      if (method === "POST") {
        const input = z
          .object({
            mutationId,
            noteId: uuid,
            reviewerId: user,
            message: z.string().max(5000).default(""),
          })
          .parse(await request.json());
        await projectAccess(userId, id, "edit");
        const note = await noteAccess(userId, input.noteId);
        if (note.space_id !== space.id)
          throw new HttpError(400, "Review a note inside this project.");
        await flushNote(note);
        const result = await workspaceMutation(
          userId,
          input.mutationId,
          "request-review:" + id,
          input,
          async (client) => {
            await requireScope(client, userId, space.id, "edit");
            const {
              rows: [reviewer],
            } = await client.query("SELECT axiom_space_role($1,$2) AS role", [
              input.reviewerId,
              space.id,
            ]);
            if (!["commenter", "editor"].includes(reviewer.role))
              throw new HttpError(
                400,
                "The reviewer needs commenter or editor access.",
              );
            const {
              rows: [current],
            } = await client.query(
              "SELECT n.*,d.state FROM notes n JOIN documents d ON d.room=n.id::text||':'||n.generation::text WHERE n.id=$1 FOR UPDATE OF n",
              [input.noteId],
            );
            const doc = new Y.Doc();
            let body: string;
            try {
              Y.applyUpdate(doc, current.state);
              body = doc.getText("markdown").toString();
            } finally {
              doc.destroy();
            }
            const {
              rows: [snapshot],
            } = await client.query(
              "INSERT INTO snapshots(note_id,title,body,state,generation,label,author_id) VALUES($1,$2,$3,$4,$5,'Review request',$6) RETURNING id",
              [
                input.noteId,
                current.title,
                body,
                current.state,
                current.generation,
                userId,
              ],
            );
            const {
              rows: [review],
            } = await client.query(
              "INSERT INTO review_requests(project_id,note_id,snapshot_id,requested_by,reviewer_id,message) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
              [
                id,
                input.noteId,
                snapshot.id,
                userId,
                input.reviewerId,
                input.message,
              ],
            );
            await deliverEvent(client, {
              userId: input.reviewerId,
              spaceId: space.id,
              kind: "reviews",
              title: `Review requested: ${current.title}`,
              resourceId: input.noteId,
              dedupe: "review:" + review.id,
            });
            await recordActivity(client, {
              userId,
              spaceId: space.id,
              kind: "review",
              title: `Requested review of ${current.title}`,
              resourceId: input.noteId,
            });
            return review;
          },
        );
        await notifyWorkspace();
        return json(result, 201);
      }
    }
  }
  if (endpoint === "tasks" && id) {
    const [current] = await query(
      `SELECT ${taskSelect} FROM tasks t LEFT JOIN "user" u ON u.id=t.assignee_id WHERE t.id=$1 AND t.deleted_at IS NULL`,
      [uuid.parse(id)],
    );
    if (!current) throw new HttpError(404, "Task unavailable.");
    const { project, space } = await projectAccess(
      userId,
      current.project_id,
      method === "GET" ? "read" : "edit",
    );
    if (method === "GET") return json(current);
    if (method === "PATCH") {
      if (project.archived_at)
        throw new HttpError(
          409,
          "Restore the archived project before editing tasks.",
        );
      const raw = await request.json();
      const parsed = taskFields
        .partial()
        .extend({
          mutationId,
          version: z.number().int().positive(),
          deleted: z.boolean().optional(),
        })
        .parse(raw);
      // Zod 4 applies inner defaults even inside optional fields. A PATCH must
      // preserve fields that the caller omitted, including task relationships.
      const patch = Object.fromEntries(
        Object.entries(parsed).filter(
          ([key]) => key === "mutationId" || Object.hasOwn(raw, key),
        ),
      ) as typeof parsed;
      const result = await workspaceMutation(
        userId,
        patch.mutationId,
        "update-task:" + id,
        patch,
        async (client) => {
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
            current.project_id,
          ]);
          await requireScope(client, userId, space.id, "edit");
          const {
            rows: [row],
          } = await client.query("SELECT * FROM tasks WHERE id=$1 FOR UPDATE", [
            id,
          ]);
          assertRevision(row.version, patch.version);
          const date = (v: Date | string | null) =>
            v instanceof Date ? v.toISOString().slice(0, 10) : v;
          const { rows: deps } = await client.query(
            "SELECT depends_on FROM task_dependencies WHERE task_id=$1",
            [id],
          );
          const input = taskFields.parse({
            title: row.title,
            body: row.body,
            status: row.status,
            priority: row.priority,
            parentId: row.parent_id,
            assigneeId: row.assignee_id,
            startOn: date(row.start_on),
            dueOn: date(row.due_on),
            estimateHours:
              row.estimate_hours === null ? null : Number(row.estimate_hours),
            labels: row.labels,
            milestoneId: row.milestone_id,
            noteId: row.note_id,
            dependencies: deps.map((d) => d.depends_on),
            ...patch,
          });
          const dependencies = await validateTask(
            client,
            current.project_id,
            space.id,
            input,
            id,
          );
          if (
            patch.deleted &&
            (
              await client.query(
                "SELECT 1 FROM tasks WHERE parent_id=$1 AND deleted_at IS NULL",
                [id],
              )
            ).rowCount
          )
            throw new HttpError(409, "Move or remove the subtasks first.");
          const {
            rows: [updated],
          } = await client.query(
            "UPDATE tasks SET title=$2,body=$3,status=$4,priority=$5,parent_id=$6,assignee_id=$7,start_on=$8,due_on=$9,estimate_hours=$10,labels=$11,milestone_id=$12,note_id=$13,version=version+1,updated_at=now(),deleted_at=$14 WHERE id=$1 RETURNING *",
            [
              id,
              input.title,
              input.body,
              input.status,
              input.priority,
              input.parentId,
              input.assigneeId,
              input.startOn,
              input.dueOn,
              input.estimateHours,
              input.labels,
              input.milestoneId,
              input.noteId,
              patch.deleted ? new Date() : row.deleted_at,
            ],
          );
          await client.query("DELETE FROM task_dependencies WHERE task_id=$1", [
            id,
          ]);
          for (const dependency of dependencies)
            await client.query(
              "INSERT INTO task_dependencies(task_id,depends_on) VALUES($1,$2)",
              [id, dependency],
            );
          await recordActivity(client, {
            userId,
            spaceId: space.id,
            kind: "task",
            title: `Updated ${input.title}`,
            taskId: id,
          });
          if (
            input.assigneeId &&
            input.assigneeId !== row.assignee_id &&
            input.assigneeId !== userId
          )
            await deliverEvent(client, {
              userId: input.assigneeId,
              spaceId: space.id,
              kind: "assignments",
              title: `Assigned to you: ${input.title}`,
              taskId: id,
              dedupe: `assigned:${id}:${updated.version}`,
            });
          return updated;
        },
      );
      await notifyWorkspace();
      return json(result);
    }
  }
  if (endpoint === "reviews" && id && method === "PATCH") {
    const [review] = await query("SELECT * FROM review_requests WHERE id=$1", [
      uuid.parse(id),
    ]);
    if (!review) throw new HttpError(404, "Review unavailable.");
    const { space } = await projectAccess(userId, review.project_id, "comment");
    const input = z
      .object({
        mutationId,
        version: z.number().int().positive(),
        status: z.enum(["approved", "changes_requested", "cancelled"]),
        response: z.string().max(10000).default(""),
      })
      .parse(await request.json());
    if (
      input.status === "cancelled"
        ? review.requested_by !== userId && !space.can_manage
        : review.reviewer_id !== userId
    )
      throw new HttpError(
        403,
        "Only the assigned reviewer can submit this review.",
      );
    const result = await workspaceMutation(
      userId,
      input.mutationId,
      "review:" + id,
      input,
      async (client) => {
        await requireScope(client, userId, space.id, "comment");
        const {
          rows: [current],
        } = await client.query(
          "SELECT * FROM review_requests WHERE id=$1 FOR UPDATE",
          [id],
        );
        assertRevision(current.version, input.version);
        const {
          rows: [updated],
        } = await client.query(
          "UPDATE review_requests SET status=$2,response=$3,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
          [id, input.status, input.response],
        );
        await deliverEvent(client, {
          userId: review.requested_by,
          spaceId: space.id,
          kind: "reviews",
          title: `Review ${input.status.replaceAll("_", " ")}`,
          resourceId: review.note_id,
          dedupe: `review-response:${id}:${updated.version}`,
        });
        return updated;
      },
    );
    await notifyWorkspace();
    return json(result);
  }
  return null;
}

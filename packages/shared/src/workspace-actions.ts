import { z } from "zod";
import type { PoolClient } from "pg";
import { query, transaction } from "./db";
import {
  HttpError,
  spaceAccess,
  resourceAccess,
  spaceAccessEpoch,
} from "./access";
import {
  activeConnection,
  connectionAllowsSpace,
} from "./integration-security";
import { integrationActions } from "./integration-catalog";
import {
  documentCommandSchema,
  sourceHash,
  applyDocumentCommand,
} from "./document-commands";
import { currentRevisionDoc } from "./revision-api";
import { documentSource } from "./document-format";
import { canvasSchema } from "./canvas";
import { taskInput, lockPlanning, mutatePlanningTask } from "./planning-api";
import { previewSchedule } from "./schedule-service";
import { dateOnlySchema, resourceNameSchema } from "./workspace";
import { assistantHash } from "./assistant-service";
import { recordActivity } from "./workspace-service";
import { productivityWrites, type ChangeAction } from "./productivity";
import {
  goalInputSchema,
  intakeInputSchema,
  planningViewStateSchema,
  planningBulkInputSchema,
} from "./planning-suite";
import { recurrenceSchema } from "./workspace";
import { authorizePluginAction } from "./plugin-security";
import { validateCustomPatch } from "./planning-field-service";
import { requireScope } from "./workspace-service";
import { fileTypeIds } from "./file-types";

export type ActionActor = {
  userId: string;
  spaceIds: string[];
  connectionId?: string | null;
  grantVersion?: string | null;
  pluginGrantId?: string | null;
  pluginPackageHash?: string | null;
  pluginGrantRevision?: number | null;
};
export type PreparedAction = {
  data: ChangeAction;
  before: Record<string, any>;
  payload: Record<string, any>;
  scopeVersion: string;
  schedule?: Record<string, any>;
};
export type ActionExecutor = (
  actor: ActionActor,
  action: ChangeAction,
  operationId: string,
  setId: string,
) => Promise<Record<string, any>>;
export const planningAction = (name: string) =>
  [
    "workspace_task_create",
    "workspace_task_update",
    "workspace_milestone_create",
  ].includes(name);
export function actionCapability(a: ChangeAction) {
  if (
    a.action === "workspace_planning_view_create" &&
    a.payload.shared === true
  )
    return "manage";
  const definition = integrationActions.find((d) => d.name === a.action);
  return definition?.scope === "workspace:manage"
    ? "manage"
    : [
          "note_comment",
          "resource_comment",
          "workspace_discussion_create",
          "workspace_intake_submit",
          "workspace_intake_update",
        ].includes(a.action)
      ? "comment"
      : "edit";
}
export async function authorizeAction(actor: ActionActor, a: ChangeAction) {
  const definition = integrationActions.find((d) => d.name === a.action);
  if (!definition && a.action !== "document_edit")
    throw new HttpError(400, "Unknown action.");
  if (
    !actor.connectionId &&
    !actor.pluginGrantId &&
    !(productivityWrites as readonly string[]).includes(a.action)
  )
    throw new HttpError(
      403,
      "This action is unavailable to the in-app assistant.",
    );
  if (!actor.spaceIds.includes(a.spaceId))
    throw new HttpError(403, "Action is outside the approved workspace scope.");
  if (actor.pluginGrantId) {
    if (
      actor.connectionId ||
      !actor.pluginPackageHash ||
      !actor.pluginGrantRevision
    )
      throw new HttpError(403, "Invalid extension authority.");
    await authorizePluginAction(
      {
        grantId: actor.pluginGrantId,
        userId: actor.userId,
        packageHash: actor.pluginPackageHash,
        revision: actor.pluginGrantRevision,
      },
      a,
    );
  }
  if (actor.connectionId) {
    const grant = await activeConnection(
      actor.connectionId,
      actor.userId,
      a.action === "workspace_planning_view_create" && a.payload.shared === true
        ? "workspace:manage"
        : (definition?.scope ?? "workspace:write"),
      undefined,
      actor.grantVersion ?? undefined,
    );
    actor.spaceIds.forEach((id) => connectionAllowsSpace(grant, id));
  }
  const space = await spaceAccess(
    actor.userId,
    a.spaceId,
    [
      "workspace_restore",
      "workspace_purge",
      "file_restore",
      "file_purge",
    ].includes(a.action)
      ? "read"
      : actionCapability(a),
  );
  for (const id of [
    a.payload.spaceId,
    a.payload.destinationSpaceId,
    ...(Array.isArray(a.payload.spaceIds) ? a.payload.spaceIds : []),
  ]) {
    if (id && (typeof id !== "string" || !actor.spaceIds.includes(id)))
      throw new HttpError(403, "Destination is outside the approved scope.");
  }
  if (definition?.target === "resource" || a.action === "document_edit") {
    const id = a.targetId ?? a.payload.noteId;
    const [row] = await query("SELECT space_id FROM resources WHERE id=$1", [
      z.uuid().parse(id),
    ]);
    if (!row || row.space_id !== a.spaceId)
      throw new HttpError(403, "The file moved or is outside this workspace.");
    if (
      a.action === "document_edit" &&
      a.targetId &&
      a.targetId !== a.payload.noteId
    )
      throw new HttpError(400, "Document target mismatch.");
  }
  if (definition?.target === "task") {
    const [row] = await query("SELECT space_id FROM tasks WHERE id=$1", [
      z.uuid().parse(a.targetId),
    ]);
    if (!row || row.space_id !== a.spaceId)
      throw new HttpError(403, "Task is outside this workspace.");
  }
  if (definition?.target === "project" && a.targetId !== space.project_id)
    throw new HttpError(403, "Project scope mismatch.");
  if (
    definition?.target === "group" &&
    (a.targetId !== space.group_id || space.kind !== "team")
  )
    throw new HttpError(403, "Use the group's authorized team workspace.");
  return space;
}

/** Capture the exact target and effect. No accepted workspace state is written. */
export async function prepareAction(
  actor: ActionActor,
  a: ChangeAction,
  operationId: string,
  futureIds = new Set<string>(),
): Promise<PreparedAction> {
  const space = await authorizeAction(actor, a),
    p = { ...a.payload, mutationId: operationId } as Record<string, any>;
  const scopeVersion = await spaceAccessEpoch(space.id);
  let before: Record<string, any> = {};
  if (a.action === "document_edit") {
    const command = documentCommandSchema.parse(p);
    const current = await currentRevisionDoc(command.noteId);
    try {
      before = {
        source: documentSource(current.doc, current.format),
        generation: current.generation,
        format: current.format,
      };
      if (
        current.generation !== command.generation ||
        sourceHash(before.source) !== command.expectedHash
      )
        throw new HttpError(
          409,
          "The document changed. Read it again and review a fresh edit.",
        );
      applyDocumentCommand(current.doc, current.format, command);
      p.previewSource = documentSource(current.doc, current.format);
    } finally {
      current.doc.destroy();
    }
  } else if (a.action === "file_create") {
    const input = z
      .object({
        type: z.enum(fileTypeIds),
        name: resourceNameSchema,
        source: z.string().max(1_000_000).optional(),
        parentId: z.uuid().nullable().optional(),
      })
      .parse(p);
    if (
      !actor.connectionId &&
      ["image", "docx", "xlsx", "pptx"].includes(input.type)
    )
      throw new HttpError(
        400,
        "The assistant creates native text, math and Canvas files; binary editing is unavailable.",
      );
    if (input.type === "canvas" && input.source)
      canvasSchema.parse(JSON.parse(input.source));
    if (input.type === "json" && input.source) JSON.parse(input.source);
  } else if (a.action === "folder_create") {
    z.object({
      kind: z.literal("folder"),
      name: resourceNameSchema,
      parentId: z.uuid().nullable().optional(),
    }).parse(p);
  } else if (a.action === "workspace_goal_create") {
    goalInputSchema.parse(p);
  } else if (a.action === "workspace_intake_submit") {
    intakeInputSchema.parse(p);
  } else if (a.action === "workspace_routine_create") {
    z.object({ rule: recurrenceSchema, template: taskInput }).parse(p);
  } else if (a.action === "workspace_planning_view_create") {
    z.object({
      name: z.string().trim().min(1).max(120),
      state: planningViewStateSchema,
      shared: z.boolean().optional(),
    }).parse(p);
  } else if (
    [
      "workspace_goal_update",
      "workspace_intake_update",
      "workspace_intake_review",
      "workspace_routine_update",
    ].includes(a.action)
  ) {
    const table =
      a.action === "workspace_goal_update"
        ? "planning_goals"
        : a.action === "workspace_routine_update"
          ? "task_recurrences"
          : "planning_intake";
    const [row] = await query(
      `SELECT * FROM ${table} WHERE id=$1 AND space_id=$2`,
      [z.uuid().parse(a.targetId), a.spaceId],
    );
    if (!row) throw new HttpError(404, "Planning item unavailable.");
    if (row.version !== p.version)
      throw new HttpError(
        409,
        "Planning item changed. Refresh before reviewing.",
      );
    before = row;
    if (a.action === "workspace_goal_update")
      goalInputSchema.partial().parse(p);
    if (a.action === "workspace_intake_update")
      intakeInputSchema.partial().parse(p);
    if (a.action === "workspace_intake_review")
      z.object({
        version: z.number().int().positive(),
        decision: z.enum([
          "accepted",
          "rejected",
          "needs-changes",
          "withdrawn",
        ]),
        note: z.string().max(4000).optional(),
      }).parse(p);
    if (a.action === "workspace_routine_update")
      z.object({
        version: z.number().int().positive(),
        rule: recurrenceSchema.optional(),
        template: taskInput.optional(),
        enabled: z.boolean().optional(),
        archived: z.boolean().optional(),
      }).parse(p);
  } else if (a.action === "workspace_tasks_bulk") {
    const input = planningBulkInputSchema.parse(p);
    const rows = await query(
        "SELECT id,version,title,status,priority,assignee_id,labels,deleted_at FROM tasks WHERE space_id=$1 AND id=ANY($2::uuid[])",
        [a.spaceId, input.items.map((t) => t.id)],
      ),
      versions = new Map(rows.map((t) => [t.id, t.version]));
    if (
      new Set(input.items.map((t) => t.id)).size !== input.items.length ||
      input.items.some((t) => versions.get(t.id) !== t.version)
    )
      throw new HttpError(
        409,
        "Selected tasks changed or are unavailable. Review a fresh selection.",
      );
    before = { items: rows };
  } else if (a.action === "workspace_task_create") {
    taskInput.parse(p);
    if (Object.hasOwn(p, "customFields"))
      await transaction(async (db) => {
        await requireScope(db, actor.userId, a.spaceId, "edit");
        await validateCustomPatch(
          db,
          a.spaceId,
          p.customFields,
          p.fieldsVersion,
        );
      });
  } else if (a.action === "workspace_task_update") {
    const [task] = await query(
      "SELECT t.*,(SELECT coalesce(jsonb_agg(depends_on),'[]'::jsonb) FROM task_dependencies WHERE task_id=t.id) AS dependencies,(SELECT coalesce(jsonb_agg(jsonb_build_object('taskId',depends_on,'lagDays',lag_days)),'[]'::jsonb) FROM task_dependencies WHERE task_id=t.id) AS \"dependencyLinks\",(SELECT coalesce(jsonb_agg(resource_id),'[]'::jsonb) FROM task_resources WHERE task_id=t.id) AS resource_ids FROM tasks t WHERE id=$1",
      [a.targetId],
    );
    if (task.version !== p.version)
      throw new HttpError(409, "Task changed. Refresh before reviewing.");
    if (
      !actor.connectionId &&
      (Object.hasOwn(p, "startOn") || Object.hasOwn(p, "dueOn"))
    )
      throw new HttpError(
        400,
        "Review existing date changes through a schedule proposal.",
      );
    before = task;
    taskInput.partial().parse(p);
    if (Object.hasOwn(p, "customFields"))
      await transaction(async (db) => {
        await requireScope(db, actor.userId, a.spaceId, "edit");
        await validateCustomPatch(
          db,
          a.spaceId,
          p.customFields,
          p.fieldsVersion,
          task.custom_fields ?? {},
        );
      });
  } else if (a.action === "workspace_milestone_create") {
    z.object({
      title: resourceNameSchema,
      dueOn: dateOnlySchema.nullable().optional(),
    }).parse(p);
  } else if (a.action === "file_update") {
    const { resource } = await resourceAccess(
      actor.userId,
      a.targetId!,
      "edit",
    );
    if (resource.version !== p.version)
      throw new HttpError(409, "File metadata changed. Review again.");
    before = resource;
    z.object({
      name: resourceNameSchema.optional(),
      description: z.string().max(10000).optional(),
      tags: z.array(z.string().max(80)).max(100).optional(),
      parentId: z.uuid().nullable().optional(),
    }).parse(p);
  } else if (a.action === "workspace_schedule_apply") {
    if (Array.isArray(p.changes)) {
      const changes = z
        .array(
          z.object({
            id: z.uuid(),
            version: z.number().int().positive(),
            startOn: dateOnlySchema.nullable(),
            dueOn: dateOnlySchema.nullable(),
          }),
        )
        .min(1)
        .max(1000)
        .parse(p.changes);
      const schedule = await transaction(async (db) =>
        previewSchedule(
          db,
          actor.userId,
          await lockPlanning(db, actor.userId, a.spaceId),
          changes,
        ),
      );
      return {
        data: a,
        before,
        payload: {
          previewId: schedule.id,
          mode: z.enum(["direct", "proposed"]).parse(p.mode ?? "direct"),
          mutationId: operationId,
        },
        scopeVersion,
        schedule,
      };
    }
    const [schedule] = await query(
      "SELECT * FROM schedule_previews WHERE id=$1 AND space_id=$2 AND user_id=$3 AND applied_at IS NULL AND expires_at>now()",
      [p.previewId, a.spaceId, actor.userId],
    );
    if (!schedule)
      throw new HttpError(
        409,
        "Schedule preview expired. Generate a fresh preview.",
      );
    return {
      data: a,
      before,
      payload: p,
      scopeVersion,
      schedule: schedule.plan,
    };
  } else if (
    a.targetId &&
    integrationActions.find((d) => d.name === a.action)?.target === "resource"
  ) {
    const [resource] = await query(
      "SELECT id,name,version,parent_id,space_id,deleted_at FROM resources WHERE id=$1",
      [a.targetId],
    );
    before = resource ?? {};
    if (p.version !== undefined && p.version !== before.version)
      throw new HttpError(409, "The resource changed. Review again.");
  }
  if (
    ["file_create", "folder_create", "file_update"].includes(a.action) &&
    p.parentId &&
    !futureIds.has(p.parentId)
  ) {
    const { resource } = await resourceAccess(
      actor.userId,
      z.uuid().parse(p.parentId),
    );
    if (resource.kind !== "folder" || resource.space_id !== a.spaceId)
      throw new HttpError(
        400,
        "Choose an available folder in the destination workspace.",
      );
    before.destination = {
      id: resource.id,
      version: resource.version,
      name: resource.name,
    };
  }
  return { data: a, before, payload: p, scopeVersion };
}

export async function applyPlanningAction(
  db: PoolClient,
  actor: ActionActor,
  a: ChangeAction,
  entityId: string,
) {
  const space = await lockPlanning(db, actor.userId, a.spaceId);
  if (a.action !== "workspace_milestone_create")
    return mutatePlanningTask(
      db,
      actor.userId,
      a.spaceId,
      space,
      a.action === "workspace_task_update" ? a.targetId : undefined,
      a.payload,
      entityId,
    );
  const input = z
    .object({
      title: resourceNameSchema,
      dueOn: dateOnlySchema.nullable().default(null),
    })
    .parse(a.payload);
  const {
    rows: [milestone],
  } = await db.query(
    "INSERT INTO project_milestones(id,space_id,project_id,title,due_on) VALUES($1,$2,$3,$4,$5) RETURNING *",
    [entityId, a.spaceId, space.project_id, input.title, input.dueOn],
  );
  await recordActivity(db, {
    userId: actor.userId,
    spaceId: a.spaceId,
    kind: "planning",
    title: `AI-assisted milestone: ${input.title}`,
  });
  return milestone;
}
export const preparedFingerprint = (prepared: PreparedAction[]) =>
  assistantHash(prepared);

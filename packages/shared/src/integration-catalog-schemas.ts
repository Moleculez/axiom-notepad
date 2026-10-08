import { z } from "zod";
import {
  contentRoleSchema,
  dateOnlySchema,
  recurrenceSchema,
  resourceKindSchema,
  resourceNameSchema,
  taskPrioritySchema,
  taskStatusSchema,
} from "./workspace";
import { calendarSchema, taskInput } from "./planning";
import { customFieldsPatchSchema } from "./planning-lab";
import { availabilitySchema } from "./planning-analysis";
import {
  goalInputSchema,
  intakeInputSchema,
  planningBulkInputSchema,
  planningViewStateSchema,
} from "./planning-suite";
import { commentCreateSchema } from "./note-comments";
import { resourceAnchor } from "./resource-comments";
import { fileTypeIds } from "./file-types";

const uuid = z.uuid(),
  version = z.number().int().positive();
const user = z.string().min(1).max(100);
const mutation = {
  mutationId: uuid
    .optional()
    .describe(
      "Stable retry ID; omitted IDs are allocated by the reviewed change-set service.",
    ),
};
const boundedQueryValue = z.string().max(1000);
const emptyQuery = z.object({}).catchall(boundedQueryValue);
const emptyPayload = z.object({}).catchall(z.unknown());
const integerQuery = (min: number, max: number) =>
  z
    .string()
    .max(20)
    .refine(
      (value) =>
        Number.isSafeInteger(Number(value)) &&
        Number(value) >= min &&
        Number(value) <= max,
      `Use an integer string from ${min} to ${max}.`,
    )
    .describe(`Integer encoded as a query string (${min}–${max}).`);
const q = z.string().max(200).optional(),
  cursor = boundedQueryValue.optional();
const flag = z.enum(["0", "1"]).optional();
const page = { q, cursor, limit: integerQuery(1, 100).optional() };
const archivePage = { ...page, sort: z.enum(["newest", "oldest"]).optional() };
const query = (shape: z.ZodRawShape) =>
  z.object(shape).catchall(boundedQueryValue) as z.ZodType<
    Record<string, string>
  >;
const payload = (shape: z.ZodRawShape) =>
  z.object({ ...shape, ...mutation }).catchall(z.unknown());
const idsQuery = z
  .string()
  .max(1000)
  .refine((value) => {
    const ids = value.split(",").filter(Boolean);
    return ids.length <= 100 && ids.every((id) => uuid.safeParse(id).success);
  }, "Use up to 100 comma-separated UUIDs.");
const taskFields = taskInput.partial().extend({ title: taskInput.shape.title });
const taskPatch = taskFields.partial().extend({
  version,
  deleted: z.boolean().optional(),
  customFields: customFieldsPatchSchema.optional(),
  fieldsVersion: version.optional(),
});
const milestone = {
  id: uuid.optional(),
  title: resourceNameSchema,
  dueOn: dateOnlySchema.nullable().optional(),
  completed: z.boolean().optional(),
  version: z.number().int().optional(),
};
const fileRevision = { version, ...mutation };
const transfer = {
  ...fileRevision,
  destinationSpaceId: uuid,
  parentId: uuid.nullable().optional(),
  confirmAudience: z.boolean().optional(),
};
const groupItems = z
  .array(z.object({ id: uuid, version }))
  .min(1)
  .max(100);

/** Every existing tool is listed explicitly. Unknown names fail closed instead
 * of silently receiving the old opaque payload schema. Query values remain
 * strings because this is the native HTTP envelope, not a second REST API.
 * Unknown bounded query/payload fields are retained for native forwards
 * compatibility; native services still reject unsupported sensitive fields. */
export const integrationPayloadSchemas: Record<
  string,
  z.ZodType<Record<string, unknown>>
> = {
  workspace_goal_create: payload(
    goalInputSchema.partial().extend({
      title: goalInputSchema.shape.title,
      kind: goalInputSchema.shape.kind,
    }).shape,
  ),
  workspace_goal_update: payload({
    ...goalInputSchema.partial().shape,
    version,
  }),
  workspace_intake_submit: payload(
    intakeInputSchema.partial().extend({
      title: intakeInputSchema.shape.title,
      kind: intakeInputSchema.shape.kind,
    }).shape,
  ),
  workspace_intake_update: payload({
    ...intakeInputSchema.partial().shape,
    version,
  }),
  workspace_intake_review: payload({
    version,
    decision: z.enum(["accepted", "rejected", "needs-changes", "withdrawn"]),
    note: z.string().trim().max(4000).optional(),
    task: taskFields.partial().optional(),
  }),
  workspace_tasks_bulk: planningBulkInputSchema
    .extend(mutation)
    .catchall(z.unknown()),
  workspace_routine_create: payload({
    rule: recurrenceSchema,
    template: taskFields,
  }),
  workspace_routine_update: payload({
    version,
    rule: recurrenceSchema.optional(),
    template: taskFields.optional(),
    enabled: z.boolean().optional(),
    archived: z.boolean().optional(),
  }),
  workspace_planning_view_create: payload({
    name: z.string().trim().min(1).max(120),
    state: planningViewStateSchema,
    shared: z.boolean().optional(),
  }),
  workspace_baseline_capture: payload({
    name: z.string().trim().min(1).max(120),
    version,
  }),
  group_portfolio_create: payload({
    name: z.string().trim().min(1).max(120),
    spaceIds: z.array(uuid).max(100),
    version: z.number().int().nonnegative(),
  }),
  group_availability_update: payload({
    userId: user,
    settings: availabilitySchema,
    version: z.number().int().nonnegative(),
  }),
  workspace_task_create: payload({
    ...taskFields.shape,
    customFields: customFieldsPatchSchema.optional(),
    fieldsVersion: version.optional(),
  }),
  workspace_task_update: payload(taskPatch.shape),
  workspace_milestone_create: payload(milestone),
  workspace_discussion_create: payload({
    body: z.string().trim().min(1).max(100000),
    taskId: uuid.nullable().optional(),
    parentId: uuid.nullable().optional(),
  }),
  workspace_schedule_preview: payload({
    changes: z
      .array(
        z.object({
          id: uuid,
          version,
          startOn: dateOnlySchema.nullable(),
          dueOn: dateOnlySchema.nullable(),
        }),
      )
      .min(1)
      .max(1000),
  }),
  workspace_schedule_apply: payload({
    previewId: uuid,
    mode: z.enum(["direct", "proposed"]).optional(),
  }),
  workspace_schedule_undo: payload({
    previewId: uuid,
    mode: z.enum(["direct", "proposed"]).optional(),
  }),
  workspace_calendar_update: payload({
    version: z.number().int(),
    calendar: calendarSchema,
  }),
  file_create: payload({
    type: z.enum(fileTypeIds),
    id: uuid.optional(),
    name: resourceNameSchema,
    parentId: uuid.nullable().optional(),
    source: z.string().max(5_000_000).optional(),
    initialState: z.string().max(8_000_000).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  }),
  folder_create: payload({
    kind: z.literal("folder"),
    id: uuid.optional(),
    name: resourceNameSchema,
    parentId: uuid.nullable().optional(),
    body: z.string().max(1_000_000).optional(),
    initialState: z.string().max(8_000_000).optional(),
  }),
  file_update: payload({
    version,
    name: resourceNameSchema.optional(),
    description: z.string().max(3000).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    parentId: uuid.nullable().optional(),
  }),
  file_favorite: payload({ favorite: z.boolean() }),
  file_copy: payload(transfer),
  file_transfer: payload(transfer),
  file_trash: payload(fileRevision),
  file_restore: payload(fileRevision),
  file_purge: payload(fileRevision),
  note_checkpoint: payload({ label: z.string().trim().min(1).max(100) }),
  note_comment: commentCreateSchema,
  resource_comment: payload({
    body: z.string().trim().min(1).max(20000),
    anchor: resourceAnchor.optional(),
    versionId: uuid.nullable().optional(),
    resolved: z.boolean().optional(),
  }),
  studio_settings: payload({
    settings: z.record(z.string().max(100), z.unknown()),
    version,
  }),
  studio_checkpoint: payload({
    source: z.string().max(30000),
    label: z.string().trim().min(1).max(120),
  }),
  task_create: payload(
    taskFields.extend({ title: z.string().trim().min(1).max(200) }).shape,
  ),
  milestone_create: payload(milestone),
  project_discussion_create: payload({
    body: z.string().trim().min(1).max(20000),
    taskId: uuid.nullable().optional(),
    parentId: uuid.nullable().optional(),
    mentions: z.array(user).max(30).optional(),
  }),
  project_review_create: payload({
    noteId: uuid,
    reviewerId: user,
    message: z.string().max(5000).optional(),
  }),
  project_update: payload({
    version,
    name: resourceNameSchema.optional(),
    description: z.string().max(3000).optional(),
    color: z.enum(["blue", "green", "purple", "orange"]).optional(),
    audience: z.enum(["restricted", "group"]).optional(),
    confirmAudience: z.boolean().optional(),
    archived: z.boolean().optional(),
  }),
  project_members_update: payload({
    userId: user,
    role: contentRoleSchema.optional(),
    canManage: z.boolean().optional(),
    remove: z.boolean().optional(),
  }),
  group_invite: payload({
    emails: z.array(z.email()).min(1).max(100),
    role: z.enum(["member", "admin"]).optional(),
    contentRole: contentRoleSchema.optional(),
  }),
  group_members_update: payload({
    items: z
      .array(z.object({ id: user, version }))
      .min(1)
      .max(100),
    role: z.enum(["member", "admin"]).optional(),
    contentRole: contentRoleSchema.optional(),
    remove: z.boolean().optional(),
  }),
  group_invitations_reissue: payload({ items: groupItems }),
  group_invitations_revoke: payload({ items: groupItems }),
  workspace_archive: payload(fileRevision),
  workspace_unarchive: payload(fileRevision),
  workspace_trash: payload(fileRevision),
  workspace_restore: payload(fileRevision),
  workspace_purge: payload({ ...fileRevision, confirmation: z.string() }),
  workspace_update: payload({
    ...fileRevision,
    name: resourceNameSchema.optional(),
    description: z.string().max(3000).optional(),
    color: z.enum(["blue", "green", "purple", "orange"]).optional(),
    audience: z.enum(["group", "restricted"]).optional(),
  }),
};

export const integrationQuerySchemas: Record<
  string,
  z.ZodType<Record<string, string>>
> = {
  workspace_evidence_search: query({
    q,
    cursor,
    limit: integerQuery(1, 30).optional(),
    offset: integerQuery(0, 10000).optional(),
  }),
  workspace_evidence_read: query({
    id: uuid,
    from: integerQuery(0, 5_000_000).optional(),
    to: integerQuery(1, 5_000_000).optional(),
    hash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }).refine(
    (v) =>
      (v.from === undefined && v.to === undefined) ||
      (v.from !== undefined &&
        v.to !== undefined &&
        Number(v.to) > Number(v.from) &&
        v.hash !== undefined),
    "An excerpt requires from/to and the full document hash.",
  ),
  workspace_task_fields: emptyQuery,
  workspace_time_report: query({
    ...page,
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
    member: user.optional(),
    task: uuid.optional(),
    descendants: flag,
    state: z.enum(["active", "withdrawn", "all"]).optional(),
  }),
  workspace_time_entry: emptyQuery,
  workspace_automation_rules: emptyQuery,
  workspace_automation_runs: query({
    ...page,
    status: z
      .enum([
        "all",
        "pending",
        "applied",
        "blocked",
        "cancelled",
        "undone",
        "noop",
      ])
      .optional(),
    rule: uuid.optional(),
  }),
  workspace_goals: query({
    ...archivePage,
    filter: z.enum(["active", "archived", "all"]).optional(),
    kind: z.enum(["linked", "metric"]).optional(),
    mine: flag,
  }),
  workspace_goal_detail: emptyQuery,
  workspace_planning_history: query({ ...archivePage, mine: flag }),
  workspace_routine_occurrences: query({
    ...archivePage,
    state: z.enum(["all", "active", "deleted"]).optional(),
    status: taskStatusSchema.optional(),
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
  }),
  workspace_intake: query({
    ...archivePage,
    filter: z
      .enum([
        "all",
        "open",
        "history",
        "pending",
        "needs-changes",
        "accepted",
        "rejected",
        "withdrawn",
      ])
      .optional(),
    kind: intakeInputSchema.shape.kind.optional(),
    mine: flag,
  }),
  workspace_intake_detail: emptyQuery,
  workspace_planning_views: emptyQuery,
  workspace_planning_lookup: query({
    kind: z.enum(["task", "file", "milestone"]),
    q,
    ids: idsQuery.optional(),
  }),
  workspace_routines: emptyQuery,
  workspace_schedule_analysis: emptyQuery,
  workspace_baselines: query({
    baseline: uuid.optional(),
    compare: z.union([z.literal("current"), uuid]).optional(),
  }),
  group_portfolio: query({ portfolio: uuid.optional() }),
  group_capacity: query({
    start: dateOnlySchema.optional(),
    weeks: integerQuery(1, 52).optional(),
  }),
  workspace_planning: query({
    q,
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    assignee: user.optional(),
    milestone: uuid.optional(),
    limit: integerQuery(1, 5000).optional(),
    offset: integerQuery(0, 100000).optional(),
    deleted: flag,
    risk: z.enum(["overdue", "blocked", "upcoming"]).optional(),
    sort: z.enum(["position", "title", "due", "updated"]).optional(),
    fieldFilters: boundedQueryValue.optional(),
    sortField: uuid.optional(),
    sortDirection: z.enum(["asc", "desc"]).optional(),
  }),
  workspace_calendar: emptyQuery,
  workspace_discussions: query({ task: uuid.optional() }),
  workspace_reviews: emptyQuery,
  workspace_task: emptyQuery,
  files_list: query({
    ...page,
    parentId: uuid.optional(),
    view: z.enum(["folder", "all", "recent", "favorites", "trash"]).optional(),
    kind: resourceKindSchema.optional(),
    sort: z.enum(["name", "updated", "size"]).optional(),
    direction: z.enum(["asc", "desc"]).optional(),
    pickKind: z.enum(["file", "note"]).optional(),
    name: z.string().max(200).optional(),
    mime: z.string().max(100).optional(),
    tag: z.string().max(40).optional(),
    after: dateOnlySchema.optional(),
    before: dateOnlySchema.optional(),
    minSize: integerQuery(0, 1e12).optional(),
    maxSize: integerQuery(0, 1e12).optional(),
  }),
  file_details: emptyQuery,
  file_location: emptyQuery,
  file_versions: emptyQuery,
  file_usage: emptyQuery,
  note_read: emptyQuery,
  note_history: emptyQuery,
  note_comments: emptyQuery,
  project_details: emptyQuery,
  project_tasks: query({
    limit: integerQuery(1, 200).optional(),
    offset: integerQuery(0, 100000).optional(),
    status: taskStatusSchema.optional(),
  }),
  project_milestones: emptyQuery,
  project_discussions: emptyQuery,
  project_reviews: emptyQuery,
  project_members: emptyQuery,
  group_overview: emptyQuery,
  group_members: query({
    q,
    limit: integerQuery(1, 100).optional(),
    offset: integerQuery(0, 1000000).optional(),
    filter: z
      .enum([
        "all",
        "owner",
        "admin",
        "member",
        "viewer",
        "commenter",
        "editor",
      ])
      .optional(),
  }),
  group_invitations: query({
    q,
    limit: integerQuery(1, 100).optional(),
    offset: integerQuery(0, 1000000).optional(),
    filter: z
      .enum(["all", "pending", "accepted", "expired", "revoked"])
      .optional(),
  }),
  workspace_lifecycle: emptyQuery,
  audit_history: query({
    q,
    cursor: z
      .string()
      .regex(/^\d{1,20}$/)
      .optional(),
    limit: integerQuery(1, 200).optional(),
    actor: z.string().max(200).optional(),
    action: z.string().max(80).optional(),
    entity: z.string().max(80).optional(),
    after: dateOnlySchema.optional(),
    before: dateOnlySchema.optional(),
  }),
  trash_list: query({
    q,
    kind: z.enum(["", "folder", "note", "file", "shortcut"]).optional(),
    after: dateOnlySchema.optional(),
    before: dateOnlySchema.optional(),
    limit: integerQuery(1, 100).optional(),
    offset: integerQuery(0, 1000000).optional(),
    parent: uuid.optional(),
    tree: flag,
    sort: z.enum(["deleted", "name", "size"]).optional(),
    direction: z.enum(["asc", "desc"]).optional(),
    cursor,
  }),
  studio_details: emptyQuery,
  studio_history: emptyQuery,
  resource_discussion: query({ version: uuid.optional() }),
};

export function buildIntegrationActionSchema(action: {
  name: string;
  target: string;
  path: string;
  method: string;
}) {
  const write = action.method !== "GET";
  const body = write ? integrationPayloadSchemas[action.name] : emptyPayload;
  const search = write ? emptyQuery : integrationQuerySchemas[action.name];
  if (!body || !search)
    throw new Error(`Missing typed integration schema: ${action.name}`);
  const targetRequired =
    action.target !== "workspace" || action.path.includes(":entity");
  return z
    .object({
      spaceId: uuid.describe(
        "Selected workspace UUID. Every request rechecks the connection grant and your current access.",
      ),
      id: targetRequired
        ? uuid.describe("Target entity UUID within the selected workspace.")
        : uuid.optional(),
      query: ["workspace_evidence_read", "workspace_planning_lookup"].includes(
        action.name,
      )
        ? search
        : search.prefault({}),
      payload: write ? body : body.prefault({}),
      approvalId: uuid
        .optional()
        .describe(
          "Legacy review receipt ID; clients cannot approve their own requests.",
        ),
    })
    .strict();
}

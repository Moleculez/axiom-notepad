import { z } from "zod";
import {
  dateOnlySchema,
  taskStatusSchema,
  taskPrioritySchema,
  recurrenceOccursOn,
  nextCalendarDate,
  recurrenceSchema,
} from "./workspace";
import { planningViews, planningProgress, type PlanningTask } from "./planning";
const uuid = z.uuid();
export function nextRecurrenceDates(
  rule: z.infer<typeof recurrenceSchema>,
  last: string | null,
  today: string,
  count = 5,
) {
  const dates: string[] = [];
  let date = rule.start;
  if (last && date <= last) date = nextCalendarDate(last);
  if (date < today) date = today;
  for (
    let n = 0;
    n < 20000 && dates.length < count && (!rule.until || date <= rule.until);
    n++, date = nextCalendarDate(date)
  )
    if (recurrenceOccursOn(rule, date)) dates.push(date);
  return dates;
}
export const planningViewStateSchema = z.object({
  view: z.enum(planningViews).default("list"),
  zoom: z.enum(["day", "week", "month", "quarter", "year"]).default("week"),
  grouping: z.enum(["parent", "assignee", "milestone"]).default("parent"),
  columns: z
    .array(
      z.enum(["assignee", "status", "priority", "start", "due", "progress"]),
    )
    .max(6)
    .default([]),
  showDependencies: z.boolean().default(true),
  showBaseline: z.boolean().default(true),
  showCritical: z.boolean().default(true),
  filters: z
    .object({
      q: z.string().max(200).optional(),
      status: taskStatusSchema.optional(),
      priority: taskPrioritySchema.optional(),
      assignee: z.string().max(100).optional(),
      milestone: uuid.optional(),
      risk: z.enum(["overdue", "blocked", "upcoming"]).optional(),
      sort: z.enum(["position", "title", "due", "updated"]).optional(),
      deleted: z.literal("1").optional(),
    })
    .default({}),
});
export type PlanningViewState = z.infer<typeof planningViewStateSchema>;
export const planningBulkInputSchema = z
  .object({
    items: z
      .array(z.object({ id: uuid, version: z.number().int().positive() }))
      .min(1)
      .max(1000),
    patch: z
      .object({
        status: taskStatusSchema.optional(),
        priority: taskPrioritySchema.optional(),
        assigneeId: z.string().max(100).nullable().optional(),
        labels: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
        deleted: z.boolean().optional(),
      })
      .strict(),
  })
  .refine(
    (input) =>
      new Set(input.items.map((t) => t.id)).size === input.items.length &&
      Object.keys(input.patch).length > 0,
    "Choose distinct tasks and a change.",
  );
export const goalInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().max(100000).default(""),
  ownerId: z.string().max(100).nullable().default(null),
  dueOn: dateOnlySchema.nullable().default(null),
  kind: z.enum(["linked", "metric"]),
  target: z.number().positive().max(1e9).default(1),
  currentValue: z.number().min(0).max(1e9).default(0),
  unit: z.string().max(40).default(""),
  taskIds: z.array(uuid).max(100).default([]),
  milestoneIds: z.array(uuid).max(100).default([]),
  archived: z.boolean().default(false),
});
export const intakeInputSchema = z.object({
  kind: z.enum(["research", "experiment", "paper-review", "data-request"]),
  title: z.string().trim().min(1).max(300),
  body: z.string().max(100000).default(""),
  dueOn: dateOnlySchema.nullable().default(null),
  priority: taskPrioritySchema.default("normal"),
});
/** Share the immutable workspace index across all goals in one response. */
export function goalProgressContext(
  tasks: PlanningTask[],
  milestones: Array<{ id: string; completed_at: unknown }>,
) {
  const byId = new Map(tasks.map((t) => [t.id, t])),
    child = new Map<string, string[]>();
  for (const t of tasks)
    if (t.parent_id) {
      const list = child.get(t.parent_id) ?? [];
      list.push(t.id);
      child.set(t.parent_id, list);
    }
  return {
    byId,
    child,
    progress: planningProgress(tasks),
    milestones: new Map(milestones.map((m) => [m.id, m])),
  };
}
export function goalProgress(
  goal: {
    kind: string;
    target: number;
    current_value: number;
    task_ids: string[];
    milestone_ids: string[];
  },
  tasks: PlanningTask[],
  milestones: Array<{ id: string; completed_at: unknown }>,
  context?: ReturnType<typeof goalProgressContext>,
) {
  if (goal.kind === "metric")
    return {
      percent: Math.min(
        100,
        Math.round((Number(goal.current_value) / Number(goal.target)) * 100),
      ),
      tracked: Number(goal.target),
      completed: Number(goal.current_value),
      unavailable: 0,
    };
  const {
    byId,
    child,
    progress,
    milestones: ms,
  } = context ?? goalProgressContext(tasks, milestones);
  const leaves = new Set<string>(),
    seen = new Set<string>(),
    queue = [...new Set(goal.task_ids)];
  let unavailable = 0;
  while (queue.length) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const t = byId.get(id);
    if (!t) {
      unavailable++;
      continue;
    }
    const kids = child.get(id);
    if (kids?.length) queue.push(...kids);
    else if (t.status !== "cancelled") leaves.add(id);
  }
  const mids = [...new Set(goal.milestone_ids)].filter((id) => {
    if (!ms.has(id)) {
      unavailable++;
      return false;
    }
    return true;
  });
  const tracked = leaves.size + mids.length,
    completed =
      [...leaves].reduce((n, id) => n + (progress.get(id) ?? 0) / 100, 0) +
      mids.filter((id) => ms.get(id)?.completed_at).length;
  return {
    percent: tracked ? Math.round((completed / tracked) * 100) : 0,
    tracked,
    completed,
    unavailable,
  };
}

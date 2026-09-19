import { z } from "zod";
import {
  dateOnlySchema,
  taskStatusSchema,
  taskPrioritySchema,
  timezoneSchema,
  type Task,
} from "./workspace";

/** Local drafts are untrusted input; an unfinished title is valid before saving. */
export const planningDraftSchema = z.object({
  title: z.string().max(300),
  body: z.string().max(100000),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  assigneeId: z.string().max(100).nullable(),
  parentId: z.uuid().nullable(),
  startOn: dateOnlySchema.nullable(),
  dueOn: dateOnlySchema.nullable(),
  estimateHours: z.number().min(0).max(10000).nullable(),
  labels: z.array(z.string().max(40)).max(20),
  milestoneId: z.uuid().nullable(),
  resourceIds: z.array(z.uuid()).max(100),
  dependencies: z.array(z.uuid()).max(100),
  version: z.number().int().positive().optional(),
});
export type PlanningDraft = z.infer<typeof planningDraftSchema>;

export const planningViews = [
  "list",
  "board",
  "calendar",
  "gantt",
  "workload",
] as const;
export type PlanningView = (typeof planningViews)[number];
export const calendarSchema = z.object({
  timezone: timezoneSchema.default("UTC"),
  workingDays: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .max(7)
    .transform((days) => [...new Set(days)].sort())
    .default([1, 2, 3, 4, 5]),
  exceptions: z
    .array(z.object({ date: dateOnlySchema, working: z.boolean() }))
    .max(366)
    .refine(
      (rows) => new Set(rows.map((r) => r.date)).size === rows.length,
      "Each date may have one exception.",
    )
    .default([]),
});
export type PlanningCalendar = z.infer<typeof calendarSchema>;
export type PlanningTask = Omit<Task, "project_id"> & {
  space_id: string;
  project_id: string | null;
  deleted_at: string | null;
  resource_ids: string[];
  position: number;
};
export type ScheduleChange = {
  id: string;
  version: number;
  startOn: string | null;
  dueOn: string | null;
};
export type ScheduleConflict = {
  taskId: string;
  predecessorId: string;
  earliest: string;
  reason: string;
};
export type SchedulePlan = {
  direct: ScheduleChange[];
  proposed: ScheduleChange[];
  conflicts: ScheduleConflict[];
  warnings: string[];
  before: {
    id: string;
    title: string;
    startOn: string | null;
    dueOn: string | null;
  }[];
};
export const dayNumber = (date: string) =>
  Math.floor(Date.parse(date + "T00:00:00Z") / 86400000);
export const dateFromDay = (day: number) =>
  new Date(day * 86400000).toISOString().slice(0, 10);
export const addDays = (date: string, days: number) =>
  dateFromDay(dayNumber(date) + days);
export function workingDay(date: string, calendar: PlanningCalendar) {
  const exception = calendar.exceptions.find((row) => row.date === date);
  return exception
    ? exception.working
    : calendar.workingDays.includes(new Date(date + "T00:00:00Z").getUTCDay());
}
export function nextWorkingDay(
  date: string,
  calendar: PlanningCalendar,
  include = false,
) {
  let current = include ? date : addDays(date, 1);
  for (let i = 0; i < 10000; i++, current = addDays(current, 1))
    if (workingDay(current, calendar)) return current;
  throw new Error("No working day within the supported calendar range.");
}
export function workingDuration(
  start: string,
  end: string,
  calendar: PlanningCalendar,
) {
  const length = dayNumber(end) - dayNumber(start);
  if (!Number.isFinite(length) || length < 0 || length > 36525)
    throw new Error("Schedule range must be between zero and 100 years.");
  let days = 0;
  for (let i = 0; i <= length; i++)
    if (workingDay(addDays(start, i), calendar)) days++;
  return Math.max(1, days);
}
export function workingEnd(
  start: string,
  duration: number,
  calendar: PlanningCalendar,
) {
  let end = nextWorkingDay(start, calendar, true);
  for (let i = 1; i < duration; i++) end = nextWorkingDay(end, calendar);
  return end;
}
/** Iterative topological traversal: safe for deep research plans and independent of UI paging. */
export function dependencyOrder(
  tasks: Pick<PlanningTask, "id" | "dependencies">[],
) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const degree = new Map<string, number>(),
    successors = new Map<string, string[]>();
  for (const task of tasks) {
    const dependencies = [...new Set(task.dependencies ?? [])];
    degree.set(task.id, dependencies.length);
    for (const id of dependencies) {
      if (id === task.id || !byId.has(id))
        throw new Error(
          "Dependencies must be other active tasks in this workspace.",
        );
      const children = successors.get(id) ?? [];
      children.push(task.id);
      successors.set(id, children);
    }
  }
  const order = tasks.filter((t) => degree.get(t.id) === 0).map((t) => t.id);
  for (let index = 0; index < order.length; index++)
    for (const id of successors.get(order[index]) ?? []) {
      degree.set(id, degree.get(id)! - 1);
      if (!degree.get(id)) order.push(id);
    }
  if (order.length !== tasks.length)
    throw new Error("Task dependencies cannot form a cycle.");
  return order;
}
export function planSchedule(
  tasks: PlanningTask[],
  changes: ScheduleChange[],
  calendar: PlanningCalendar,
): SchedulePlan {
  const order = dependencyOrder(tasks),
    original = new Map(tasks.map((t) => [t.id, t]));
  const dates = new Map(
    tasks.map((t) => [t.id, { start: t.start_on, end: t.due_on }]),
  );
  const changed = new Set<string>(),
    directIds = new Set<string>();
  const proposed: ScheduleChange[] = [],
    warnings: string[] = [],
    conflicts: ScheduleConflict[] = [];
  const proposedIndex = new Map<string, number>();
  for (const change of changes) {
    const task = original.get(change.id);
    if (!task || task.version !== change.version)
      throw new Error("A task changed. Refresh the schedule preview.");
    if (directIds.has(change.id))
      throw new Error("A task can only appear once in a schedule change.");
    if (["done", "cancelled"].includes(task.status))
      throw new Error(
        "Reopen completed or cancelled work before rescheduling it.",
      );
    dateOnlySchema.nullable().parse(change.startOn);
    dateOnlySchema.nullable().parse(change.dueOn);
    if (change.startOn && change.dueOn)
      workingDuration(change.startOn, change.dueOn, calendar);
    directIds.add(change.id);
    changed.add(change.id);
    dates.set(change.id, { start: change.startOn, end: change.dueOn });
    proposedIndex.set(change.id, proposed.length);
    proposed.push(change);
  }
  for (const id of order) {
    const task = original.get(id)!,
      own = dates.get(id)!;
    let earliest = own.start;
    for (const predecessorId of task.dependencies ?? []) {
      const predecessor = dates.get(predecessorId)!;
      if (!predecessor.end && changed.has(predecessorId))
        warnings.push(
          `${task.title}: predecessor is unscheduled; existing dates were kept.`,
        );
      if (!predecessor.end || !own.start) continue;
      const minimum = nextWorkingDay(predecessor.end, calendar);
      if (
        own.start < minimum &&
        (changed.has(predecessorId) || directIds.has(id))
      ) {
        conflicts.push({
          taskId: id,
          predecessorId,
          earliest: minimum,
          reason: "Starts before its predecessor has finished.",
        });
        if (!earliest || minimum > earliest) earliest = minimum;
      }
    }
    if (!own.start || !own.end) {
      if (
        (task.dependencies ?? []).some((dependency) => changed.has(dependency))
      )
        warnings.push(`${task.title}: incomplete dates; schedule it manually.`);
      continue;
    }
    if (earliest && earliest > own.start) {
      if (["done", "cancelled"].includes(task.status)) {
        warnings.push(`${task.title}: completed/cancelled work was not moved.`);
        continue;
      }
      const end = workingEnd(
        earliest,
        workingDuration(own.start, own.end, calendar),
        calendar,
      );
      dates.set(id, { start: earliest, end });
      changed.add(id);
      const existing = proposedIndex.get(id);
      const change = {
        id,
        version: task.version,
        startOn: earliest,
        dueOn: end,
      };
      if (existing !== undefined) proposed[existing] = change;
      else {
        proposedIndex.set(id, proposed.length);
        proposed.push(change);
      }
    }
  }
  return {
    direct: changes,
    proposed,
    conflicts,
    warnings,
    before: proposed.map((change) => {
      const task = original.get(change.id)!;
      return {
        id: task.id,
        title: task.title,
        startOn: task.start_on,
        dueOn: task.due_on,
      };
    }),
  };
}
export function planningCsv(tasks: PlanningTask[]) {
  const cell = (value: unknown) =>
    `"${String(value ?? "")
      .replace(/^(?:\s*[=+@\-]|[\t\r])/, "'$&")
      .replaceAll('"', '""')}"`;
  return [
    ["Title", "Status", "Assignee", "Start", "Due", "Priority", "Workspace"],
    ...tasks.map((t) => [
      t.title,
      t.status,
      t.assignee_name,
      t.start_on,
      t.due_on,
      t.priority,
      t.space_id,
    ]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}

/** Portable export of all loaded/filtered rows, not just the virtual viewport. */
export function planningSvg(
  tasks: PlanningTask[],
  title: string,
  colors = {
    paper: "#ffffff",
    text: "#263344",
    muted: "#718096",
    accent: "#476b83",
    line: "#e3e8ed",
  },
) {
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[c]!,
    );
  const dates = tasks
      .flatMap((task) => [task.start_on, task.due_on])
      .filter((d): d is string => !!d),
    first = dates.length
      ? Math.min(...dates.map(dayNumber))
      : dayNumber("2000-01-01"),
    last = dates.length ? Math.max(...dates.map(dayNumber)) : first + 30;
  const width = 1200,
    height = 110 + tasks.length * 30,
    scale = 800 / Math.max(30, last - first + 1),
    x = (date: string) => 360 + (dayNumber(date) - first) * scale;
  const rows = tasks
    .map((task, i) => {
      const y = 100 + i * 30;
      return `<g><line x1="24" x2="1176" y1="${y + 15}" y2="${y + 15}" stroke="${escape(colors.line)}"/><text x="24" y="${y}" font-size="12">${escape(task.title.slice(0, 45))}</text>${task.start_on && task.due_on ? `<rect x="${x(task.start_on)}" y="${y - 12}" width="${Math.max(2, (dayNumber(task.due_on) - dayNumber(task.start_on) + 1) * scale)}" height="16" rx="3" fill="${escape(colors.accent)}"/><title>${escape(`${task.title}: ${task.start_on} to ${task.due_on}`)}</title>` : `<text x="360" y="${y}" font-size="11" fill="${escape(colors.muted)}">Unscheduled</text>`}</g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Workspace timeline"><rect width="100%" height="100%" fill="${escape(colors.paper)}"/><g fill="${escape(colors.text)}" font-family="system-ui, sans-serif"><text x="24" y="35" font-size="22">${escape(title)}</text><text x="24" y="61" font-size="12" fill="${escape(colors.muted)}">${tasks.length} tasks${dates.length ? ` · ${dateFromDay(first)} to ${dateFromDay(last)}` : ""} · Date-only schedule</text>${rows}</g></svg>`;
}

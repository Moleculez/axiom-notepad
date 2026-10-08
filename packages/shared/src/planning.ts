import { z } from "zod";
import { customFieldsPatchSchema, fieldSummaryText, type FieldValue, type TaskField } from "./planning-lab";
import {
  dateOnlySchema,
  taskStatusSchema,
  taskPrioritySchema,
  timezoneSchema,
  type Task,
} from "./workspace";

export const dependencyLinkSchema = z.object({
  taskId: z.uuid(),
  lagDays: z.number().int().min(-365).max(365).default(0),
});
export type DependencyLink = z.infer<typeof dependencyLinkSchema>;
/** Pure native task creation contract shared by HTTP and integration discovery. */
export const taskInput = z.object({
  title: z.string().trim().min(1).max(300),
  body: z.string().max(100000).default(""),
  status: taskStatusSchema.default("todo"),
  priority: taskPrioritySchema.default("normal"),
  assigneeId: z.string().max(100).nullable().default(null),
  parentId: z.uuid().nullable().default(null),
  startOn: dateOnlySchema.nullable().default(null),
  dueOn: dateOnlySchema.nullable().default(null),
  estimateHours: z.number().min(0).max(10000).nullable().default(null),
  labels: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  milestoneId: z.uuid().nullable().default(null),
  noteId: z.uuid().nullable().default(null),
  resourceIds: z.array(z.uuid()).max(100).default([]),
  dependencies: z.array(z.uuid()).max(100).default([]),
  dependencyLinks: z.array(dependencyLinkSchema).max(100).optional(),
  progressPercent: z.number().int().min(0).max(100).default(0),
  position: z.number().finite().default(0),
});
export function taskDependencyLinks(task: {
  dependencies?: string[];
  dependencyLinks?: DependencyLink[];
}): DependencyLink[] {
  const lags = new Map(
    (task.dependencyLinks ?? []).map((link) => [link.taskId, link.lagDays]),
  );
  return [
    ...new Set(
      task.dependencies ?? task.dependencyLinks?.map((l) => l.taskId) ?? [],
    ),
  ].map((taskId) => ({ taskId, lagDays: lags.get(taskId) ?? 0 }));
}
/** Old ID-only writes retain offsets on unchanged links. New links start at zero. */
export function resolveDependencyLinks(
  raw: { dependencies?: string[]; dependencyLinks?: DependencyLink[] },
  previous: DependencyLink[] = [],
): DependencyLink[] {
  if (raw.dependencyLinks !== undefined) {
    const links = z
      .array(dependencyLinkSchema)
      .max(100)
      .parse(raw.dependencyLinks);
    if (new Set(links.map((l) => l.taskId)).size !== links.length)
      throw new Error("A dependency may appear only once.");
    if (
      raw.dependencies !== undefined &&
      (new Set(raw.dependencies).size !== links.length ||
        links.some((l) => !raw.dependencies!.includes(l.taskId)))
    )
      throw new Error("Dependency IDs and relationships must agree.");
    return links;
  }
  if (raw.dependencies === undefined) return previous;
  const prior = new Map(previous.map((l) => [l.taskId, l.lagDays]));
  return [...new Set(z.array(z.uuid()).max(100).parse(raw.dependencies))].map(
    (taskId) => ({ taskId, lagDays: prior.get(taskId) ?? 0 }),
  );
}

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
  dependencyLinks: z.array(dependencyLinkSchema).max(100).optional(),
  progressPercent: z.number().int().min(0).max(100).default(0),
  version: z.number().int().positive().optional(),
  customFields: customFieldsPatchSchema.optional(),
  fieldsVersion: z.number().int().positive().optional(),
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
  dependencyLinks?: DependencyLink[];
  progress_percent?: number;
  derived_progress_percent?: number;
  has_children?: boolean;
  custom_fields?: Record<string, FieldValue>;
  fields_version?: number;
  field_summaries?: Record<string, { value: FieldValue; truncated: boolean }>;
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
  capacity?: {
    coverage: string;
    start: string;
    end: string;
    truncated: boolean;
    direct: CapacityChange[];
    proposed: CapacityChange[];
  };
  before: {
    id: string;
    title: string;
    startOn: string | null;
    dueOn: string | null;
  }[];
};
export type CapacityChange = {
  userId: string;
  name: string;
  week: string;
  before: number;
  after: number;
  available: number | null;
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
/** Offset from the next working day; -1 permits overlap on the predecessor's finish. */
export function dependencyStart(
  end: string,
  lagDays: number,
  calendar: PlanningCalendar,
) {
  if (!Number.isInteger(lagDays) || Math.abs(lagDays) > 365)
    throw new Error("Use an integer lag from -365 to 365 working days.");
  let current = nextWorkingDay(end, calendar);
  const direction = lagDays < 0 ? -1 : 1;
  for (let n = 0; n < Math.abs(lagDays); n++) {
    current = addDays(current, direction);
    for (let i = 0; !workingDay(current, calendar); i++) {
      if (i > 10000)
        throw new Error("No working day within the supported calendar range.");
      current = addDays(current, direction);
    }
  }
  return current;
}

/** One leaf, one contribution: parents never double-count their descendants. */
export function planningProgress(tasks: PlanningTask[]) {
  const children = new Map<string, string[]>(),
    byId = new Map(tasks.map((t) => [t.id, t]));
  for (const t of tasks)
    if (t.parent_id && byId.has(t.parent_id)) {
      const list = children.get(t.parent_id) ?? [];
      list.push(t.id);
      children.set(t.parent_id, list);
    }
  const results = new Map<string, { sum: number; count: number }>(),
    visiting = new Set<string>();
  const stack = tasks.map((t) => ({ id: t.id, exit: false }));
  while (stack.length) {
    const { id, exit } = stack.pop()!;
    if (results.has(id)) continue;
    const t = byId.get(id)!;
    if (exit) {
      const values = (children.get(id) ?? []).flatMap(
        (id) => results.get(id) ?? [],
      );
      results.set(
        id,
        values.reduce(
          (a, b) => ({ sum: a.sum + b.sum, count: a.count + b.count }),
          { sum: 0, count: 0 },
        ),
      );
    } else if (!children.has(id))
      results.set(
        id,
        t.status === "cancelled"
          ? { sum: 0, count: 0 }
          : {
              sum: t.status === "done" ? 100 : (t.progress_percent ?? 0),
              count: 1,
            },
      );
    else if (!visiting.has(id)) {
      visiting.add(id);
      stack.push(
        { id, exit: true },
        ...(children.get(id) ?? []).map((id) => ({ id, exit: false })),
      );
    }
  }
  return new Map(
    tasks.map((t) => {
      const r = results.get(t.id);
      return [
        t.id,
        t.derived_progress_percent ??
          (r?.count ? Math.round(r.sum / r.count) : 0),
      ];
    }),
  );
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
    for (const { taskId: predecessorId, lagDays } of taskDependencyLinks(
      task,
    )) {
      const predecessor = dates.get(predecessorId)!;
      if (!predecessor.end && changed.has(predecessorId))
        warnings.push(
          `${task.title}: predecessor is unscheduled; existing dates were kept.`,
        );
      if (!predecessor.end || !own.start) continue;
      const minimum = dependencyStart(predecessor.end, lagDays, calendar);
      if (
        own.start < minimum &&
        (changed.has(predecessorId) || directIds.has(id))
      ) {
        conflicts.push({
          taskId: id,
          predecessorId,
          earliest: minimum,
          reason:
            lagDays === 0
              ? "Starts before the next working day after its predecessor finishes."
              : `Starts before the finish-to-start constraint (${lagDays > 0 ? "+" : ""}${lagDays} working days).`,
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
export function planningCsv(
  tasks: PlanningTask[],
  options: {
    milestones?: Array<{
      id: string;
      title: string;
      due_on: string | null;
      completed_at: unknown;
    }>;
    baseline?: PlanningTask[];
    criticalIds?: string[];
    scope?: string;
    fields?:TaskField[];
    people?:Array<{id:string;name:string}>;
  } = {},
) {
  const progress = planningProgress(tasks),
    names = new Map(tasks.map((t) => [t.id, t.title])),
    milestones = new Map(options.milestones?.map((m) => [m.id, m]) ?? []),
    baseline = new Map(options.baseline?.map((t) => [t.id, t]) ?? []),
    critical = new Set(options.criticalIds ?? []);
  const cell = (value: unknown) =>
    `"${String(value ?? "")
      .replace(/^(?:\s*[=+@\-]|[\t\r])/, "'$&")
      .replaceAll('"', '""')}"`;
  return [
    [
      "Title",
      "Status",
      "Assignee",
      "Start",
      "Due",
      "Priority",
      "Workspace",
      "Progress (%)",
      "Predecessors (working-day offsets)",
      "Milestone",
      "Milestone due",
      "Baseline start",
      "Baseline due",
      "Critical path",
      "Export scope",
      "Record type",
      ...(options.fields??[]).map(f=>f.name+" (preview)"),
    ],
    ...tasks.map((t) => [
      t.title,
      t.status,
      t.assignee_name,
      t.start_on,
      t.due_on,
      t.priority,
      t.space_id,
      progress.get(t.id) ?? 0,
      taskDependencyLinks(t)
        .map(
          (l) =>
            `${names.get(l.taskId) ?? "Outside export"} (${l.lagDays > 0 ? "+" : ""}${l.lagDays}d)`,
        )
        .join("; "),
      t.milestone_id
        ? (milestones.get(t.milestone_id)?.title ?? "Outside export")
        : "",
      t.milestone_id ? milestones.get(t.milestone_id)?.due_on : "",
      baseline.get(t.id)?.start_on,
      baseline.get(t.id)?.due_on,
      critical.has(t.id) ? "yes" : "",
      options.scope ?? "Loaded filtered tasks",
      "task",
      ...(options.fields??[]).map(f=>fieldSummaryText(f,t.field_summaries,options.people)),
    ]),
    ...(options.milestones ?? []).map((m) => [
      m.title,
      m.completed_at ? "done" : "open",
      "",
      "",
      m.due_on,
      "",
      "",
      "",
      "",
      m.title,
      m.due_on,
      "",
      "",
      "",
      options.scope ?? "Loaded filtered tasks",
      "milestone",
      ...(options.fields??[]).map(()=>""),
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
  options: {
    milestones?: Array<{
      id: string;
      title: string;
      due_on: string | null;
      completed_at: unknown;
    }>;
    baseline?: PlanningTask[];
    criticalIds?: string[];
    scope?: string;
  } = {},
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
  const dates = [...tasks, ...(options.baseline ?? [])]
      .flatMap((task) => [task.start_on, task.due_on])
      .concat(options.milestones?.map((m) => m.due_on) ?? [])
      .filter((d): d is string => !!d),
    first = dates.length
      ? Math.min(...dates.map(dayNumber))
      : dayNumber("2000-01-01"),
    last = dates.length ? Math.max(...dates.map(dayNumber)) : first + 30;
  const width = 1200,
    height = 150 + (tasks.length + (options.milestones?.length ?? 0)) * 30,
    scale = 800 / Math.max(30, last - first + 1),
    x = (date: string) => 360 + (dayNumber(date) - first) * scale;
  const progress = planningProgress(tasks),
    index = new Map(tasks.map((t, i) => [t.id, i])),
    byId = new Map(tasks.map((t) => [t.id, t])),
    base = new Map(options.baseline?.map((t) => [t.id, t]) ?? []),
    critical = new Set(options.criticalIds ?? []);
  const rows = tasks
    .map((task, i) => {
      const y = 100 + i * 30;
      const before = base.get(task.id),
        barWidth =
          task.start_on && task.due_on
            ? Math.max(
                2,
                (dayNumber(task.due_on) - dayNumber(task.start_on) + 1) * scale,
              )
            : 0;
      return `<g><line x1="24" x2="1176" y1="${y + 15}" y2="${y + 15}" stroke="${escape(colors.line)}"/><text x="24" y="${y}" font-size="12">${escape(task.title.slice(0, 42))}</text><text x="310" y="${y}" font-size="10">${progress.get(task.id) ?? 0}%</text>${before?.start_on && before.due_on ? `<rect x="${x(before.start_on)}" y="${y + 7}" width="${Math.max(2, (dayNumber(before.due_on) - dayNumber(before.start_on) + 1) * scale)}" height="3" fill="${escape(colors.muted)}"/>` : ""}${task.start_on && task.due_on ? `<rect x="${x(task.start_on)}" y="${y - 12}" width="${barWidth}" height="16" rx="3" fill="${escape(colors.accent)}" opacity=".3" stroke="${critical.has(task.id) ? "#b85454" : escape(colors.accent)}" stroke-width="${critical.has(task.id) ? 2 : 1}"/><rect x="${x(task.start_on)}" y="${y - 12}" width="${(barWidth * (progress.get(task.id) ?? 0)) / 100}" height="16" rx="3" fill="${escape(colors.accent)}"/><title>${escape(`${task.title}: ${task.start_on} to ${task.due_on}`)}</title>` : `<text x="360" y="${y}" font-size="11" fill="${escape(colors.muted)}">Unscheduled</text>`}</g>`;
    })
    .join("");
  const edges = tasks
    .flatMap((t, i) =>
      taskDependencyLinks(t).flatMap((link) => {
        const p = byId.get(link.taskId),
          from = index.get(link.taskId);
        if (!p?.due_on || !t.start_on || from === undefined) return [];
        const a = x(p.due_on) + scale,
          b = x(t.start_on),
          y1 = 94 + from * 30,
          y2 = 94 + i * 30;
        return [
          `<g><path d="M${a},${y1} H${a + 8} V${y2 - 10} H${b - 6} V${y2} H${b}" fill="none" stroke="${escape(colors.muted)}" stroke-width="1" marker-end="url(#arrow)"/><title>${escape(`${p.title} → ${t.title}: ${link.lagDays} working days`)}</title>${link.lagDays ? `<text x="${(a + b) / 2}" y="${y2 - 12}" font-size="9">${link.lagDays > 0 ? "+" : ""}${link.lagDays}d</text>` : ""}</g>`,
        ];
      }),
    )
    .join("");
  const milestones = (options.milestones ?? [])
    .map((m, i) => {
      const y = 100 + (tasks.length + i) * 30;
      return `<text x="24" y="${y}" font-size="12">${escape(m.title.slice(0, 42))}</text>${m.due_on ? `<path d="M${x(m.due_on)},${y - 14} l7,7 l-7,7 l-7,-7 Z" fill="${escape(colors.accent)}" opacity="${m.completed_at ? 1 : 0.5}"/>` : ""}`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Workspace timeline"><defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="${escape(colors.muted)}"/></marker></defs><rect width="100%" height="100%" fill="${escape(colors.paper)}"/><g fill="${escape(colors.text)}" font-family="system-ui, sans-serif"><text x="24" y="35" font-size="22">${escape(title)}</text><text x="24" y="61" font-size="12" fill="${escape(colors.muted)}">${tasks.length} tasks${dates.length ? ` · ${dateFromDay(first)} to ${dateFromDay(last)}` : ""} · Date-only schedule · ${escape(options.scope ?? "Loaded / filtered tasks; outside links excluded; private drafts excluded")}</text>${rows}${edges}${milestones}<text x="24" y="${height - 24}" font-size="11" fill="${escape(colors.muted)}">Legend: filled portion = progress · thin lower bar = baseline · red outline = critical · diamond = milestone · arrow offsets = working days</text></g></svg>`;
}

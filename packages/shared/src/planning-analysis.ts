import { z } from "zod";
import { dateOnlySchema } from "./workspace";
import {
  addDays,
  dayNumber,
  dependencyOrder,
  type PlanningCalendar,
  type PlanningTask,
  type SchedulePlan,
  type CapacityChange,
} from "./planning";

export const availabilitySchema = z
  .object({
    weeklyHours: z.number().min(0).max(168).nullable(),
    workingDays: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .refine((v) => new Set(v).size === v.length, "Choose each weekday once."),
    exceptions: z
      .array(
        z
          .object({ date: dateOnlySchema, hours: z.number().min(0).max(24) })
          .strict(),
      )
      .max(366)
      .refine(
        (v) => new Set(v.map((x) => x.date)).size === v.length,
        "Each date may have one exception.",
      ),
  })
  .strict()
  .refine(
    (v) => v.weeklyHours === null || v.weeklyHours <= v.workingDays.length * 24,
    "Weekly availability exceeds the selected working days.",
  );
export type Availability = z.infer<typeof availabilitySchema>;
export const unknownAvailability: Availability = {
  weeklyHours: null,
  workingDays: [1, 2, 3, 4, 5],
  exceptions: [],
};
const open = (t: PlanningTask) =>
  !t.deleted_at && !["done", "cancelled"].includes(t.status);
const weekday = (date: string) => new Date(date + "T00:00:00Z").getUTCDay();
export const capacityWeekStart = (date: string) =>
  addDays(date, -((weekday(date) + 6) % 7));
export function isWorking(date: string, calendar: PlanningCalendar) {
  return (
    calendar.exceptions.find((e) => e.date === date)?.working ??
    calendar.workingDays.includes(weekday(date))
  );
}
/** Constant-time weekday counting plus bounded exceptional dates. */
export function countWorking(
  start: string,
  end: string,
  calendar: PlanningCalendar,
) {
  const days = dayNumber(end) - dayNumber(start) + 1;
  if (days < 1 || days > 36526)
    throw new Error("Planning dates must span at most 100 years.");
  let count = Math.floor(days / 7) * calendar.workingDays.length;
  for (let i = 0; i < days % 7; i++)
    if (calendar.workingDays.includes((weekday(start) + i) % 7)) count++;
  for (const e of calendar.exceptions)
    if (e.date >= start && e.date <= end)
      count +=
        Number(e.working) -
        Number(calendar.workingDays.includes(weekday(e.date)));
  return count;
}
export type TaskAnalysis = {
  id: string;
  title: string;
  earliestStart: string;
  earliestFinish: string;
  slackDays: number;
  critical: boolean;
};
export type PlanningAnalysis = {
  tasks: TaskAnalysis[];
  incompleteIds: string[];
  forecastFinish: string | null;
  warnings: string[];
};
export function analyzeSchedule(
  tasks: PlanningTask[],
  calendar: PlanningCalendar,
): PlanningAnalysis {
  const order = dependencyOrder(tasks),
    byId = new Map(tasks.map((t) => [t.id, t]));
  const scheduled = tasks.filter((t) => open(t) && t.start_on && t.due_on);
  if (!scheduled.length)
    return {
      tasks: [],
      incompleteIds: tasks.filter(open).map((t) => t.id),
      forecastFinish: null,
      warnings: [],
    };
  const first = scheduled.reduce(
    (d, t) => (t.start_on! < d ? t.start_on! : d),
    scheduled[0].start_on!,
  );
  const exceptions = new Map(
    calendar.exceptions.map((e) => [e.date, e.working]),
  );
  const days: string[] = [];
  for (let i = 0; i <= 36525; i++) {
    const date = addDays(first, i);
    if (exceptions.get(date) ?? calendar.workingDays.includes(weekday(date)))
      days.push(date);
  }
  const index = (date: string) => {
    let low = 0,
      high = days.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (days[mid] < date) low = mid + 1;
      else high = mid;
    }
    if (low >= days.length)
      throw new Error("The forecast exceeds the 100-year analysis horizon.");
    return low;
  };
  const incomplete = new Set<string>(),
    timing = new Map<
      string,
      { start: number; finish: number; duration: number; latest: number }
    >();
  const successors = new Map<string, string[]>();
  let finish = 0;
  for (const id of order) {
    const task = byId.get(id)!;
    if (!open(task)) continue;
    const dependencies = (task.dependencies ?? []).filter(
      (id) => byId.get(id)!.status !== "done",
    );
    if (
      !task.start_on ||
      !task.due_on ||
      task.due_on < task.start_on ||
      dependencies.some(
        (id) => incomplete.has(id) || byId.get(id)!.status === "cancelled",
      )
    ) {
      incomplete.add(id);
      continue;
    }
    const duration = Math.max(
      1,
      countWorking(task.start_on, task.due_on, calendar),
    );
    let start = index(task.start_on);
    for (const dep of dependencies) {
      const before = timing.get(dep);
      if (before) start = Math.max(start, before.finish + 1);
      const children = successors.get(dep) ?? [];
      children.push(id);
      successors.set(dep, children);
    }
    const end = start + duration - 1;
    if (end >= days.length)
      throw new Error("The forecast exceeds the 100-year analysis horizon.");
    finish = Math.max(finish, end);
    timing.set(id, { start, finish: end, duration, latest: end });
  }
  for (const id of [...order].reverse()) {
    const t = timing.get(id);
    if (!t) continue;
    const following = (successors.get(id) ?? []).flatMap(
      (id) => timing.get(id) ?? [],
    );
    t.latest = following.length
      ? following.reduce((n, t) => Math.min(n, t.latest - t.duration), Infinity)
      : finish;
  }
  return {
    tasks: [...timing].map(([id, t]) => ({
      id,
      title: byId.get(id)!.title,
      earliestStart: days[t.start],
      earliestFinish: days[t.finish],
      slackDays: Math.max(0, t.latest - t.finish),
      critical: t.latest === t.finish,
    })),
    incompleteIds: [...incomplete],
    forecastFinish: timing.size ? days[finish] : null,
    warnings: incomplete.size
      ? [
          "Tasks with missing dates or cancelled/incomplete predecessors are excluded, including dependent chains. This is a partial forecast.",
        ]
      : [],
  };
}

export type BaselineSnapshot = {
  tasks: PlanningTask[];
  calendar: PlanningCalendar;
  milestones: Record<string, unknown>[];
  planningVersion: number;
};
// PostgreSQL JSONB reorders object keys. Compare values, not storage order;
// JSON.stringify also normalizes Date objects to the strings in saved snapshots.
function stableJson(value: unknown) {
  return JSON.stringify(value, (_key, entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.keys(entry)
            .sort()
            .map((key) => [key, entry[key]]),
        )
      : entry,
  );
}
function calendarValue(calendar: PlanningCalendar) {
  return {
    ...calendar,
    workingDays: [...calendar.workingDays].sort(),
    exceptions: [...calendar.exceptions].sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
  };
}
export function compareBaseline(
  before: BaselineSnapshot,
  after: BaselineSnapshot,
) {
  const old = new Map(before.tasks.map((t) => [t.id, t])),
    current = new Map(after.tasks.map((t) => [t.id, t]));
  const fields = [
    "title",
    "start_on",
    "due_on",
    "status",
    "assignee_id",
    "estimate_hours",
    "dependencies",
    "milestone_id",
  ] as const;
  return {
    calendarChanged:
      stableJson(calendarValue(before.calendar)) !==
      stableJson(calendarValue(after.calendar)),
    milestonesChanged:
      stableJson(
        [...before.milestones].sort((a, b) =>
          String(a.id).localeCompare(String(b.id)),
        ),
      ) !==
      stableJson(
        [...after.milestones].sort((a, b) =>
          String(a.id).localeCompare(String(b.id)),
        ),
      ),
    items: [...new Set([...old.keys(), ...current.keys()])].flatMap((id) => {
      const a = old.get(id),
        b = current.get(id);
      const changed =
        a && b
          ? fields.filter((f) =>
              f === "dependencies"
                ? stableJson([...(a[f] ?? [])].sort()) !==
                  stableJson([...(b[f] ?? [])].sort())
                : stableJson(a[f]) !== stableJson(b[f]),
            )
          : [];
      if (a && b && !changed.length) return [];
      return [
        {
          id,
          title: b?.title ?? a!.title,
          kind: !a ? "added" : !b ? "removed" : "changed",
          fields: changed,
          before: a ?? null,
          after: b ?? null,
          finishVarianceDays:
            a?.due_on && b?.due_on
              ? dayNumber(b.due_on) - dayNumber(a.due_on)
              : null,
        },
      ];
    }),
  };
}
export type CapacityPerson = {
  id: string;
  name: string;
  availability: Availability;
  version: number;
};
export function capacityReport(
  tasks: PlanningTask[],
  calendars: Record<string, PlanningCalendar>,
  people: CapacityPerson[],
  start: string,
  weeks: number,
) {
  dateOnlySchema.parse(start);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52)
    throw new Error("Choose between 1 and 52 weeks.");
  const monday = capacityWeekStart(start);
  const labels = Array.from({ length: weeks }, (_, i) =>
    addDays(monday, i * 7),
  );
  const end = addDays(monday, weeks * 7 - 1);
  const rows = people.map((p) => ({
    ...p,
    weeks: labels.map((date) => {
      let hours = 0,
        unknown = false;
      for (let i = 0; i < 7; i++) {
        const d = addDays(date, i),
          exception = p.availability.exceptions.find((e) => e.date === d);
        if (exception) hours += exception.hours;
        else if (p.availability.workingDays.includes(weekday(d))) {
          if (p.availability.weeklyHours === null) unknown = true;
          else
            hours +=
              p.availability.weeklyHours / p.availability.workingDays.length;
        }
      }
      return {
        date,
        available: unknown ? null : hours,
        demand: 0,
        taskIds: [] as string[],
      };
    }),
  }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const unallocated = {
    unscheduled: [] as string[],
    unassigned: [] as string[],
    unestimated: [] as string[],
    nonworking: [] as string[],
  };
  // Cache each workspace's visible working-day prefix once. Allocation then
  // visits weeks, not every day/exception for every task in a large portfolio.
  const firstDay = dayNumber(monday);
  const working = new Map<string, number[]>();
  for (const [id, calendar] of Object.entries(calendars)) {
    const exceptions = new Map(
      calendar.exceptions.map((e) => [e.date, e.working]),
    );
    const prefix = [0];
    for (let i = 0; i < weeks * 7; i++) {
      const date = addDays(monday, i);
      prefix.push(
        prefix[i] +
          Number(
            exceptions.get(date) ??
              calendar.workingDays.includes(weekday(date)),
          ),
      );
    }
    working.set(id, prefix);
  }
  for (const task of tasks.filter(open)) {
    if (!task.assignee_id || !byId.has(task.assignee_id))
      unallocated.unassigned.push(task.id);
    if (!task.start_on || !task.due_on) unallocated.unscheduled.push(task.id);
    if (task.estimate_hours == null) unallocated.unestimated.push(task.id);
    if (
      !task.start_on ||
      !task.due_on ||
      !task.assignee_id ||
      task.estimate_hours == null
    )
      continue;
    const row = byId.get(task.assignee_id),
      calendar = calendars[task.space_id];
    if (!row || !calendar || task.due_on < monday || task.start_on > end)
      continue;
    const count = countWorking(task.start_on, task.due_on, calendar);
    if (!count) {
      unallocated.nonworking.push(task.id);
      continue;
    }
    const daily = task.estimate_hours / count;
    const lo = Math.max(0, dayNumber(task.start_on) - firstDay),
      hi = Math.min(weeks * 7, dayNumber(task.due_on) - firstDay + 1),
      prefix = working.get(task.space_id)!;
    for (let w = Math.floor(lo / 7); w < Math.ceil(hi / 7); w++) {
      const days =
        prefix[Math.min(hi, (w + 1) * 7)] - prefix[Math.max(lo, w * 7)];
      if (!days) continue;
      row.weeks[w].demand += daily * days;
      row.weeks[w].taskIds.push(task.id);
    }
  }
  return { start: monday, end, weeks: labels, people: rows, unallocated };
}

/** Show changed weekly demand without silently inventing estimates or levelling. */
export function scheduleCapacity(
  tasks: PlanningTask[],
  calendar: PlanningCalendar,
  people: CapacityPerson[],
  plan: SchedulePlan,
): SchedulePlan["capacity"] {
  const ids = new Set(plan.proposed.map((t) => t.id));
  const dates = [
    ...tasks
      .filter((t) => ids.has(t.id))
      .flatMap((t) => [t.start_on, t.due_on]),
    ...plan.proposed.flatMap((t) => [t.startOn, t.dueOn]),
  ]
    .filter((d): d is string => !!d)
    .sort();
  if (!dates.length) return undefined;
  const start = dates[0],
    weeks = Math.min(
      52,
      Math.ceil(
        (dayNumber(dates.at(-1)!) -
          dayNumber(start) +
          ((weekday(start) + 6) % 7) +
          1) /
          7,
      ),
    );
  const calendars = Object.fromEntries(
    tasks.map((t) => [t.space_id, calendar]),
  );
  const before = capacityReport(tasks, calendars, people, start, weeks);
  let truncated = dates.at(-1)! > before.end;
  const calculate = (mode: "direct" | "proposed") => {
    const changes = new Map(plan[mode].map((t) => [t.id, t]));
    const next = tasks.map((t) => {
      const c = changes.get(t.id);
      return c ? { ...t, start_on: c.startOn, due_on: c.dueOn } : t;
    });
    const after = capacityReport(next, calendars, people, start, weeks);
    const rows: CapacityChange[] = [];
    after.people.forEach((p, i) =>
      p.weeks.forEach((w, j) => {
        const old = before.people[i].weeks[j].demand;
        if (Math.abs(old - w.demand) > 0.00001) {
          if (rows.length >= 200) truncated = true;
          else
            rows.push({
              userId: p.id,
              name: p.name,
              week: w.date,
              before: old,
              after: w.demand,
              available: w.available,
            });
        }
      }),
    );
    return rows;
  };
  const direct = calculate("direct"),
    proposed = calculate("proposed");
  return {
    coverage:
      "This workspace's estimated demand against group availability. Other workspace commitments are not included; use Group capacity for combined demand.",
    start: before.start,
    end: before.end,
    truncated,
    direct,
    proposed,
  };
}

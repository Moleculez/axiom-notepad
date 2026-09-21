import { expect, test } from "vitest";
import {
  analyzeSchedule,
  availabilitySchema,
  capacityReport,
  capacityWeekStart,
  compareBaseline,
  countWorking,
  unknownAvailability,
  scheduleCapacity,
} from "../packages/shared/src/planning-analysis";
import {
  calendarSchema,
  type PlanningTask,
  planSchedule,
} from "../packages/shared/src/planning";
const calendar = calendarSchema.parse({ timezone: "America/New_York" });
const task = (id: string, extra: Partial<PlanningTask> = {}): PlanningTask => ({
  id,
  space_id: "s",
  project_id: null,
  title: id,
  body: "",
  status: "todo",
  priority: "normal",
  assignee_id: "u",
  parent_id: null,
  start_on: "2026-09-21",
  due_on: "2026-09-25",
  estimate_hours: 10,
  labels: [],
  milestone_id: null,
  note_id: null,
  position: 0,
  version: 1,
  created_at: "",
  updated_at: "",
  deleted_at: null,
  resource_ids: [],
  dependencies: [],
  ...extra,
});
test("schedule capacity compares exact old and reviewed weeks without reallocating work", () => {
  const tasks = [task("a")],
    plan = planSchedule(
      tasks,
      [{ id: "a", version: 1, startOn: "2026-09-28", dueOn: "2026-10-02" }],
      calendar,
    );
  const impact = scheduleCapacity(
    tasks,
    calendar,
    [
      {
        id: "u",
        name: "Researcher",
        version: 1,
        availability: { ...unknownAvailability, weeklyHours: 5 },
      },
    ],
    plan,
  )!;
  expect(impact.proposed).toEqual([
    {
      userId: "u",
      name: "Researcher",
      week: "2026-09-21",
      before: 10,
      after: 0,
      available: 5,
    },
    {
      userId: "u",
      name: "Researcher",
      week: "2026-09-28",
      before: 0,
      after: 10,
      available: 5,
    },
  ]);
  expect(tasks[0].start_on).toBe("2026-09-21");
});
test("wide dependency fanout and thousands of allocations remain bounded", () => {
  const tasks = Array.from({ length: 5000 }, (_, i) =>
    task(String(i), { dependencies: i ? ["0"] : [] }),
  );
  const start = performance.now();
  const result = analyzeSchedule(tasks, calendar);
  const capacity = capacityReport(
    tasks,
    { s: calendar },
    [{ id: "u", name: "R", version: 0, availability: unknownAvailability }],
    "2026-09-21",
    12,
  );
  expect(result.tasks).toHaveLength(5000);
  expect(capacity.people[0].weeks[0].taskIds).toHaveLength(5000);
  expect(performance.now() - start).toBeLessThan(5000);
});
test("workday counts include boundaries and exception replacements", () => {
  expect(countWorking("2026-09-21", "2026-10-04", calendar)).toBe(10);
  expect(
    countWorking("2026-09-21", "2026-10-04", {
      ...calendar,
      exceptions: [
        { date: "2026-09-23", working: false },
        { date: "2026-09-26", working: true },
      ],
    }),
  ).toBe(10);
  expect(countWorking("2026-09-26", "2026-09-27", calendar)).toBe(0);
});
test("critical path uses full dependencies and reports parallel slack", () => {
  const result = analyzeSchedule(
    [
      task("a"),
      task("b", { dependencies: ["a"] }),
      task("c", { due_on: "2026-09-21" }),
    ],
    calendar,
  );
  expect(result.forecastFinish).toBe("2026-10-02");
  expect(result.tasks.find((t) => t.id === "b")).toMatchObject({
    earliestStart: "2026-09-28",
    critical: true,
    slackDays: 0,
  });
  expect(result.tasks.find((t) => t.id === "c")?.slackDays).toBe(9);
});
test("incomplete predecessor chains are not presented as critical", () => {
  const result = analyzeSchedule(
    [
      task("a", { start_on: null }),
      task("b", { dependencies: ["a"] }),
      task("c"),
    ],
    calendar,
  );
  expect(result.incompleteIds).toEqual(["a", "b"]);
  expect(result.warnings).toHaveLength(1);
  expect(result.tasks.map((t) => t.id)).toEqual(["c"]);
});
test("completed predecessors are satisfied; cancelled predecessors make a chain incomplete", () => {
  expect(
    analyzeSchedule(
      [task("a", { status: "done" }), task("b", { dependencies: ["a"] })],
      calendar,
    ).forecastFinish,
  ).toBe("2026-09-25");
  expect(
    analyzeSchedule(
      [task("a", { status: "cancelled" }), task("b", { dependencies: ["a"] })],
      calendar,
    ).incompleteIds,
  ).toEqual(["b"]);
});
test("cycles fail without recursive traversal", () =>
  expect(() =>
    analyzeSchedule(
      [task("a", { dependencies: ["b"] }), task("b", { dependencies: ["a"] })],
      calendar,
    ),
  ).toThrow(/cycle/));
test("an empty plan has no invented finish", () =>
  expect(analyzeSchedule([], calendar)).toEqual({
    tasks: [],
    incompleteIds: [],
    forecastFinish: null,
    warnings: [],
  }));
test("baseline differences report task identity, dates, calendar and removals", () => {
  const base = {
    tasks: [task("a"), task("b")],
    calendar,
    milestones: [],
    planningVersion: 1,
  };
  const result = compareBaseline(base, {
    ...base,
    tasks: [task("a", { due_on: "2026-09-28" }), task("c")],
    calendar: { ...calendar, workingDays: [1, 2, 3, 4] },
  });
  expect(result.calendarChanged).toBe(true);
  expect(result.items.map((t) => [t.id, t.kind])).toEqual([
    ["a", "changed"],
    ["b", "removed"],
    ["c", "added"],
  ]);
  expect(result.items[0].finishVarianceDays).toBe(3);
  expect(base.tasks[0].due_on).toBe("2026-09-25");
});
test("capacity dates use a Monday-based week across year boundaries", () => {
  expect(capacityWeekStart("2026-09-21")).toBe("2026-09-21");
  expect(capacityWeekStart("2026-09-27")).toBe("2026-09-21");
  expect(capacityWeekStart("2027-01-01")).toBe("2026-12-28");
});
test("baseline comparison ignores JSONB key order and unordered calendar or dependency entries", () => {
  const base = {
    tasks: [task("a", { dependencies: ["b", "c"] })],
    calendar: {
      ...calendar,
      exceptions: [
        { date: "2026-09-21", working: false },
        { date: "2026-09-22", working: true },
      ],
    },
    milestones: [
      {
        id: "b",
        title: "Review",
        completed_at: new Date("2026-09-21T12:00:00Z"),
      },
      { id: "a", title: "Start", completed_at: null },
    ],
    planningVersion: 1,
  };
  const stored = JSON.parse(
    JSON.stringify(base, (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value,
    ),
  );
  stored.calendar.workingDays.reverse();
  stored.calendar.exceptions.reverse();
  stored.milestones.reverse();
  stored.tasks[0].dependencies.reverse();
  expect(compareBaseline(stored, base)).toEqual({
    calendarChanged: false,
    milestonesChanged: false,
    items: [],
  });
  stored.calendar.timezone = "Europe/London";
  stored.milestones[0].title = "Renamed";
  stored.tasks[0].dependencies.push("d");
  const changed = compareBaseline(stored, base);
  expect(changed.calendarChanged).toBe(true);
  expect(changed.milestonesChanged).toBe(true);
  expect(changed.items[0].fields).toEqual(["dependencies"]);
});
test("capacity divides full-duration estimates, not the visible-window portion", () => {
  const report = capacityReport(
    [task("a", { due_on: "2026-10-02", estimate_hours: 40 })],
    { s: calendar },
    [
      {
        id: "u",
        name: "Researcher",
        availability: { ...unknownAvailability, weeklyHours: 30 },
        version: 1,
      },
    ],
    "2026-09-23",
    1,
  );
  expect(report.start).toBe("2026-09-21");
  expect(report.people[0].weeks[0]).toMatchObject({
    demand: 20,
    available: 30,
    taskIds: ["a"],
  });
});
test("unknown capacity differs from zero and date exceptions replace availability", () => {
  const people = [
    { id: "u", name: "Unknown", availability: unknownAvailability, version: 0 },
    {
      id: "v",
      name: "Away",
      availability: {
        ...unknownAvailability,
        weeklyHours: 0,
        exceptions: [{ date: "2026-09-22", hours: 4 }],
      },
      version: 1,
    },
  ];
  const report = capacityReport([], { s: calendar }, people, "2026-09-21", 1);
  expect(report.people[0].weeks[0].available).toBe(null);
  expect(report.people[1].weeks[0].available).toBe(4);
});
test("capacity preserves unallocated work and excludes completed work", () => {
  const report = capacityReport(
    [
      task("a", { start_on: null, estimate_hours: null, assignee_id: null }),
      task("b", { status: "done" }),
    ],
    { s: calendar },
    [{ id: "u", name: "U", availability: unknownAvailability, version: 0 }],
    "2026-09-21",
    1,
  );
  expect(report.unallocated).toMatchObject({
    unscheduled: ["a"],
    unassigned: ["a"],
    unestimated: ["a"],
  });
  expect(report.people[0].weeks[0].demand).toBe(0);
});
test("availability rejects duplicate dates, impossible hours and duplicate weekdays", () => {
  expect(
    availabilitySchema.safeParse({
      ...unknownAvailability,
      workingDays: [1, 1],
    }).success,
  ).toBe(false);
  expect(
    availabilitySchema.safeParse({
      ...unknownAvailability,
      workingDays: [1],
      weeklyHours: 30,
    }).success,
  ).toBe(false);
  expect(
    availabilitySchema.safeParse({
      ...unknownAvailability,
      exceptions: [
        { date: "2026-09-21", hours: 0 },
        { date: "2026-09-21", hours: 1 },
      ],
    }).success,
  ).toBe(false);
});
test("capacity windows and schedule horizons are bounded", () => {
  expect(() => capacityReport([], {}, [], "2026-09-21", 53)).toThrow();
  expect(() => countWorking("2026-09-21", "2026-09-20", calendar)).toThrow();
});

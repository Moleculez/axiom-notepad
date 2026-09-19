import { describe, expect, it } from "vitest";
import {
  calendarSchema,
  addDays,
  dayNumber,
  dateFromDay,
  dependencyOrder,
  nextWorkingDay,
  planSchedule,
  planningCsv,
  planningDraftSchema,
  planningSvg,
  workingDuration,
  workingEnd,
  type PlanningTask,
} from "../packages/shared/src/planning";
import {
  safeApplicationView,
  tabRoute,
} from "../packages/shared/src/application-tabs";
const calendar = calendarSchema.parse({ timezone: "Asia/Shanghai" });
const task = (id: string, patch: Partial<PlanningTask> = {}): PlanningTask => ({
  id,
  space_id: "space",
  project_id: null,
  title: id,
  body: "",
  status: "todo",
  priority: "normal",
  parent_id: null,
  assignee_id: null,
  start_on: "2026-09-21",
  due_on: "2026-09-22",
  estimate_hours: null,
  labels: [],
  milestone_id: null,
  note_id: null,
  version: 1,
  created_at: "",
  updated_at: "",
  deleted_at: null,
  dependencies: [],
  resource_ids: [],
  position: 0,
  ...patch,
});
describe("workspace planning calendar", () => {
  it("accepts unfinished drafts and rejects malformed or oversized recovered fields", () => {
    const draft = {
      title: "",
      body: "",
      status: "todo",
      priority: "normal",
      assigneeId: null,
      parentId: null,
      startOn: null,
      dueOn: null,
      estimateHours: null,
      labels: [],
      milestoneId: null,
      resourceIds: [],
      dependencies: [],
    };
    expect(planningDraftSchema.safeParse(draft).success).toBe(true);
    for (const patch of [
      { labels: "bad" },
      { dependencies: null },
      { status: "unknown" },
      { body: "x".repeat(100001) },
      { version: -1 },
      { resourceIds: ["not-a-uuid"] },
    ]) {
      expect(
        planningDraftSchema.safeParse({ ...draft, ...patch }).success,
      ).toBe(false);
    }
  });
  it("defaults to weekdays without converting date-only values to local instants", () => {
    expect(calendar.workingDays).toEqual([1, 2, 3, 4, 5]);
    expect(dateFromDay(dayNumber("2026-09-21"))).toBe("2026-09-21");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(nextWorkingDay("2026-09-25", calendar)).toBe("2026-09-28");
  });
  it("respects exceptional working and non-working dates", () => {
    const c = calendarSchema.parse({
      ...calendar,
      exceptions: [
        { date: "2026-09-26", working: true },
        { date: "2026-09-28", working: false },
      ],
    });
    expect(nextWorkingDay("2026-09-25", c)).toBe("2026-09-26");
    expect(nextWorkingDay("2026-09-27", c)).toBe("2026-09-29");
    expect(workingDuration("2026-09-25", "2026-09-29", c)).toBe(3);
    expect(workingEnd("2026-09-25", 3, c)).toBe("2026-09-29");
  });
  it("validates real dates, timezone, duplicate exceptions and an empty calendar", () => {
    expect(() => calendarSchema.parse({ timezone: "Not/AZone" })).toThrow();
    expect(() => calendarSchema.parse({ workingDays: [] })).toThrow();
    expect(() =>
      calendarSchema.parse({
        exceptions: [{ date: "2026-02-30", working: true }],
      }),
    ).toThrow();
    expect(() =>
      calendarSchema.parse({
        exceptions: [
          { date: "2026-09-21", working: true },
          { date: "2026-09-21", working: false },
        ],
      }),
    ).toThrow();
  });
});
describe("dependency scheduling", () => {
  it("allows unscheduling without inventing dates or moving successors", () => {
    const p = planSchedule(
      [task("a"), task("b", { dependencies: ["a"] })],
      [{ id: "a", version: 1, startOn: null, dueOn: null }],
      calendar,
    );
    expect(p.proposed).toEqual([
      { id: "a", version: 1, startOn: null, dueOn: null },
    ]);
    expect(p.warnings).toContain(
      "b: predecessor is unscheduled; existing dates were kept.",
    );
  });
  it("does not mutate inputs and pushes conflicts in topological order", () => {
    const tasks = [
        task("a"),
        task("b", {
          start_on: "2026-09-23",
          due_on: "2026-09-24",
          dependencies: ["a"],
        }),
        task("c", {
          start_on: "2026-09-25",
          due_on: "2026-09-25",
          dependencies: ["b"],
        }),
      ],
      before = JSON.stringify(tasks);
    const p = planSchedule(
      tasks,
      [{ id: "a", version: 1, startOn: "2026-09-24", dueOn: "2026-09-25" }],
      calendar,
    );
    expect(p.proposed.map((c) => [c.id, c.startOn, c.dueOn])).toEqual([
      ["a", "2026-09-24", "2026-09-25"],
      ["b", "2026-09-28", "2026-09-29"],
      ["c", "2026-09-30", "2026-09-30"],
    ]);
    expect(p.direct).toHaveLength(1);
    expect(p.conflicts).toHaveLength(2);
    expect(JSON.stringify(tasks)).toBe(before);
  });
  it("never pulls a successor earlier, invents missing dates or moves completed work", () => {
    const tasks = [
      task("a"),
      task("b", {
        dependencies: ["a"],
        start_on: "2026-10-01",
        due_on: "2026-10-02",
      }),
      task("c", { dependencies: ["a"], status: "done" }),
      task("d", { dependencies: ["a"], start_on: null, due_on: "2026-09-30" }),
    ];
    const p = planSchedule(
      tasks,
      [{ id: "a", version: 1, startOn: "2026-09-23", dueOn: "2026-09-24" }],
      calendar,
    );
    expect(p.proposed.map((c) => c.id)).toEqual(["a"]);
    expect(p.warnings).toHaveLength(2);
  });
  it("rejects stale revisions, missing dependencies, self-links and cycles", () => {
    expect(() =>
      dependencyOrder([task("a", { dependencies: ["a"] })]),
    ).toThrow();
    expect(() =>
      dependencyOrder([task("a", { dependencies: ["missing"] })]),
    ).toThrow();
    expect(() =>
      dependencyOrder([
        task("a", { dependencies: ["b"] }),
        task("b", { dependencies: ["a"] }),
      ]),
    ).toThrow(/cycle/);
    expect(() =>
      planSchedule(
        [task("a")],
        [{ id: "a", version: 2, startOn: "2026-09-23", dueOn: "2026-09-24" }],
        calendar,
      ),
    ).toThrow(/changed/);
  });
  it("handles 5,000 dependent tasks without recursion", () => {
    const tasks = Array.from({ length: 5000 }, (_, i) =>
      task(String(i), { dependencies: i ? [String(i - 1)] : [] }),
    );
    const started = performance.now(),
      p = planSchedule(
        tasks,
        [{ id: "0", version: 1, startOn: "2026-09-24", dueOn: "2026-09-25" }],
        calendar,
      );
    expect(p.proposed).toHaveLength(5000);
    expect(performance.now() - started).toBeLessThan(3000);
  });
  it("exports quoted CSV and escapes spreadsheet formula prefixes", () => {
    const csv = planningCsv([task("a", { title: '=HYPERLINK("x")' })]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
it("exports every row as inert SVG with escaped text", () => {
  const svg = planningSvg(
    [task("a", { title: "<script>alert(1)</script>" })],
    "A & B",
  );
  expect(svg).toContain("&lt;script&gt;");
  expect(svg).toContain("A &amp; B");
  expect(svg).not.toContain("<script>");
});
it("retains planning deep links and bounded scroll state without persisting arbitrary data", () => {
  expect(
    tabRoute(
      "/workbench/workspaces/abc/planning?task=def&view=gantt&zoom=week&assignee=user&token=secret",
    ),
  ).toBe(
    "/workspaces/abc/planning?assignee=user&task=def&view=gantt&zoom=week",
  );
  expect(
    safeApplicationView({
      planningScroll: 300,
      draft: "private",
      calendar: "no",
    }),
  ).toEqual({ planningScroll: 300 });
});

import { describe, it, expect } from "vitest";
import {
  calendarSchema,
  dependencyStart,
  taskDependencyLinks,
  resolveDependencyLinks,
  planningProgress,
  planSchedule,
  dependencyOrder,
  planningSvg,
  planningCsv,
  type PlanningTask,
} from "../packages/shared/src/planning";
import {
  goalProgress,
  goalInputSchema,
  planningViewStateSchema,
  nextRecurrenceDates,
} from "../packages/shared/src/planning-suite";
import { recurrenceSchema } from "../packages/shared/src/workspace";
import {
  analyzeSchedule,
  compareBaseline,
  capacityReport,
  unknownAvailability,
} from "../packages/shared/src/planning-analysis";
import {
  integrationActions,
  integrationPath,
} from "../packages/shared/src/integration-catalog";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const task = (n: number, patch: Partial<PlanningTask> = {}): PlanningTask => ({
  id: id(n),
  space_id: id(999),
  project_id: null,
  title: `Task ${n}`,
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
const calendar = calendarSchema.parse({});
describe("planning compatibility and reviewed integrations", () => {
  it("compares legacy baselines without noise but reports actual offsets and progress", () => {
    const snapshot = (t: PlanningTask) => ({
      tasks: [t],
      calendar,
      milestones: [],
      planningVersion: 1,
    });
    const legacy = task(2, { dependencies: [id(1)] });
    expect(
      compareBaseline(
        snapshot(legacy),
        snapshot({
          ...legacy,
          progress_percent: 0,
          dependencyLinks: [{ taskId: id(1), lagDays: 0 }],
        }),
      ).items,
    ).toEqual([]);
    const changed = compareBaseline(
      snapshot(legacy),
      snapshot({
        ...legacy,
        progress_percent: 25,
        dependencyLinks: [{ taskId: id(1), lagDays: -2 }],
      }),
    );
    expect(changed.items[0].fields).toEqual([
      "dependencyLinks",
      "progress_percent",
    ]);
  });
  it("keeps all new planning writes in the approved scope and validates entity paths", () => {
    for (const key of [
      "workspace_goal_create",
      "workspace_goal_update",
      "workspace_intake_submit",
      "workspace_intake_review",
      "workspace_tasks_bulk",
      "workspace_routine_update",
    ]) {
      const action = integrationActions.find((a) => a.name === key);
      expect(action, key).toBeDefined();
      expect(action?.approval, key).toBe(true);
    }
    const action = integrationActions.find(
      (a) => a.name === "workspace_goal_update",
    )!;
    expect(integrationPath(action, id(1), id(2))).toBe(
      `spaces/${id(1)}/goals/${id(2)}`,
    );
    expect(() => integrationPath(action, id(1), "../goals")).toThrow();
  });
});
describe("working-day relationship offsets", () => {
  it("has next-working-day zero, delay and overlap semantics over weekends", () => {
    expect(dependencyStart("2026-09-25", 0, calendar)).toBe("2026-09-28");
    expect(dependencyStart("2026-09-25", 2, calendar)).toBe("2026-09-30");
    expect(dependencyStart("2026-09-25", -1, calendar)).toBe("2026-09-25");
    expect(dependencyStart("2026-09-25", -2, calendar)).toBe("2026-09-24");
  });
  it("counts calendar exceptions in either direction", () => {
    const c = calendarSchema.parse({
      exceptions: [
        { date: "2026-09-28", working: false },
        { date: "2026-09-26", working: true },
      ],
    });
    expect(dependencyStart("2026-09-25", 0, c)).toBe("2026-09-26");
    expect(dependencyStart("2026-09-25", 1, c)).toBe("2026-09-29");
    expect(dependencyStart("2026-09-25", -1, c)).toBe("2026-09-25");
  });
  it.each([366, -366, 0.1, NaN, Infinity])("rejects invalid lag %s", (lag) =>
    expect(() => dependencyStart("2026-09-25", lag, calendar)).toThrow(),
  );
  it("preserves offsets through legacy ID-only writes and defaults new links to zero", () => {
    expect(
      resolveDependencyLinks({ dependencies: [id(1), id(3)] }, [
        { taskId: id(1), lagDays: -3 },
        { taskId: id(2), lagDays: 5 },
      ]),
    ).toEqual([
      { taskId: id(1), lagDays: -3 },
      { taskId: id(3), lagDays: 0 },
    ]);
    expect(taskDependencyLinks({ dependencies: [id(1)] })).toEqual([
      { taskId: id(1), lagDays: 0 },
    ]);
  });
  it("rejects contradictory or duplicated enriched links", () => {
    expect(() =>
      resolveDependencyLinks({
        dependencies: [id(2)],
        dependencyLinks: [{ taskId: id(1), lagDays: 0 }],
      }),
    ).toThrow();
    expect(() =>
      resolveDependencyLinks({
        dependencyLinks: [
          { taskId: id(1), lagDays: 0 },
          { taskId: id(1), lagDays: 1 },
        ],
      }),
    ).toThrow();
  });
  it("keeps forward-only proposals and makes lag-aware conflicts", () => {
    const a = task(1, { start_on: "2026-09-24", due_on: "2026-09-25" }),
      b = task(2, {
        start_on: "2026-09-28",
        due_on: "2026-09-29",
        dependencies: [a.id],
        dependencyLinks: [{ taskId: a.id, lagDays: 2 }],
      });
    const plan = planSchedule(
      [a, b],
      [{ id: a.id, version: 1, startOn: a.start_on, dueOn: a.due_on }],
      calendar,
    );
    expect(plan.proposed.find((t) => t.id === b.id)?.startOn).toBe(
      "2026-09-30",
    );
    expect(plan.conflicts[0].reason).toContain("+2");
    const overlap = { ...b, dependencyLinks: [{ taskId: a.id, lagDays: -1 }] };
    expect(
      planSchedule(
        [a, overlap],
        [{ id: a.id, version: 1, startOn: a.start_on, dueOn: a.due_on }],
        calendar,
      ).proposed,
    ).toHaveLength(1);
  });
  it("includes offsets in critical path and portable exports", () => {
    const tasks = [
      task(1),
      task(2, {
        dependencies: [id(1)],
        dependencyLinks: [{ taskId: id(1), lagDays: 3 }],
      }),
    ];
    const analysis = analyzeSchedule(tasks, calendar);
    expect(analysis.tasks.find((t) => t.id === id(2))?.earliestStart).toBe(
      "2026-09-28",
    );
    const svg = planningSvg(tasks, "A & B", undefined, {
      baseline: tasks,
      criticalIds: [id(1)],
      milestones: [
        {
          id: id(3),
          title: "Review",
          due_on: "2026-10-01",
          completed_at: null,
        },
      ],
    });
    expect(svg).toContain("A &amp; B");
    const csv = planningCsv(tasks, {
      baseline: tasks,
      criticalIds: [id(1)],
      scope: "Loaded filtered tasks",
      milestones: [
        {
          id: id(3),
          title: 'Review, "evidence"',
          due_on: "2026-09-30",
          completed_at: null,
        },
      ],
    });
    expect(csv).toContain('"Baseline start"');
    expect(csv).toContain('"Record type"');
    expect(csv).toContain('"Review, ""evidence"""');
    expect(csv).toContain('"milestone"');
    expect(csv).toContain('"Loaded filtered tasks"');
    expect(svg).toContain("+3d");
    expect(svg).toContain("Review");
    expect(svg).toContain("private drafts excluded");
  });
});
describe("outcomes, recurrence and scale contracts", () => {
  it("derives parent progress from unique non-cancelled descendant leaves", () => {
    const rows = [
      task(1, { progress_percent: 99 }),
      task(2, { parent_id: id(1), progress_percent: 40 }),
      task(3, { parent_id: id(1), status: "done" }),
      task(4, { parent_id: id(1), status: "cancelled", progress_percent: 20 }),
    ];
    expect(planningProgress(rows).get(id(1))).toBe(70);
    const progress = goalProgress(
      {
        kind: "linked",
        target: 1,
        current_value: 0,
        task_ids: [id(1), id(2), id(1)],
        milestone_ids: [],
      },
      rows,
      [],
    );
    expect(progress).toMatchObject({
      percent: 70,
      tracked: 2,
      completed: 1.4,
      unavailable: 0,
    });
  });
  it("clamps manual metrics and counts unavailable links without fabricating success", () => {
    expect(
      goalProgress(
        {
          kind: "metric",
          target: 2,
          current_value: 3,
          task_ids: [],
          milestone_ids: [],
        },
        [],
        [],
      ).percent,
    ).toBe(100);
    expect(
      goalProgress(
        {
          kind: "linked",
          target: 1,
          current_value: 0,
          task_ids: [id(8)],
          milestone_ids: [id(9)],
        },
        [],
        [],
      ),
    ).toMatchObject({ percent: 0, unavailable: 2 });
    expect(
      goalInputSchema.safeParse({ title: "Goal", kind: "metric", target: 0 })
        .success,
    ).toBe(false);
  });
  it("supports year/quarter views and rejects arbitrary settings", () => {
    expect(
      planningViewStateSchema.parse({ zoom: "quarter", grouping: "assignee" })
        .zoom,
    ).toBe("quarter");
    expect(planningViewStateSchema.safeParse({ zoom: "century" }).success).toBe(
      false,
    );
  });
  it("previews monthly clamps without regenerating processed occurrences", () => {
    const rule = recurrenceSchema.parse({
      frequency: "monthly",
      interval: 1,
      start: "2026-01-31",
      until: "2026-06-30",
    });
    expect(nextRecurrenceDates(rule, "2026-02-28", "2026-03-01")).toEqual([
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
    ]);
  });
  it("processes a 50,000 task dependency chain and wide hierarchy iteratively", () => {
    const chain = Array.from({ length: 50000 }, (_, i) =>
      task(i + 1, { dependencies: i ? [id(i)] : [] }),
    );
    expect(dependencyOrder(chain)).toHaveLength(50000);
    const wide = chain.map((t, i) => ({
      ...t,
      parent_id: i ? id(1) : null,
      progress_percent: 50,
    }));
    expect(planningProgress(wide).get(id(1))).toBe(50);
  }, 10000);
  it("allocates a 100,000-task cohort using each workspace calendar without inventing availability", () => {
    const rows = Array.from({ length: 100000 }, (_, i) =>
      task(i + 1, {
        space_id: i % 2 ? id(999) : id(998),
        assignee_id: "r",
        estimate_hours: 4,
      }),
    );
    const result = capacityReport(
      rows,
      {
        [id(999)]: calendar,
        [id(998)]: calendarSchema.parse({ workingDays: [2] }),
      },
      [
        {
          id: "r",
          name: "Researcher",
          version: 1,
          availability: unknownAvailability,
        },
      ],
      "2026-09-21",
      2,
    );
    expect(result.people[0].weeks[0].demand).toBe(400000);
    expect(result.people[0].weeks[0].available).toBeNull();
    expect(result.people[0].weeks[0].taskIds).toHaveLength(100000);
  }, 10000);
});

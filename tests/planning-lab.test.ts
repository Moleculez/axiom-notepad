import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import {
  customFieldsPatchSchema,
  fieldInputSchema,
  fieldMatches,
  fieldDisplay,
  fieldSummaryText,
  parseNumberFieldDraft,
  localDay,
  localClock,
  ruleChange,
  ruleInputSchema,
  ruleMatches,
  validateRuleConfiguration,
  timeCsv,
  timeInputSchema,
  timeQuerySchema,
  type TaskField,
  type AutomationTask,
} from "../packages/shared/src/planning-lab";
import {
  parseFieldQuery,
  fieldWhere,
  validateCustomPatch,
  fieldSummaries,
} from "../packages/shared/src/planning-field-service";
import { applyMetadataBatch } from "../packages/shared/src/planning-metadata-service";
import { planningViewStateSchema } from "../packages/shared/src/planning-suite";
import { integrationActions } from "../packages/shared/src/integration-catalog";
import {
  readTimeHistoryPage,
  timePage,
} from "../packages/shared/src/planning-lab-api";
const space = "00000000-0000-4000-8000-000000000001",
  id = "00000000-0000-4000-8000-000000000002",
  option = "00000000-0000-4000-8000-000000000003",
  other = "00000000-0000-4000-8000-000000000004";
const field = (
  kind: TaskField["kind"] = "text",
  extra: Partial<TaskField> = {},
): TaskField => ({
  id,
  space_id: space,
  version: 1,
  name: "Property",
  kind,
  unit: "",
  options: [],
  archived: false,
  position: 0,
  ...extra,
});
const task: AutomationTask = {
  id,
  version: 4,
  title: "Verify experiment",
  status: "todo",
  priority: "normal",
  assignee_id: null,
  labels: ["evidence"],
  due_on: "2026-10-01",
  custom_fields: { [other]: "Keep" },
};
const db = (fn: (sql: string, args: unknown[]) => unknown) => ({
  query: vi.fn(async (sql: string, args: unknown[] = []) => ({
    rows: fn(sql, args),
    rowCount: 1,
  })),
});
describe("typed lab planning", () => {
  it("parses complete scientific values without dropping unfinished numeric grammar", () => {
    for (const draft of ["-", "+", ".", "-0.", "1.", "1e", "1e-", "NaN"])
      expect(parseNumberFieldDraft(draft)).toBe(draft);
    expect(parseNumberFieldDraft("")).toBeNull();
    expect(parseNumberFieldDraft("-0.125")).toBe(-0.125);
    expect(parseNumberFieldDraft("+1.25e-3")).toBe(0.00125);
    expect(Object.is(parseNumberFieldDraft("-0"), -0)).toBe(true);
    expect(parseNumberFieldDraft(" 2 ")).toBe(2);
    expect(parseNumberFieldDraft("1e999")).toBe("1e999");
  });
  it("bounds definitions and gives choices stable identities", () => {
    expect(
      fieldInputSchema.parse({ name: " Mass ", kind: "number", unit: "g" })
        .name,
    ).toBe("Mass");
    expect(
      fieldInputSchema.safeParse({ name: "X", kind: "select", options: [] })
        .success,
    ).toBe(false);
    expect(
      fieldInputSchema.safeParse({
        name: "X",
        kind: "select",
        archived: true,
        options: [{ id: option, label: "Used", archived: true }],
      }).success,
    ).toBe(true);
    expect(
      fieldInputSchema.safeParse({
        name: "X",
        kind: "select",
        options: [
          { id: option, label: "One" },
          { id: other, label: "one" },
        ],
      }).success,
    ).toBe(false);
    expect(customFieldsPatchSchema.safeParse({ notAnId: "x" }).success).toBe(
      false,
    );
    expect(
      customFieldsPatchSchema.safeParse(
        Object.fromEntries(
          Array.from({ length: 33 }, () => [crypto.randomUUID(), 1]),
        ),
      ).success,
    ).toBe(false);
  });
  it("preserves omitted values, clears null, and fences the schema", async () => {
    const client = db(() => []),
      defs = {
        items: [field()],
        version: 7,
        limits: {
          activeFields: 32,
          retainedFields: 200,
          options: 50,
          filters: 8,
          columns: 8,
          rules: 100,
          enabledRules: 20,
          runTasks: 100,
          runBytes: 1500000,
        } as const,
      };
    expect(
      await validateCustomPatch(
        client as unknown as PoolClient,
        space,
        { [id]: "new" },
        7,
        { [other]: "Keep" },
        defs,
      ),
    ).toEqual({ [id]: "new", [other]: "Keep" });
    expect(
      await validateCustomPatch(
        client as unknown as PoolClient,
        space,
        { [id]: null },
        7,
        { [id]: "old", [other]: false },
        defs,
      ),
    ).toEqual({ [other]: false });
    await expect(
      validateCustomPatch(
        client as unknown as PoolClient,
        space,
        { [id]: "x" },
        6,
        {},
        defs,
      ),
    ).rejects.toThrow("Task fields changed");
    await expect(
      validateCustomPatch(
        client as unknown as PoolClient,
        space,
        { [other]: "x" },
        7,
        {},
        defs,
      ),
    ).rejects.toThrow("unavailable or archived");
    await expect(
      validateCustomPatch(
        client as unknown as PoolClient,
        space,
        { [id]: "javascript:alert(1)" },
        7,
        {},
        { ...defs, items: [field("url")] },
      ),
    ).rejects.toThrow("HTTP");
    await expect(
      validateCustomPatch(
        client as unknown as PoolClient,
        space,
        { [id]: "NaN" },
        7,
        {},
        { ...defs, items: [field("number")] },
      ),
    ).rejects.toThrow();
  });
  it("SQL filters bind user values and fail archived filters instead of broadening", () => {
    const args: unknown[] = [space],
      sql = fieldWhere(
        [{ fieldId: id, op: "contains", value: "x%' OR true--" }],
        [field()],
        args,
      );
    expect(sql).toContain("EXISTS");
    expect(sql).not.toContain("OR true");
    expect(args).toEqual([space, id, "%x\\%' OR true--%"]);
    expect(() =>
      fieldWhere(
        [{ fieldId: id, op: "eq", value: 1 }],
        [field("number", { archived: true })],
        [],
      ),
    ).toThrow("archived");
    expect(() =>
      fieldWhere([{ fieldId: id, op: "gte", value: 1 }], [field("text")], []),
    ).toThrow("Range filters");
    expect(
      parseFieldQuery(
        new URLSearchParams({
          includeFields: `${id},${id}`,
          fieldFilters: JSON.stringify([{ fieldId: id, op: "empty" }]),
        }),
      ).include,
    ).toEqual([id]);
    expect(() =>
      parseFieldQuery(new URLSearchParams({ fieldFilters: "[garbage" })),
    ).toThrow("Invalid task field filters");
  });
  it("matches typed values without treating zero or false as empty", () => {
    expect(fieldMatches(0, { op: "notEmpty" })).toBe(true);
    expect(fieldMatches(false, { op: "empty" })).toBe(false);
    expect(fieldMatches(3, { op: "gte", value: 2 })).toBe(true);
    expect(fieldMatches(3, { op: "gte", value: "2" })).toBe(false);
    expect(fieldMatches("2026-10-06", { op: "lte", value: "2026-10-07" })).toBe(
      true,
    );
    expect(fieldMatches([option], { op: "in", value: [other, option] })).toBe(
      true,
    );
    expect(
      fieldMatches([option, other], { op: "eq", value: [other, option] }),
    ).toBe(true);
    expect(fieldMatches("Physics", { op: "contains", value: "phys" })).toBe(
      true,
    );
    expect(fieldDisplay(field("number", { unit: "mg" }), 4)).toBe("4 mg");
    expect(fieldDisplay(field("person"), "gone")).toBe("Unavailable person");
    expect(
      fieldSummaryText(field(), { [id]: { value: "short", truncated: true } }),
    ).toBe("short…");
  });
  it("uses set equality for choice filters and requires explicit empty-value filters", () => {
    const choices = field("multiselect", {
      options: [
        { id: option, label: "One", archived: false },
        { id: other, label: "Two", archived: false },
      ],
    });
    const args: unknown[] = [];
    const sql = fieldWhere(
      [{ fieldId: id, op: "eq", value: [other, option] }],
      [choices],
      args,
    );
    expect(sql).toContain("v.value @>");
    expect(sql).toContain("v.value <@");
    expect(args).toEqual([id, JSON.stringify([other, option])]);
    expect(() =>
      fieldWhere([{ fieldId: id, op: "eq", value: [] }], [choices], []),
    ).toThrow("Not set");
    expect(() =>
      fieldWhere(
        [{ fieldId: id, op: "contains", value: "" }],
        [field("text")],
        [],
      ),
    ).toThrow("Not set");
    expect(() =>
      fieldWhere(
        [{ fieldId: id, op: "in", value: [option, option] }],
        [choices],
        [],
      ),
    ).toThrow("distinct active");
  });
  it("loads only selected, bounded value summaries", async () => {
    const client = db(() => [
      { task_id: other, field_id: id, value: "preview", truncated: true },
    ]);
    const result = await fieldSummaries(
      client as unknown as PoolClient,
      space,
      [other],
      [id],
    );
    expect(result.get(other)?.[id]).toEqual({
      value: "preview",
      truncated: true,
    });
    expect(client.query.mock.calls[0][0]).toContain("$[0 to 7]");
    expect(client.query.mock.calls[0][1]).toEqual([space, [other], [id]]);
    await fieldSummaries(client as unknown as PoolClient, space, [other], []);
    expect(client.query).toHaveBeenCalledTimes(1);
  });
  it("retains field filters and columns in saved view contracts", () => {
    const state = planningViewStateSchema.parse({
      customColumns: [id],
      filters: {
        fieldFilters: [{ fieldId: id, op: "gte", value: 2 }],
        sortField: id,
        sortDirection: "desc",
      },
    });
    expect(state.customColumns).toEqual([id]);
    expect(state.filters.sortDirection).toBe("desc");
    expect(
      planningViewStateSchema.safeParse({ customColumns: Array(9).fill(id) })
        .success,
    ).toBe(false);
  });
});
describe("manual time and reviewed automation contracts", () => {
  it("validates bounded manual entries and date ranges", () => {
    expect(
      timeInputSchema.safeParse({
        taskId: id,
        spentOn: "2026-02-30",
        minutes: 30,
      }).success,
    ).toBe(false);
    for (const minutes of [0, 1441, 1.5, NaN])
      expect(
        timeInputSchema.safeParse({
          taskId: id,
          spentOn: "2026-10-06",
          minutes,
        }).success,
      ).toBe(false);
    expect(
      timeQuerySchema.safeParse({ from: "2026-10-07", to: "2026-10-06" })
        .success,
    ).toBe(false);
    expect(timeQuerySchema.parse({ descendants: "1" }).descendants).toBe("1");
  });
  it("exports literal notes safely without spreadsheet formulas", () => {
    const csv = timeCsv([
      {
        ...{
          id,
          task_id: other,
          task_title: "=SUM(1,2)",
          author_id: "u",
          author_name: "Researcher",
          spent_on: "2026-10-06",
          minutes: 90,
          note: '@malicious\n"quoted"',
          note_preview: "short",
          note_truncated: true,
          withdrawn: false,
          version: 1,
          created_at: "",
          updated_at: "",
          task_deleted_at: null,
        },
      },
    ]);
    expect(csv).toContain('"\'=SUM(1,2)"');
    expect(csv).toContain('"\'@malicious\n""quoted"""');
    expect(csv).toContain('"1.50"');
  });
  it("uses the workspace clock across day and DST boundaries", () => {
    expect(localDay("Asia/Shanghai", new Date("2026-10-05T20:00:00Z"))).toBe(
      "2026-10-06",
    );
    expect(
      localClock("America/New_York", new Date("2026-11-01T05:30:00Z")),
    ).toBe("01:30");
    expect(
      localClock("America/New_York", new Date("2026-11-01T06:30:00Z")),
    ).toBe("01:30");
  });
  it("defaults paused, denies scripts and conflicting actions", () => {
    expect(
      ruleInputSchema.parse({
        name: "Triage",
        trigger: "created",
        actions: [{ kind: "priority", value: "high" }],
      }).enabled,
    ).toBe(false);
    for (const actions of [
      [{ kind: "script", value: "alert(1)" }],
      [
        { kind: "addLabel", value: "x" },
        { kind: "removeLabel", value: "x" },
      ],
      Array(9).fill({ kind: "priority", value: "high" }),
    ])
      expect(
        ruleInputSchema.safeParse({ name: "Rule", trigger: "daily", actions })
          .success,
      ).toBe(false);
    expect(
      ruleInputSchema.safeParse({
        name: "Rule",
        trigger: "daily",
        at: "25:00",
        actions: [{ kind: "status", value: "done" }],
      }).success,
    ).toBe(false);
  });
  it("validates active typed rule values, including partial-number drafts and choice overlap", () => {
    const rule = (
      conditions: unknown[],
      actions: unknown[] = [{ kind: "priority", value: "high" }],
    ) =>
      ruleInputSchema.parse({
        name: "Reviewed rule",
        trigger: "changed",
        conditions,
        actions,
      });
    expect(() =>
      validateRuleConfiguration(
        rule([{ field: "custom", fieldId: id, op: "eq", value: "-" }]),
        [field("number")],
      ),
    ).toThrow("Condition 1");
    expect(() =>
      validateRuleConfiguration(
        rule([
          { field: "custom", fieldId: id, op: "contains", value: "paper" },
        ]),
        [field("url")],
      ),
    ).not.toThrow();
    expect(() =>
      validateRuleConfiguration(
        rule([{ field: "custom", fieldId: id, op: "in", value: [option] }]),
        [
          field("select", {
            options: [{ id: option, label: "Collecting", archived: false }],
          }),
        ],
      ),
    ).not.toThrow();
    expect(() =>
      validateRuleConfiguration(
        rule([{ field: "custom", fieldId: id, op: "empty" }]),
        [field("text", { archived: true })],
      ),
    ).toThrow("available custom field");
    expect(() =>
      validateRuleConfiguration(
        rule([{ field: "label", op: "contains", value: "" }]),
        [],
      ),
    ).toThrow("Condition 1");
    expect(() =>
      validateRuleConfiguration(
        rule([{ field: "status", op: "eq", value: "unknown" }]),
        [],
      ),
    ).toThrow("Condition 1");
    expect(() =>
      validateRuleConfiguration(
        rule([], [{ kind: "custom", fieldId: id, value: "not a number" }]),
        [field("number")],
      ),
    ).toThrow("Action 1");
    expect(() =>
      validateRuleConfiguration(
        rule([], [{ kind: "custom", fieldId: id, value: null }]),
        [field("number")],
      ),
    ).not.toThrow();
  });
  it("keeps time-history search, mine, order and exact cursor positions in one bounded query", async () => {
    const instant = new Date().toISOString().replace(/\d{3}Z$/, "123456Z");
    const entry = {
      id: option,
      created_at: instant,
      cursor_at: instant,
      before_data: null,
      after_data: { note: "Complete historical note" },
      reason: "100%_\\ evidence",
    };
    const client = db((sql) =>
      sql.startsWith("SELECT to_char")
        ? [{ at: instant }]
        : [{ total: 4, items: [entry, { ...entry, id: other }] }],
    );
    const params = new URLSearchParams({
      q: "100%_\\",
      sort: "oldest",
      mine: "1",
      limit: "1",
    });
    const page = await readTimeHistoryPage(
      client as unknown as PoolClient,
      params,
      space,
      "owner",
      id,
    );
    expect(page.total).toBe(4);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).not.toHaveProperty("cursor_at");
    const [sql, args] = client.query.mock.calls[1];
    expect(sql).toContain("ORDER BY h.created_at ASC,h.id ASC");
    expect(sql).toContain("h.actor_id=");
    expect(sql).toContain("h.before_data->>'note'");
    expect(sql).not.toContain("100%");
    expect(args).toContain("%100\\%\\_\\\\%");
    expect(args!.at(-1)).toBe(2);
    const next = await readTimeHistoryPage(
      client as unknown as PoolClient,
      new URLSearchParams({
        ...Object.fromEntries(params),
        cursor: page.nextCursor!,
      }),
      space,
      "owner",
      id,
    );
    expect(next.total).toBe(4);
    expect(client.query.mock.calls.at(-1)![1]).toContain(instant);
    await expect(
      readTimeHistoryPage(
        client as unknown as PoolClient,
        new URLSearchParams({ cursor: page.nextCursor!, sort: "newest" }),
        space,
        "owner",
        id,
      ),
    ).rejects.toThrow("filters changed");
  });
  it("rejects an inclusive time-report window over 366 days before reading rows", async () => {
    const client = db(() => []);
    await expect(
      timePage(
        client as unknown as PoolClient,
        space,
        "owner",
        "UTC",
        new URLSearchParams({ from: "2025-10-06", to: "2026-10-07" }),
      ),
    ).rejects.toThrow("366 days");
    expect(client.query).not.toHaveBeenCalled();
  });
  it("builds minimal inverse patches and no date/body/time changes", () => {
    const change = ruleChange(
      {
        actions: [
          { kind: "priority", value: "high" },
          { kind: "custom", fieldId: id, value: false },
          { kind: "addLabel", value: "review" },
        ],
      },
      task,
    )!;
    expect(change.before).toEqual({
      priority: "normal",
      customFields: { [id]: null },
      labels: ["evidence"],
    });
    expect(change.patch).toEqual({
      priority: "high",
      customFields: { [id]: false },
      labels: ["evidence", "review"],
    });
    expect(
      ruleChange(
        {
          actions: [
            { kind: "status", value: "todo" },
            { kind: "addLabel", value: "evidence" },
          ],
        },
        task,
      ),
    ).toBeNull();
    expect(
      ruleMatches(
        {
          conditions: [
            { field: "overdue", op: "eq", value: true },
            { field: "label", op: "contains", value: "evidence" },
          ],
        },
        task,
        "2026-10-06",
      ),
    ).toBe(true);
    expect(
      ruleMatches(
        { conditions: [{ field: "overdue", op: "eq", value: true }] },
        { ...task, status: "done" },
        "2026-10-06",
      ),
    ).toBe(false);
  });
  it("runs metadata batches with one bounded row read and update, never a graph", async () => {
    const client = db((sql) =>
      sql.startsWith("SELECT id,version,title")
        ? [task]
        : sql.startsWith("UPDATE tasks")
          ? [{ id, version: 5 }]
          : [],
    );
    expect(
      await applyMetadataBatch(
        client as unknown as PoolClient,
        "owner",
        space,
        [{ id, version: 4, patch: { priority: "high" } }],
      ),
    ).toEqual([{ id, version: 5 }]);
    const all = client.query.mock.calls.map((c) => c[0]);
    expect(
      all.filter((s) => s.startsWith("SELECT id,version,title")),
    ).toHaveLength(1);
    expect(all.filter((s) => s.startsWith("UPDATE tasks"))).toHaveLength(1);
    expect(all.join(" ")).not.toContain("task_dependencies");
    expect(
      all.find((sql) => sql.startsWith("SELECT id,version,title")),
    ).not.toContain("custom_fields");
    const update = client.query.mock.calls.find((c) =>
      c[0].startsWith("UPDATE tasks"),
    )!;
    expect(update[0]).toContain(
      "THEN t.custom_fields ELSE jsonb_strip_nulls(t.custom_fields||x.custom_patch)",
    );
    expect(update[1]![1]).toContain('"custom_patch":null');
    expect(update[1]![1]).not.toContain("Keep");
  });
  it("validates touched properties and merges only their set/clear deltas in SQL", async () => {
    const client = db((sql) =>
      sql.startsWith("SELECT id,version,title")
        ? [task]
        : sql.startsWith("UPDATE tasks")
          ? [{ id, version: 5 }]
          : [],
    );
    const definitions = {
      items: [field("number"), field("text", { id: other })],
      version: 7,
      limits: {
        activeFields: 32,
        retainedFields: 200,
        options: 50,
        filters: 8,
        columns: 8,
        rules: 100,
        enabledRules: 20,
        runTasks: 100,
        runBytes: 1500000,
      } as const,
    };
    await applyMetadataBatch(
      client as unknown as PoolClient,
      "owner",
      space,
      [{ id, version: 4, patch: { customFields: { [id]: 0, [other]: null } } }],
      7,
      definitions,
    );
    const update = client.query.mock.calls.find((c) =>
      c[0].startsWith("UPDATE tasks"),
    )!;
    expect(JSON.parse(String(update[1]![1]))[0].custom_patch).toEqual({
      [id]: 0,
      [other]: null,
    });
    expect(update[1]![1]).not.toContain("Keep");
    expect(client.query.mock.calls.map((c) => c[0]).join(" ")).not.toContain(
      "planning_field_values",
    );
  });
  it("rejects stale or deleted rows before any update", async () => {
    const client = db(() => [{ ...task, deleted_at: "2026-10-06" }]);
    await expect(
      applyMetadataBatch(client as unknown as PoolClient, "owner", space, [
        { id, version: 4, patch: { status: "done" } },
      ]),
    ).rejects.toThrow("Restore");
    expect(client.query.mock.calls.some((c) => c[0].startsWith("UPDATE"))).toBe(
      false,
    );
    const stale = db(() => [task]);
    await expect(
      applyMetadataBatch(stale as unknown as PoolClient, "owner", space, [
        { id, version: 3, patch: { status: "done" } },
      ]),
    ).rejects.toThrow();
  });
  it("exposes scoped reads, not unattended time or rule writes", () => {
    for (const name of [
      "workspace_task_fields",
      "workspace_time_report",
      "workspace_time_entry",
      "workspace_automation_rules",
      "workspace_automation_runs",
    ])
      expect(integrationActions.find((a) => a.name === name)?.method).toBe(
        "GET",
      );
    expect(
      integrationActions.some(
        (a) =>
          a.method !== "GET" &&
          /planning-time|planning-fields|planning-automation/.test(a.path),
      ),
    ).toBe(false);
  });
});

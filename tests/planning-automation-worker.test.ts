import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";

const fixture = vi.hoisted(() => ({
  query: vi.fn(),
  notify: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../packages/shared/src/db", async (original) => ({
  ...(await original<typeof import("../packages/shared/src/db")>()),
  transaction: async (run: (client: PoolClient) => Promise<unknown>) =>
    run({ query: fixture.query } as unknown as PoolClient),
}));
vi.mock("../packages/shared/src/documents", async (original) => ({
  ...(await original<typeof import("../packages/shared/src/documents")>()),
  notifyWorkspace: fixture.notify,
}));
import { processPlanningAutomation } from "../packages/shared/src/planning-automation-api";

const space = "00000000-0000-4000-8000-000000000001";
const event = { id: "00000000-0000-4000-8000-000000000002", space_id: space };
beforeEach(() => {
  fixture.query.mockReset();
  fixture.notify.mockClear();
});
describe("planning automation worker query-order contracts (not concurrent SQL acceptance)", () => {
  it("locks the workspace before leasing coalesced events, then marks that exact batch", async () => {
    fixture.query.mockImplementation(async (sql: string) => ({
      rows: sql.startsWith("SELECT space_id FROM planning_automation_events")
        ? [{ space_id: space }]
        : sql.startsWith("SELECT * FROM planning_automation_events")
          ? [event]
          : [],
    }));
    expect(await processPlanningAutomation()).toBe(true);
    const queries = fixture.query.mock.calls.map(([sql]) => String(sql));
    expect(queries[0]).not.toContain("FOR UPDATE");
    const spaceLock = queries.findIndex(
      (sql) => sql.includes("FROM spaces") && sql.includes("FOR KEY SHARE"),
    );
    const eventLock = queries.findIndex((sql) =>
      sql.startsWith("SELECT * FROM planning_automation_events"),
    );
    expect(spaceLock).toBeGreaterThan(0);
    expect(eventLock).toBeGreaterThan(spaceLock);
    expect(queries[eventLock]).toContain("LIMIT 100 FOR UPDATE SKIP LOCKED");
    const marked = fixture.query.mock.calls.find(([sql]) =>
      String(sql).startsWith("UPDATE planning_automation_events"),
    );
    expect(marked?.[1]).toEqual([[event.id]]);
    expect(fixture.notify).toHaveBeenCalledOnce();
  });
  it("does not report work or emit notifications for a candidate another worker drained", async () => {
    fixture.query.mockImplementation(async (sql: string) => ({
      rows: sql.startsWith("SELECT space_id FROM planning_automation_events")
        ? [{ space_id: space }]
        : [],
    }));
    expect(await processPlanningAutomation()).toBe(false);
    expect(
      fixture.query.mock.calls.some(([sql]) =>
        String(sql).startsWith("UPDATE planning_automation_events"),
      ),
    ).toBe(false);
    expect(fixture.notify).not.toHaveBeenCalled();
  });
  it("propagates a database failure without a success notification", async () => {
    fixture.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("UPDATE planning_automation_events"))
        throw new Error("Fixture database failure");
      return {
        rows: sql.startsWith("SELECT space_id FROM planning_automation_events")
          ? [{ space_id: space }]
          : sql.startsWith("SELECT * FROM planning_automation_events")
            ? [event]
            : [],
      };
    });
    await expect(processPlanningAutomation()).rejects.toThrow(
      "Fixture database failure",
    );
    expect(fixture.notify).not.toHaveBeenCalled();
  });
  it("locks a daily workspace before its rule and uses an idempotent local-day key", async () => {
    const rule = {
      id: event.id,
      space_id: space,
      version: 1,
      name: "Daily review",
      configured_by: "owner",
      enabled: true,
      archived: false,
      timezone: "America/New_York",
      config: {
        name: "Daily review",
        trigger: "daily",
        at: "00:00",
        watched: ["status"],
        conditions: [],
        actions: [{ kind: "priority", value: "high" }],
        enabled: true,
        archived: false,
      },
    };
    fixture.query.mockImplementation(async (sql: string) => ({
      rows: sql.startsWith("SELECT r.id,r.space_id")
        ? [{ id: rule.id, space_id: space }]
        : sql.startsWith("SELECT r.*,s.timezone")
          ? [rule]
          : sql.startsWith("SELECT axiom_space_role")
            ? [{ role: "editor", manage: true, state: "active" }]
            : sql.startsWith("SELECT planning_fields_version")
              ? [{ planning_fields_version: 1 }]
              : sql.startsWith("SELECT timezone")
                ? [{ timezone: rule.timezone }]
                : sql.startsWith("INSERT INTO planning_automation_runs")
                  ? [{ id: event.id, status: "noop" }]
                  : [],
    }));
    expect(await processPlanningAutomation()).toBe(true);
    const queries = fixture.query.mock.calls.map(([sql]) => String(sql));
    const spaceLock = queries.findIndex(
      (sql) => sql.includes("FROM spaces") && sql.includes("FOR KEY SHARE"),
    );
    const ruleLock = queries.findIndex((sql) =>
      sql.startsWith("SELECT r.*,s.timezone"),
    );
    expect(ruleLock).toBeGreaterThan(spaceLock);
    expect(queries[ruleLock]).toContain("FOR UPDATE OF r SKIP LOCKED");
    const prepared = fixture.query.mock.calls.find(([sql]) =>
      String(sql).startsWith("INSERT INTO planning_automation_runs"),
    );
    expect(prepared?.[1][4]).toMatch(/^day:\d{4}-\d{2}-\d{2}$/);
    expect(queries.join(" ")).not.toContain("task_dependencies");
  });
});

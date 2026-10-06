import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
const tasks = vi.hoisted(() => vi.fn().mockResolvedValue([]));
vi.mock("../packages/shared/src/planning-api", () => ({
  planningTasks: tasks,
}));
import {
  readGoalDetail,
  readGoalPage,
  readHistoryPage,
  readOccurrencePage,
} from "../packages/shared/src/planning-archive-api";
const space = "00000000-0000-4000-8000-000000000001",
  id = "00000000-0000-4000-8000-000000000002";
const instant = new Date().toISOString();
const goal = {
  id,
  title: "Outcome",
  owner_id: "owner",
  owner_name: "Researcher",
  due_on: "2026-12-01",
  kind: "metric",
  target: "10",
  current_value: "4",
  unit: "trials",
  archived: false,
  version: 7,
  task_ids: [],
  milestone_ids: [],
  created_at: instant,
  updated_at: instant,
  cursor_at: instant,
};
function database(result: unknown) {
  const query = vi
    .fn()
    .mockImplementation((sql: string) =>
      Promise.resolve({
        rows: sql.startsWith("SELECT to_char(statement_timestamp()")
          ? [{ at: instant }]
          : sql.startsWith("SELECT id,completed_at")
            ? []
            : [result],
      }),
    );
  return { client: { query } as unknown as PoolClient, query };
}
beforeEach(() => tasks.mockClear());
describe("planning archive projections and bounded database work", () => {
  it("transfers summaries, normalizes numeric metrics and never queries a task graph for metric-only pages", async () => {
    const db = database({
      active: 1,
      archived: 0,
      workspace_total: 1,
      items: [goal],
    });
    const result = await readGoalPage(
      db.client,
      new URLSearchParams(),
      space,
      "owner",
    );
    expect(result.items[0]).toMatchObject({
      target: 10,
      current_value: 4,
      progress: { percent: 40 },
    });
    expect(result.items[0]).not.toHaveProperty("body");
    expect(result.items[0]).not.toHaveProperty("task_ids");
    expect(result.items[0]).not.toHaveProperty("cursor_at");
    expect(tasks).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledTimes(2);
    const [sql, values] = db.query.mock.calls[1];
    expect(sql).not.toContain("SELECT *");
    expect(sql).not.toContain("g.body FROM");
    expect(sql).not.toContain("OFFSET");
    expect(values.at(-1)).toBe(31);
  });
  it("builds a single shared graph only for the selected linked-goal page", async () => {
    const db = database({
      active: 2,
      archived: 0,
      workspace_total: 2,
      items: [
        { ...goal, kind: "linked" },
        { ...goal, kind: "linked", id: space },
      ],
    });
    const result = await readGoalPage(
      db.client,
      new URLSearchParams(),
      space,
      "owner",
    );
    expect(result.items).toHaveLength(2);
    expect(tasks).toHaveBeenCalledTimes(1);
    expect(tasks).toHaveBeenCalledWith(db.client, space);
    expect(
      db.query.mock.calls.filter(([sql]) =>
        sql.startsWith("SELECT id,completed_at"),
      ),
    ).toHaveLength(1);
  });
  it("does no scheduling work for empty results", async () => {
    const db = database({
      active: 0,
      archived: 0,
      workspace_total: 200,
      items: [],
    });
    const result = await readGoalPage(
      db.client,
      new URLSearchParams("q=missing"),
      space,
      "owner",
    );
    expect(result.total).toBe(0);
    expect(result.workspaceTotal).toBe(200);
    expect(result.nextCursor).toBeNull();
    expect(tasks).not.toHaveBeenCalled();
  });
  it("uses parameterized literal body search without returning descriptions or array links", async () => {
    const db = database({
      active: 1,
      archived: 0,
      workspace_total: 200,
      items: [goal],
    });
    await readGoalPage(
      db.client,
      new URLSearchParams("q=100%25_%5C&mine=1&kind=metric"),
      space,
      "owner",
    );
    const [sql, values] = db.query.mock.calls[1];
    expect(sql).toContain("OR g.body ILIKE");
    expect(sql).not.toContain("100%");
    expect(values).toContain("%100\\%\\_\\\\%");
    expect(values).toContain("owner");
    expect(values).toContain("metric");
  });
  it("fetches full goal descriptions only through the scoped detail query", async () => {
    const db = database({
      ...goal,
      body: "Canonical CRLF\r\n",
      due_on: "2026-12-01",
    });
    const detail = await readGoalDetail(db.client, space, id);
    expect(detail.item.body).toBe("Canonical CRLF\r\n");
    expect(detail.item.version).toBe(7);
    expect(detail.item.due_on).toBe("2026-12-01");
    expect(db.query.mock.calls[0][0]).toContain("g.space_id=$1 AND g.id=$2");
    expect(db.query.mock.calls[0][1]).toEqual([space, id]);
    expect(tasks).not.toHaveBeenCalled();
  });
  it("does not fabricate a missing goal", async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as PoolClient;
    await expect(readGoalDetail(client, space, id)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("uses one result/count statement and exact timestamp positions for history", async () => {
    const entry = {
      id,
      kind: "goal",
      summary: "Reviewed",
      actor_id: "owner",
      actor_name: "Researcher",
      created_at: instant,
      cursor_at: instant,
    };
    const db = database({ total: 2, items: [entry, { ...entry, id: space }] });
    const result = await readHistoryPage(
      db.client,
      new URLSearchParams("limit=1"),
      space,
      "owner",
      id,
    );
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(2);
    expect(result.nextCursor).toBeTruthy();
    expect(result.items[0]).not.toHaveProperty("cursor_at");
    const cursor = JSON.parse(
      Buffer.from(result.nextCursor!, "base64url").toString(),
    );
    expect(cursor.at).toBe(instant);
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[1][0]).toContain("h.created_at DESC,h.id DESC");
  });
  it("retains deleted-task state and filters scoped routine dates without body projection", async () => {
    const row = {
      id,
      title: "Check",
      status: "done",
      deleted_at: instant,
      occurs_on: "2026-10-06",
      cursor_at: "2026-10-06",
    };
    const db = database({ total: 1, items: [row] });
    const result = await readOccurrencePage(
      db.client,
      new URLSearchParams(
        "state=deleted&status=done&from=2026-10-06&to=2026-10-06",
      ),
      space,
      "owner",
      id,
    );
    expect(result.items[0].deleted_at).toBe(instant);
    expect(result.items[0]).not.toHaveProperty("body");
    const [sql, values] = db.query.mock.calls[1];
    expect(sql).toContain("t.space_id=$1");
    expect(sql).toContain("t.deleted_at IS NOT NULL");
    expect(sql).not.toContain("t.body");
    expect(values).toContain("done");
    expect(values.filter((v: unknown) => v === "2026-10-06")).toHaveLength(2);
  });
});

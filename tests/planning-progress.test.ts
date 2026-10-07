import { beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "../packages/shared/src/db";
import { readPlanningProgress } from "../packages/shared/src/planning-progress";
import {
  planningProgress,
  type PlanningTask,
} from "../packages/shared/src/planning";

vi.mock("../packages/shared/src/db", () => ({ query: vi.fn() }));
const space = "00000000-0000-4000-8000-000000000001";
const row = (id: string, parent: string | null, status = "todo", percent = 0) =>
  ({
    id,
    parent_id: parent,
    status,
    progress_percent: percent,
  }) as PlanningTask;
beforeEach(() => vi.mocked(query).mockReset());
describe("visible planning branch progress", () => {
  it("does no database work for a leaf-only page", async () => {
    expect(await readPlanningProgress(space, [])).toEqual(new Map());
    expect(query).not.toHaveBeenCalled();
  });
  it("uses one bounded, workspace-scoped recursive closure with deduplicated roots", async () => {
    const tasks = [
      row("parent", null),
      row("nested", "parent"),
      row("done", "nested", "done"),
      row("partial", "parent", "todo", 20),
      row("cancelled", "parent", "cancelled"),
    ];
    vi.mocked(query).mockResolvedValue(tasks);
    const progress = await readPlanningProgress(space, [
      "parent",
      "nested",
      "parent",
    ]);
    expect(progress.get("parent")).toBe(60);
    expect(progress.get("nested")).toBe(100);
    expect(progress).toEqual(planningProgress(tasks));
    const [sql, args] = vi.mocked(query).mock.calls[0];
    expect(args).toEqual([space, ["parent", "nested"]]);
    expect(sql).toContain("id=ANY($2::uuid[])");
    expect(sql).toContain("t.space_id=$1 AND t.deleted_at IS NULL");
    expect(sql).toContain("LIMIT 50001");
    expect(sql).not.toContain("UNION ALL");
  });
  it("retains the analysis limit instead of silently truncating a branch", async () => {
    vi.mocked(query).mockResolvedValue(
      Array.from({ length: 50001 }, (_, i) => row(String(i), null)),
    );
    await expect(readPlanningProgress(space, ["parent"])).rejects.toMatchObject(
      { status: 413 },
    );
  });
  it("returns empty for unavailable parents and terminates damaged cycles", async () => {
    vi.mocked(query).mockResolvedValue([]);
    expect(await readPlanningProgress(space, ["gone"])).toEqual(new Map());
    vi.mocked(query).mockResolvedValue([row("a", "b"), row("b", "a")]);
    const result = await readPlanningProgress(space, ["a"]);
    expect(result.get("a")).toBe(0);
    expect(result.get("b")).toBe(0);
  });
});

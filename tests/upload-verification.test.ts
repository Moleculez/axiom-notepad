import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ query: vi.fn(), clientQuery: vi.fn() }));
vi.mock("../packages/shared/src/db", () => ({
  query: f.query,
  transaction: async (work: (client: unknown) => unknown) =>
    work({ query: f.clientQuery }),
}));
import {
  enqueueUploadVerification,
  recoverUploadVerifications,
} from "../packages/shared/src/upload-verification";
import { withAuditContext } from "../packages/shared/src/audit-context";
beforeEach(() => {
  vi.resetAllMocks();
  f.query.mockResolvedValue([]);
  f.clientQuery.mockResolvedValue({ rows: [] });
});
describe("durable upload verification recovery", () => {
  it("revives terminal jobs with a fresh retry budget, retaining active leases/backoff and original attribution", async () => {
    await enqueueUploadVerification(
      { query: f.clientQuery } as any,
      "upload-id",
    );
    const [sql, values] = f.clientQuery.mock.calls[0];
    expect(values).toEqual([
      "upload:upload-id",
      JSON.stringify({ id: "upload-id" }),
    ]);
    expect(sql).toContain("attempts=0");
    expect(sql).toContain("workspace_jobs.status IN ('done','failed')");
    expect(sql).toContain("lease_id=NULL");
    expect(sql).not.toContain("payload=excluded.payload");
  });
  it("retains scoped integration attribution on the initial durable enqueue", async () => {
    const context = {
      actorId: "owner",
      integrationId: "integration",
      integrationScope: "workspace:write",
    };
    await withAuditContext(context, () =>
      enqueueUploadVerification({ query: f.clientQuery } as any, "id"),
    );
    expect(JSON.parse(f.clientQuery.mock.calls[0][1][1])).toEqual({
      id: "id",
      integrationAudit: context,
    });
  });
  it("only repairs bounded old verifying sessions without replaying terminal failed uploads", async () => {
    f.query.mockResolvedValue([
      { id: "recover" },
      { id: "completed-during-read" },
    ]);
    f.clientQuery.mockImplementation(async (sql: string, args: string[]) => ({
      rows:
        sql.startsWith("SELECT id") && args[0] === "recover"
          ? [{ id: "recover" }]
          : [],
    }));
    await recoverUploadVerifications();
    const sql = f.query.mock.calls[0][0];
    expect(sql).toContain("u.status='verifying'");
    expect(sql).toContain("u.expires_at>now()");
    expect(sql).toContain("30 seconds");
    expect(sql).toContain("j.status='done'");
    expect(sql).not.toContain("j.status='failed'");
    expect(sql).toContain("LIMIT 50");
    expect(
      f.clientQuery.mock.calls.filter(([statement]) =>
        statement.startsWith("INSERT"),
      ),
    ).toHaveLength(1);
    expect(f.clientQuery.mock.calls[0][0]).toContain("FOR UPDATE SKIP LOCKED");
  });
});

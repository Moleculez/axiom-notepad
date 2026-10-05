import { describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { retireRestoredTransfers } from "../packages/shared/src/restore-transfers";

function fixture(
  imports: boolean,
  uploads: boolean,
  hasLease = true,
  pending = true,
) {
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("SELECT"))
      return {
        rows: [
          { imports, uploads, jobs: uploads || imports, has_lease: hasLease },
        ],
        rowCount: 1,
      };
    if (sql.startsWith("UPDATE workspace_imports"))
      return {
        rows: pending ? [{ id: "batch" }] : [],
        rowCount: pending ? 1 : 0,
      };
    if (sql.startsWith("UPDATE upload_sessions"))
      return {
        rows: pending ? [{ id: "transfer" }] : [],
        rowCount: pending ? 1 : 0,
      };
    return { rows: [], rowCount: 0 };
  });
  return { query, client: { query } as unknown as Pick<pg.Client, "query"> };
}
describe("restore cancels unbacked transfer state without changing original storage", () => {
  it("supports pre-workspace backups with no transfer tables", async () => {
    const f = fixture(false, false);
    expect(await retireRestoredTransfers(f.client)).toEqual({
      uploads: 0,
      imports: 0,
    });
    expect(f.query).toHaveBeenCalledTimes(1);
  });
  it("supports older ordinary uploads without an import or lease column", async () => {
    const f = fixture(false, true, false);
    expect(await retireRestoredTransfers(f.client)).toEqual({
      uploads: 1,
      imports: 0,
    });
    const sql = f.query.mock.calls.map(([sql]) => sql).join("\n");
    expect(sql).not.toContain("UPDATE workspace_imports");
    expect(sql).not.toContain("lease_id=NULL");
    expect(sql).toContain("multipart_id=NULL");
  });
  it("retires active batches and staged uploads, fencing only their queued jobs", async () => {
    const f = fixture(true, true);
    expect(await retireRestoredTransfers(f.client)).toEqual({
      uploads: 1,
      imports: 1,
    });
    const sql = f.query.mock.calls.map(([sql]) => sql).join("\n");
    expect(sql).toContain("status IN ('preparing','publishing','blocked')");
    expect(sql).toContain(
      "status IN ('uploading','verifying','failed','staged')",
    );
    expect(sql).toContain("kind='finalize-import'");
    expect(sql).toContain("payload->>'id'=ANY($1::text[])");
    expect(sql).toContain("lease_id=NULL");
    expect(sql).not.toMatch(
      /DELETE FROM (?:notes|attachments|resources|workspace_imports)/,
    );
  });
  it("does not retire successful jobs on idempotent reruns", async () => {
    const f = fixture(true, true, true, false);
    expect(await retireRestoredTransfers(f.client)).toEqual({
      uploads: 0,
      imports: 0,
    });
    expect(
      f.query.mock.calls.some(([sql]) =>
        sql.startsWith("UPDATE workspace_jobs"),
      ),
    ).toBe(false);
  });
});

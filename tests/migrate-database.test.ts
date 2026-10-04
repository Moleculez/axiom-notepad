import { expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { migrateDatabase } from "../packages/shared/src/migrate-database";

vi.mock("../packages/shared/src/migrations", () => ({
  migration: "baseline SQL",
  forwardMigrations: [
    { version: 1, name: "backfill", sql: "backfill SQL" },
    { version: 2, name: "alter", sql: "alter SQL" },
  ],
}));

function client(applied = new Set<number>(), tracked = true) {
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes("to_regclass"))
      return {
        rows: [{ tracked: tracked ? "schema_migrations" : null }],
        rowCount: 1,
      };
    if (sql.includes("version>=4")) return { rows: [], rowCount: 1 };
    if (sql.startsWith("SELECT 1 FROM schema_migrations"))
      return { rows: [], rowCount: applied.has(values![0] as number) ? 1 : 0 };
    if (sql.startsWith("INSERT INTO schema_migrations"))
      applied.add(values![0] as number);
    return { rows: [], rowCount: 0 };
  });
  // The runner uses only query(text, values), not pg's streaming/callback
  // overloads. Keep the production client contract intact in this test double.
  return {
    query,
    connection: { query: query as unknown as PoolClient["query"] },
  };
}

it("flushes deferred trigger checks before each new migration without splitting the transaction", async () => {
  const db = client();
  await migrateDatabase(db.connection);
  const calls = db.query.mock.calls.map(([sql]) => sql);
  for (const sql of ["backfill SQL", "alter SQL"]) {
    const at = calls.indexOf(sql);
    expect(calls.slice(at - 2, at)).toEqual([
      "SET CONSTRAINTS ALL IMMEDIATE",
      "SET CONSTRAINTS ALL DEFERRED",
    ]);
  }
  expect(calls).not.toContain("COMMIT");
  expect(calls).not.toContain("BEGIN");
  db.query.mockClear();
  await migrateDatabase(db.connection);
  expect(db.query.mock.calls.map(([sql]) => sql)).not.toContain("alter SQL");
  expect(db.query.mock.calls.map(([sql]) => sql)).not.toContain(
    "SET CONSTRAINTS ALL IMMEDIATE",
  );
});

it("initializes the baseline but never reapplies an already recorded migration", async () => {
  const db = client(new Set([1]), false);
  await migrateDatabase(db.connection);
  const calls = db.query.mock.calls.map(([sql]) => sql);
  expect(calls).toContain("baseline SQL");
  expect(calls).not.toContain("backfill SQL");
  expect(calls).toContain("alter SQL");
});

it("does not execute or record the next migration if a previous backfill fails its deferred checks", async () => {
  const db = client(new Set([1]));
  const original = db.query.getMockImplementation()!;
  db.query.mockImplementation(async (sql, values) => {
    if (sql === "SET CONSTRAINTS ALL IMMEDIATE")
      throw new Error("invalid deferred foreign key");
    return original(sql, values);
  });
  await expect(migrateDatabase(db.connection)).rejects.toThrow(
    "invalid deferred foreign key",
  );
  const calls = db.query.mock.calls.map(([sql]) => sql);
  expect(calls).not.toContain("alter SQL");
  expect(calls).not.toContain("SET CONSTRAINTS ALL DEFERRED");
  expect(calls).not.toContain(
    "INSERT INTO schema_migrations(version,name) VALUES($1,$2)",
  );
});

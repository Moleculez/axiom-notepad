import type { PoolClient } from "pg";
import { migration, forwardMigrations } from "./migrations";

/** Caller owns a transaction. Used by normal migrations and the guarded reset. */
export async function migrateDatabase(client: Pick<PoolClient, "query">) {
  await client.query("SELECT pg_advisory_xact_lock(17012026)");
  const {
    rows: [baseline],
  } = await client.query(
    "SELECT to_regclass('public.schema_migrations') AS tracked",
  );
  const upgraded =
    baseline.tracked &&
    (
      await client.query(
        "SELECT 1 FROM schema_migrations WHERE version>=4 LIMIT 1",
      )
    ).rowCount;
  if (!upgraded) await client.query(migration);
  await client.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const item of forwardMigrations) {
    if (
      (
        await client.query("SELECT 1 FROM schema_migrations WHERE version=$1", [
          item.version,
        ])
      ).rowCount
    )
      continue;
    await client.query(item.sql);
    await client.query(
      "INSERT INTO schema_migrations(version,name) VALUES($1,$2)",
      [item.version, item.name],
    );
  }
}

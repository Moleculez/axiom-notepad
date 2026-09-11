import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { currentAuditContext, installAuditContext } from "./audit-context";
// PostgreSQL DATE is a calendar day, not an instant. The default pg parser
// creates a local-midnight Date; JSON serialization in positive time zones
// shifts it to the previous day and can corrupt a task on round-trip edits.
pg.types.setTypeParser(1082, (value: string) => value);
const globalDb = globalThis as unknown as { axiomPool?: pg.Pool };
export const pool =
  globalDb.axiomPool ??
  new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 12,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
if (process.env.NODE_ENV !== "production") globalDb.axiomPool = pool;
pool.on("error", (error) =>
  console.error("Database connection error:", error.message),
);
export const db = drizzle(pool, { schema });
export async function query<T = Record<string, any>>(
  sql: string,
  values: unknown[] = [],
): Promise<T[]> {
  if (currentAuditContext() && /\b(insert|update|delete)\b/i.test(sql))
    return transaction(
      async (client) => (await client.query(sql, values)).rows as T[],
    );
  return (await pool.query(sql, values)).rows as T[];
}
export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await installAuditContext(client);
    const value = await fn(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

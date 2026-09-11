import { pool } from "../../packages/shared/src/db";
import { migrateDatabase } from "../../packages/shared/src/migrate-database";
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await migrateDatabase(client);
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
}
console.log("Database schema is ready.");
await pool.end();

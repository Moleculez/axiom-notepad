import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
const db = new EmbeddedPostgres({
  databaseDir: "./.local-db",
  user: "axiom",
  password: "axiom",
  port: 54329,
  persistent: true,
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: (message) => console.error(message),
});
if (!existsSync("./.local-db/PG_VERSION")) await db.initialise();
await db.start();
const client = db.getPgClient();
await client.connect();
if (
  !(await client.query("SELECT 1 FROM pg_database WHERE datname='axiom'"))
    .rowCount
)
  await db.createDatabase("axiom");
await client.end();
console.log(
  "Local development PostgreSQL is running on 127.0.0.1:54329. Ctrl+C stops it; data is preserved.",
);
const stop = async () => {
  await db.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
